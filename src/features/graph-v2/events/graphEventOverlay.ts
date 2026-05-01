import type { ParsedGraphEvent } from '@/features/graph-v2/events/types'
import { GRAPH_EVENT_KIND_COLORS } from '@/features/graph-v2/events/types'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

const DEFAULT_DURATION_MS = 1250
const ZAP_DURATION_MS = 1350
const MAX_ACTIVE_EVENT_ANIMATIONS = 180
const MIN_RADIUS_PX = 2.4
const MAX_RADIUS_PX = 5.8
const TAIL_COUNT = 9
const ROUTE_WIDTH_PX = 1.15
const ZAP_HOT_COLOR = '#fff4bf'
const ZAP_SHADOW_COLOR = '#ff5da2'
// Cap DPR so 4K screens don't quadruple fill cost
const MAX_DPR = 2

export interface ViewportPositionResolver {
  (pubkey: string): { x: number; y: number } | null
}

interface ActiveGraphEvent {
  kind: ParsedGraphEvent['kind']
  fromPubkey: string | null
  toPubkey: string | null
  virtualFrom?: { x: number; y: number }
  virtualTo?: { x: number; y: number }
  radiusPx: number
  label: string
  startMs: number
  durationMs: number
  flickerSeed: number
  arrivalOnly: boolean
}

export interface OverlayPerfSnapshot {
  frameMsEma: number
  peakAnimCount: number
  activeAnimCount: number
}

export function satsToRadiusPx(sats: number): number {
  if (!Number.isFinite(sats) || sats <= 0) return MIN_RADIUS_PX
  const raw = 2.4 + Math.log10(sats + 1) * 0.72
  return Math.min(Math.max(raw, MIN_RADIUS_PX), MAX_RADIUS_PX)
}

export class GraphEventOverlay {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver | null = null
  private animations: ActiveGraphEvent[] = []
  private rafId: number | null = null
  private disposed = false
  private paused = false
  private pausedAtMs: number | null = null
  private devicePixelRatio = 1

  // Phase 0: perf instrumentation
  private lastTickMs = 0
  private frameMsEma = 0
  private peakAnimCount = 0
  static perfEnabled = false

  // Phase 1: gradient cache (keyed by rounded glowRadius, cleared on resize)
  private radialGradientCache = new Map<string, CanvasGradient>()
  private linearGradientCache = new Map<string, CanvasGradient>()

  constructor(
    private readonly container: HTMLElement,
    private readonly getCssViewportPosition: ViewportPositionResolver,
  ) {
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '5'
    canvas.setAttribute('data-graph-event-overlay', 'true')

    const containerStyle = getComputedStyle(container)
    if (containerStyle.position === 'static') {
      container.style.position = 'relative'
    }

    container.appendChild(canvas)
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('GraphEventOverlay: failed to acquire 2D context')
    }
    this.ctx = ctx
    this.resize()

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(container)
    }
  }

  public play(event: ParsedGraphEvent): boolean {
    if (this.disposed) return false

    const amountSats =
      event.payload.kind === 'zap' ? event.payload.data.amountSats ?? 0 : 0
    return this.enqueue({
      kind: event.kind,
      fromPubkey: event.fromPubkey,
      toPubkey: event.toPubkey,
      radiusPx:
        event.kind === 'zap' ? satsToRadiusPx(amountSats) : getKindRadius(event.kind),
      label: getEventLabel(event),
      durationMs: event.kind === 'zap' ? ZAP_DURATION_MS : DEFAULT_DURATION_MS,
      arrivalOnly: false,
    })
  }

  public playZap(zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>): boolean {
    if (this.disposed) return false
    return this.enqueue({
      kind: 'zap',
      fromPubkey: zap.fromPubkey,
      toPubkey: zap.toPubkey,
      radiusPx: satsToRadiusPx(zap.sats),
      label: formatSatsLabel(zap.sats),
      durationMs: ZAP_DURATION_MS,
      arrivalOnly: false,
    })
  }

  public playZapArrival(zap: Pick<ParsedZap, 'toPubkey' | 'sats'>): boolean {
    if (this.disposed) return false
    return this.enqueue({
      kind: 'zap',
      fromPubkey: null,
      toPubkey: zap.toPubkey,
      radiusPx: satsToRadiusPx(zap.sats),
      label: formatSatsLabel(zap.sats),
      durationMs: ZAP_DURATION_MS,
      arrivalOnly: true,
    })
  }

  public setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return

    if (paused) {
      this.paused = true
      this.pausedAtMs = performance.now()
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      return
    }

    const pausedAtMs = this.pausedAtMs
    const now = performance.now()
    const pausedForMs = pausedAtMs === null ? 0 : Math.max(0, now - pausedAtMs)
    this.paused = false
    this.pausedAtMs = null
    if (pausedForMs > 0) {
      this.animations = this.animations.map((animation) => ({
        ...animation,
        startMs: animation.startMs + pausedForMs,
      }))
    }
    if (this.animations.length > 0) {
      this.ensureTicking()
    }
  }

  public redrawPausedFrame(): void {
    if (this.disposed || !this.paused || this.animations.length === 0) {
      return
    }

    this.renderFrame(this.pausedAtMs ?? performance.now())
  }

  public dispose(): void {
    this.disposed = true
    this.paused = false
    this.pausedAtMs = null
    this.animations = []
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.resizeObserver?.disconnect()
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas)
    }
    this.radialGradientCache.clear()
    this.linearGradientCache.clear()
  }

  // Phase 0: expose perf snapshot for instrumentation
  public getPerfSnapshot(): OverlayPerfSnapshot {
    return {
      frameMsEma: this.frameMsEma,
      peakAnimCount: this.peakAnimCount,
      activeAnimCount: this.animations.length,
    }
  }

  private enqueue(input: {
    kind: ActiveGraphEvent['kind']
    fromPubkey: string | null
    toPubkey: string
    radiusPx: number
    label: string
    durationMs: number
    arrivalOnly: boolean
  }): boolean {
    const toPos = this.getCssViewportPosition(input.toPubkey)

    if (input.arrivalOnly) {
      if (!toPos) return false
      this.pushAnimation({
        ...input,
        fromPubkey: null,
        toPubkey: input.toPubkey,
        startMs: this.pausedAtMs ?? performance.now(),
        flickerSeed: Math.random() * Math.PI * 2,
      })
      return true
    }

    const fromPos =
      input.fromPubkey === null
        ? null
        : this.getCssViewportPosition(input.fromPubkey)
    if (!fromPos && !toPos) return false

    let virtualFrom: { x: number; y: number } | undefined
    let virtualTo: { x: number; y: number } | undefined
    let fromPubkey = input.fromPubkey
    let toPubkey: string | null = input.toPubkey

    if (!fromPos && toPos) {
      virtualFrom = this.getOutsidePoint(toPos)
      fromPubkey = null
    } else if (fromPos && !toPos) {
      virtualTo = this.getOutsidePoint(fromPos)
      toPubkey = null
    }

    this.pushAnimation({
      ...input,
      fromPubkey,
      toPubkey,
      virtualFrom,
      virtualTo,
      startMs: this.pausedAtMs ?? performance.now(),
      flickerSeed: Math.random() * Math.PI * 2,
    })
    return true
  }

  private pushAnimation(animation: ActiveGraphEvent): void {
    this.animations.push(animation)
    if (this.animations.length > MAX_ACTIVE_EVENT_ANIMATIONS) {
      this.animations = this.animations.slice(-MAX_ACTIVE_EVENT_ANIMATIONS)
    }
    this.ensureTicking()
  }

  private getOutsidePoint(target: { x: number; y: number }): { x: number; y: number } {
    const widthCss = this.canvas.width / this.devicePixelRatio
    const heightCss = this.canvas.height / this.devicePixelRatio
    const cx = widthCss / 2
    const cy = heightCss / 2

    let dx = target.x - cx
    let dy = target.y - cy

    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
      dy = -1
    }

    const dist = Math.hypot(dx, dy)
    dx /= dist
    dy /= dist

    const margin = 50
    const left = -margin
    const right = widthCss + margin
    const top = -margin
    const bottom = heightCss + margin

    const tX =
      dx > 0
        ? (right - target.x) / dx
        : dx < 0
          ? (left - target.x) / dx
          : Infinity
    const tY =
      dy > 0
        ? (bottom - target.y) / dy
        : dy < 0
          ? (top - target.y) / dy
          : Infinity
    const t = Math.min(tX, tY)

    return {
      x: target.x + dx * t,
      y: target.y + dy * t,
    }
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect()
    // Phase 1: cap DPR at MAX_DPR to avoid quadrupling fill cost on 4K screens
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR)
    this.devicePixelRatio = dpr
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Gradient objects are tied to canvas coordinates — must be invalidated on resize
    this.radialGradientCache.clear()
    this.linearGradientCache.clear()
  }

  private ensureTicking(): void {
    if (this.rafId !== null || this.disposed || this.paused) return
    this.rafId = requestAnimationFrame(this.tick)
  }

  private readonly tick = (timestamp: number) => {
    this.rafId = null
    if (this.disposed || this.paused) return

    // Phase 0: frame time EMA (only when perf tracking enabled)
    if (GraphEventOverlay.perfEnabled && this.lastTickMs > 0) {
      const frameMs = timestamp - this.lastTickMs
      this.frameMsEma = this.frameMsEma * 0.9 + frameMs * 0.1
    }
    this.lastTickMs = timestamp
    if (GraphEventOverlay.perfEnabled) {
      this.peakAnimCount = Math.max(this.peakAnimCount, this.animations.length)
    }

    this.renderFrame(timestamp)
    if (this.animations.length > 0) {
      this.ensureTicking()
    }
  }

  private renderFrame(timestamp: number): void {
    const ctx = this.ctx
    const widthCss = this.canvas.width / this.devicePixelRatio
    const heightCss = this.canvas.height / this.devicePixelRatio
    ctx.clearRect(0, 0, widthCss, heightCss)

    const next: ActiveGraphEvent[] = []
    for (const anim of this.animations) {
      const elapsed = timestamp - anim.startMs
      if (elapsed >= anim.durationMs) continue

      const to =
        anim.toPubkey === null
          ? anim.virtualTo
          : this.getCssViewportPosition(anim.toPubkey)
      if (!to) continue

      const progress = Math.min(1, Math.max(0, elapsed / anim.durationMs))

      if (anim.arrivalOnly || (anim.fromPubkey === null && !anim.virtualFrom)) {
        this.drawImpact(ctx, to, progress, anim)
        next.push(anim)
        continue
      }

      const from =
        anim.fromPubkey === null
          ? anim.virtualFrom
          : this.getCssViewportPosition(anim.fromPubkey)
      if (!from) continue

      const distance = Math.hypot(to.x - from.x, to.y - from.y)
      if (distance < 1) {
        this.drawImpact(ctx, to, progress, anim)
      } else if (anim.kind === 'zap') {
        this.drawZapElectron(ctx, from, to, progress, anim)
      } else {
        this.drawActivityMotion(ctx, from, to, progress, anim)
      }
      next.push(anim)
    }

    this.animations = next
  }

  private drawZapElectron(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    progress: number,
    anim: ActiveGraphEvent,
  ): void {
    const eased = easeInOutQuad(progress)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.hypot(dx, dy)
    if (distance < 1) return

    const nx = -dy / distance
    const ny = dx / distance
    const x = from.x + dx * eased
    const y = from.y + dy * eased
    const fadeIn = smoothstep(0, 0.12, progress)
    const fadeOut = 1 - smoothstep(0.84, 1, progress)
    const lifeAlpha = fadeIn * fadeOut
    const flicker = 0.86 + Math.sin(progress * Math.PI * 18 + anim.flickerSeed) * 0.14

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    drawLineRoute(ctx, from, to, GRAPH_EVENT_KIND_COLORS.zap, 0.22 * lifeAlpha)
    this.drawZapTail(ctx, from, dx, dy, eased, progress, anim, lifeAlpha)
    this.drawEnergyCore(ctx, x, y, anim.radiusPx, lifeAlpha, flicker)
    drawPulse(ctx, to, progress, anim.radiusPx, GRAPH_EVENT_KIND_COLORS.zap)

    ctx.restore()

    drawLabel(ctx, anim.label, x, y, nx, ny, progress, lifeAlpha, GRAPH_EVENT_KIND_COLORS.zap)
  }

  private drawActivityMotion(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    progress: number,
    anim: ActiveGraphEvent,
  ): void {
    const color = GRAPH_EVENT_KIND_COLORS[anim.kind]
    const eased = easeOutCubic(progress)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.hypot(dx, dy)
    const nx = distance > 0 ? -dy / distance : 0
    const ny = distance > 0 ? dx / distance : -1
    const arc = Math.sin(progress * Math.PI) * Math.min(26, distance * 0.18)
    const x = from.x + dx * eased + nx * arc
    const y = from.y + dy * eased + ny * arc
    const fadeIn = smoothstep(0, 0.14, progress)
    const fadeOut = 1 - smoothstep(0.84, 1, progress)
    const lifeAlpha = fadeIn * fadeOut

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    drawLineRoute(ctx, from, to, color, 0.18 * lifeAlpha, anim.kind === 'quote')

    switch (anim.kind) {
      case 'like':
        drawHeart(ctx, x, y, 8 + 4 * Math.sin(progress * Math.PI), color, lifeAlpha)
        drawPulse(ctx, to, progress, 5, color)
        break
      case 'repost':
        drawRepostRing(ctx, x, y, 7, progress, color, lifeAlpha)
        drawPulse(ctx, to, progress, 5, color)
        break
      case 'save':
        drawBookmark(ctx, x, y, 7, color, lifeAlpha)
        drawPulse(ctx, to, progress, 5, color)
        break
      case 'quote':
        drawQuoteMark(ctx, x, y, color, lifeAlpha)
        drawPulse(ctx, to, progress, 5, color)
        break
      case 'comment':
        drawCommentBubble(ctx, x, y, 8, color, lifeAlpha)
        drawPulse(ctx, to, progress, 5, color)
        break
      case 'zap':
        break
    }

    ctx.restore()
    drawLabel(ctx, anim.label, x, y, nx, ny, progress, lifeAlpha, color)
  }

  private drawImpact(
    ctx: CanvasRenderingContext2D,
    to: { x: number; y: number },
    progress: number,
    anim: ActiveGraphEvent,
  ): void {
    const color = GRAPH_EVENT_KIND_COLORS[anim.kind]
    const fadeIn = smoothstep(0, 0.12, progress)
    const fadeOut = 1 - smoothstep(0.84, 1, progress)
    const lifeAlpha = fadeIn * fadeOut
    const flicker = 0.86 + Math.sin(progress * Math.PI * 18 + anim.flickerSeed) * 0.14

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    drawPulse(ctx, to, progress, anim.radiusPx, color)
    if (anim.kind === 'zap') {
      this.drawEnergyCore(ctx, to.x, to.y, anim.radiusPx, lifeAlpha, flicker)
    } else {
      const lift = Math.sin(progress * Math.PI) * 10
      const x = to.x
      const y = to.y - lift
      switch (anim.kind) {
        case 'like':
          drawHeart(ctx, x, y, 9, color, lifeAlpha)
          break
        case 'repost':
          drawRepostRing(ctx, x, y, 8, progress, color, lifeAlpha)
          break
        case 'save':
          drawBookmark(ctx, x, y, 8, color, lifeAlpha)
          break
        case 'quote':
          drawQuoteMark(ctx, x, y, color, lifeAlpha)
          break
        case 'comment':
          drawCommentBubble(ctx, x, y, 9, color, lifeAlpha)
          break
      }
    }
    ctx.restore()

    drawLabel(ctx, anim.label, to.x, to.y, 0, -1, progress, lifeAlpha, color)
  }

  // Phase 1: batch tail sparks into 2 fill calls (by color) instead of 9 individual fills
  private drawZapTail(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    dx: number,
    dy: number,
    eased: number,
    progress: number,
    anim: ActiveGraphEvent,
    lifeAlpha: number,
  ): void {
    const tailLength = 0.22
    const tailStart = Math.max(0, eased - tailLength)
    const tailEndX = from.x + dx * eased
    const tailEndY = from.y + dy * eased
    const tailStartX = from.x + dx * tailStart
    const tailStartY = from.y + dy * tailStart

    // Phase 1: cache linear gradient by bucketed endpoints (1px granularity)
    const gKey = `${Math.round(tailStartX)}:${Math.round(tailStartY)}:${Math.round(tailEndX)}:${Math.round(tailEndY)}`
    let gradient = this.linearGradientCache.get(gKey)
    if (!gradient) {
      gradient = ctx.createLinearGradient(tailStartX, tailStartY, tailEndX, tailEndY)
      gradient.addColorStop(0, 'rgba(242, 153, 74, 0)')
      gradient.addColorStop(0.68, 'rgba(255, 216, 107, 0.42)')
      gradient.addColorStop(1, 'rgba(255, 246, 207, 0.98)')
      // Bounded cache: keep at most 64 entries
      if (this.linearGradientCache.size >= 64) {
        const firstKey = this.linearGradientCache.keys().next().value
        if (firstKey !== undefined) this.linearGradientCache.delete(firstKey)
      }
      this.linearGradientCache.set(gKey, gradient)
    }

    ctx.globalAlpha = lifeAlpha
    ctx.strokeStyle = gradient
    ctx.lineWidth = Math.max(ROUTE_WIDTH_PX, anim.radiusPx * 0.78)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(tailStartX, tailStartY)
    ctx.lineTo(tailEndX, tailEndY)
    ctx.stroke()

    // Phase 1: batch sparks into 2 fill calls grouped by color
    const baseAlpha = 0.28 * lifeAlpha * (1 - progress * 0.28)

    // Even-indexed sparks — zap color
    ctx.fillStyle = GRAPH_EVENT_KIND_COLORS.zap
    ctx.beginPath()
    for (let index = TAIL_COUNT; index >= 1; index -= 1) {
      if (index % 2 !== 0) continue
      const t = Math.max(0, eased - index * 0.018)
      const sparkX = from.x + dx * t
      const sparkY = from.y + dy * t
      const radius = Math.max(0.85, anim.radiusPx * (0.2 + (TAIL_COUNT - index) * 0.035))
      ctx.globalAlpha = ((TAIL_COUNT - index + 1) / TAIL_COUNT) * baseAlpha
      ctx.moveTo(sparkX + radius, sparkY)
      ctx.arc(sparkX, sparkY, radius, 0, Math.PI * 2)
    }
    ctx.fill()

    // Odd-indexed sparks — shadow color
    ctx.fillStyle = ZAP_SHADOW_COLOR
    ctx.beginPath()
    for (let index = TAIL_COUNT; index >= 1; index -= 1) {
      if (index % 2 === 0) continue
      const t = Math.max(0, eased - index * 0.018)
      const sparkX = from.x + dx * t
      const sparkY = from.y + dy * t
      const radius = Math.max(0.85, anim.radiusPx * (0.2 + (TAIL_COUNT - index) * 0.035))
      ctx.globalAlpha = ((TAIL_COUNT - index + 1) / TAIL_COUNT) * baseAlpha
      ctx.moveTo(sparkX + radius, sparkY)
      ctx.arc(sparkX, sparkY, radius, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  private drawEnergyCore(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radiusPx: number,
    lifeAlpha: number,
    flicker: number,
  ): void {
    const glowRadius = radiusPx * (3.3 + flicker * 0.55)

    // Phase 1: cache radial gradient by bucketed position+radius (avoids GC per frame)
    const rKey = `${Math.round(x)}:${Math.round(y)}:${Math.round(glowRadius * 2)}`
    let glow = this.radialGradientCache.get(rKey)
    if (!glow) {
      glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius)
      glow.addColorStop(0, 'rgba(255, 246, 207, 0.95)')
      glow.addColorStop(0.32, 'rgba(255, 216, 107, 0.58)')
      glow.addColorStop(1, 'rgba(242, 153, 74, 0)')
      if (this.radialGradientCache.size >= 64) {
        const firstKey = this.radialGradientCache.keys().next().value
        if (firstKey !== undefined) this.radialGradientCache.delete(firstKey)
      }
      this.radialGradientCache.set(rKey, glow)
    }

    ctx.globalAlpha = 0.88 * lifeAlpha
    ctx.beginPath()
    ctx.fillStyle = glow
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = lifeAlpha
    ctx.beginPath()
    ctx.fillStyle = ZAP_HOT_COLOR
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 0.75 * lifeAlpha
    ctx.strokeStyle = GRAPH_EVENT_KIND_COLORS.zap
    ctx.lineWidth = 0.9
    ctx.stroke()
  }
}

function getKindRadius(kind: ParsedGraphEvent['kind']): number {
  switch (kind) {
    case 'zap':
      return MIN_RADIUS_PX
    case 'like':
      return 5.8
    case 'repost':
      return 6.2
    case 'save':
      return 5.4
    case 'quote':
      return 6.2
    case 'comment':
      return 6.4
  }
}

function getEventLabel(event: ParsedGraphEvent): string {
  switch (event.payload.kind) {
    case 'zap':
      return formatSatsLabel(event.payload.data.amountSats ?? 0)
    case 'like':
      return event.payload.data.reaction.length <= 3
        ? event.payload.data.reaction
        : 'Like'
    case 'repost':
      return 'Repost'
    case 'save':
      return 'Save'
    case 'quote':
      return 'Quote'
    case 'comment':
      return 'Comment'
  }
}

function drawLineRoute(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  alpha: number,
  dashed = false,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = ROUTE_WIDTH_PX
  ctx.lineCap = 'round'
  if (dashed) {
    ctx.setLineDash([4, 6])
  }
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.restore()
}

function drawPulse(
  ctx: CanvasRenderingContext2D,
  to: { x: number; y: number },
  progress: number,
  radiusPx: number,
  color: string,
): void {
  const pulse = smoothstep(0.62, 1, progress)
  if (pulse <= 0) return

  const alpha = (1 - pulse) * 0.48
  const radius = radiusPx * 1.8 + pulse * 18

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(to.x, to.y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// Phase 1: removed ctx.shadowBlur — replaced with double-fill glow technique.
// shadowBlur forces CPU rasterisation; two fills with different scales is cheaper.

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = color

  // Outer glow via larger semi-transparent copy
  ctx.save()
  const glowScale = (size + 5) / 16
  ctx.scale(glowScale, glowScale)
  ctx.globalAlpha = alpha * 0.22
  ctx.beginPath()
  ctx.moveTo(0, 6)
  ctx.bezierCurveTo(-13, -4, -7, -14, 0, -7)
  ctx.bezierCurveTo(7, -14, 13, -4, 0, 6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Main shape
  ctx.save()
  ctx.scale(size / 16, size / 16)
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.moveTo(0, 6)
  ctx.bezierCurveTo(-13, -4, -7, -14, 0, -7)
  ctx.bezierCurveTo(7, -14, 13, -4, 0, 6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.restore()
}

function drawRepostRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
  color: string,
  alpha: number,
): void {
  const rotation = progress * Math.PI * 2
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = 2.8 // Phase 1: thicker stroke instead of shadowBlur glow
  ctx.beginPath()
  ctx.arc(0, 0, size, Math.PI * 0.12, Math.PI * 1.42)
  ctx.stroke()
  // Inner stroke for depth (replaces shadowBlur)
  ctx.globalAlpha = alpha * 0.35
  ctx.lineWidth = 5.5
  ctx.stroke()
  // Arrow head
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(size + 1, -1)
  ctx.lineTo(size + 5, -5)
  ctx.lineTo(size + 5, 1)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

function drawBookmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
): void {
  ctx.save()
  ctx.translate(x, y)

  // Glow via wider stroke outline
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.globalAlpha = alpha * 0.2
  bookmarkPath(ctx, size)
  ctx.stroke()

  // Main fill
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  bookmarkPath(ctx, size)
  ctx.fill()

  ctx.restore()
}

function bookmarkPath(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath()
  ctx.moveTo(-size * 0.55, -size)
  ctx.lineTo(size * 0.55, -size)
  ctx.lineTo(size * 0.55, size)
  ctx.lineTo(0, size * 0.46)
  ctx.lineTo(-size * 0.55, size)
  ctx.closePath()
}

function drawQuoteMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  alpha: number,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = '700 18px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color

  // Glow via second draw with larger blur-like offset
  ctx.globalAlpha = alpha * 0.25
  ctx.font = '700 24px Georgia, serif'
  ctx.fillText('"', x, y + 1)

  // Main draw
  ctx.globalAlpha = alpha
  ctx.font = '700 18px Georgia, serif'
  ctx.fillText('"', x, y + 1)
  ctx.restore()
}

function drawCommentBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
): void {
  const width = size * 1.6
  const height = size * 1.08
  const radius = 4
  const left = x - width / 2
  const top = y - height / 2

  ctx.save()

  // Glow via wider stroke outline (replaces shadowBlur)
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.globalAlpha = alpha * 0.2
  roundedRectPath(ctx, left, top, width, height, radius)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 2, y + height / 2 - 1)
  ctx.lineTo(x + 4, y + height / 2 + 5)
  ctx.lineTo(x + 5, y + height / 2 - 1)
  ctx.closePath()
  ctx.stroke()

  // Main fill
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  roundedRectPath(ctx, left, top, width, height, radius)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - 2, y + height / 2 - 1)
  ctx.lineTo(x + 4, y + height / 2 + 5)
  ctx.lineTo(x + 5, y + height / 2 - 1)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const right = x + width
  const bottom = y + height
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(right - radius, y)
  ctx.quadraticCurveTo(right, y, right, y + radius)
  ctx.lineTo(right, bottom - radius)
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom)
  ctx.lineTo(x + radius, bottom)
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  nx: number,
  ny: number,
  progress: number,
  lifeAlpha: number,
  color: string,
): void {
  const labelAlpha = lifeAlpha * (1 - smoothstep(0.7, 1, progress))
  if (labelAlpha <= 0.02 || !label) return

  const offset = 12
  const lx = x + nx * offset
  const ly = y + ny * offset - 4

  ctx.save()
  ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Phase 1: replace shadowBlur with dark stroke outline for readability
  ctx.globalAlpha = labelAlpha * 0.7
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeText(label, lx, ly)

  ctx.globalAlpha = labelAlpha
  ctx.fillStyle = color
  ctx.fillText(label, lx, ly)
  ctx.restore()
}

function formatSatsLabel(sats: number): string {
  if (!Number.isFinite(sats) || sats <= 0) return '0'
  if (sats < 1_000) return Math.floor(sats).toString()
  if (sats < 1_000_000) return `${formatCompact(sats / 1_000)}k`
  return `${formatCompact(sats / 1_000_000)}m`
}

function formatCompact(value: number): string {
  if (value >= 100) return Math.round(value).toString()
  return value.toFixed(1).replace(/\.0$/, '')
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
