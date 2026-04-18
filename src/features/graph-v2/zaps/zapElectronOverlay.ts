// Imperative canvas overlay that renders energy-like zaps on top of Sigma.
// Lives in the Sigma container as a pointer-events: none canvas and is
// driven by a single requestAnimationFrame loop while animations exist.
//
// The zap itself should read as energy moving through an existing edge, not as
// a large graph node. Sats influence intensity and label value; size stays
// deliberately small so the route remains legible in dense Sigma views.

import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

const DEFAULT_DURATION_MS = 1350
const MIN_RADIUS_PX = 2.4
const MAX_RADIUS_PX = 5.8
const TAIL_COUNT = 9
const ROUTE_WIDTH_PX = 1.15
const ENERGY_COLOR = '#ffd86b'
const ENERGY_HOT_COLOR = '#fff4bf'
const ENERGY_SHADOW_COLOR = '#f2994a'

export interface ViewportPositionResolver {
  (pubkey: string): { x: number; y: number } | null
}

interface ActiveElectron {
  fromPubkey: string
  toPubkey: string
  radiusPx: number
  label: string
  startMs: number
  durationMs: number
  flickerSeed: number
}

export function satsToRadiusPx(sats: number): number {
  if (!Number.isFinite(sats) || sats <= 0) return MIN_RADIUS_PX
  const raw = 2.4 + Math.log10(sats + 1) * 0.72
  return Math.min(Math.max(raw, MIN_RADIUS_PX), MAX_RADIUS_PX)
}

export class ZapElectronOverlay {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver | null = null
  private animations: ActiveElectron[] = []
  private rafId: number | null = null
  private disposed = false
  private devicePixelRatio = 1

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
    canvas.setAttribute('data-zap-overlay', 'true')

    const containerStyle = getComputedStyle(container)
    if (containerStyle.position === 'static') {
      container.style.position = 'relative'
    }

    container.appendChild(canvas)
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('ZapElectronOverlay: failed to acquire 2D context')
    }
    this.ctx = ctx
    this.resize()

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(container)
    }
  }

  public play(zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>): boolean {
    if (this.disposed) return false
    // Visibility/connection checks are the caller's responsibility, but we
    // re-verify positions are resolvable: if either endpoint can't be projected
    // there's nothing to animate.
    if (!this.getCssViewportPosition(zap.fromPubkey)) return false
    if (!this.getCssViewportPosition(zap.toPubkey)) return false

    this.animations.push({
      fromPubkey: zap.fromPubkey,
      toPubkey: zap.toPubkey,
      radiusPx: satsToRadiusPx(zap.sats),
      label: formatSatsLabel(zap.sats),
      startMs: performance.now(),
      durationMs: DEFAULT_DURATION_MS,
      flickerSeed: Math.random() * Math.PI * 2,
    })
    this.ensureTicking()
    return true
  }

  public dispose(): void {
    this.disposed = true
    this.animations = []
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.resizeObserver?.disconnect()
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas)
    }
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect()
    const dpr = Math.max(window.devicePixelRatio || 1, 1)
    this.devicePixelRatio = dpr
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private ensureTicking(): void {
    if (this.rafId !== null || this.disposed) return
    this.rafId = requestAnimationFrame(this.tick)
  }

  private readonly tick = (timestamp: number) => {
    this.rafId = null
    if (this.disposed) return

    const ctx = this.ctx
    const widthCss = this.canvas.width / this.devicePixelRatio
    const heightCss = this.canvas.height / this.devicePixelRatio
    ctx.clearRect(0, 0, widthCss, heightCss)

    const next: ActiveElectron[] = []
    for (const anim of this.animations) {
      const elapsed = timestamp - anim.startMs
      if (elapsed >= anim.durationMs) continue

      const from = this.getCssViewportPosition(anim.fromPubkey)
      const to = this.getCssViewportPosition(anim.toPubkey)
      // If a node left the viewport/graph mid-flight, drop the animation so we
      // never paint on stale or offscreen positions.
      if (!from || !to) continue

      const progress = Math.min(1, Math.max(0, elapsed / anim.durationMs))
      this.drawElectron(ctx, from, to, progress, anim)
      next.push(anim)
    }

    this.animations = next
    if (this.animations.length > 0) {
      this.ensureTicking()
    }
  }

  private drawElectron(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    progress: number,
    anim: ActiveElectron,
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

    this.drawEnergyRoute(ctx, from, to, lifeAlpha)
    this.drawEnergyTail(ctx, from, dx, dy, eased, progress, anim, lifeAlpha)
    this.drawEnergyCore(ctx, x, y, anim.radiusPx, lifeAlpha, flicker)
    this.drawArrivalPulse(ctx, to, progress, anim.radiusPx)

    ctx.restore()

    this.drawAmountLabel(ctx, anim.label, x, y, nx, ny, progress, lifeAlpha)
  }

  private drawEnergyRoute(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    lifeAlpha: number,
  ): void {
    ctx.globalAlpha = 0.22 * lifeAlpha
    ctx.strokeStyle = ENERGY_COLOR
    ctx.lineWidth = ROUTE_WIDTH_PX
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  private drawEnergyTail(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    dx: number,
    dy: number,
    eased: number,
    progress: number,
    anim: ActiveElectron,
    lifeAlpha: number,
  ): void {
    const tailLength = 0.22
    const tailStart = Math.max(0, eased - tailLength)
    const tailEndX = from.x + dx * eased
    const tailEndY = from.y + dy * eased
    const tailStartX = from.x + dx * tailStart
    const tailStartY = from.y + dy * tailStart
    const gradient = ctx.createLinearGradient(tailStartX, tailStartY, tailEndX, tailEndY)
    gradient.addColorStop(0, 'rgba(242, 153, 74, 0)')
    gradient.addColorStop(0.68, 'rgba(255, 216, 107, 0.42)')
    gradient.addColorStop(1, 'rgba(255, 246, 207, 0.98)')

    ctx.globalAlpha = lifeAlpha
    ctx.strokeStyle = gradient
    ctx.lineWidth = Math.max(ROUTE_WIDTH_PX, anim.radiusPx * 0.78)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(tailStartX, tailStartY)
    ctx.lineTo(tailEndX, tailEndY)
    ctx.stroke()

    for (let i = TAIL_COUNT; i >= 1; i -= 1) {
      const t = Math.max(0, eased - i * 0.018)
      const sparkX = from.x + dx * t
      const sparkY = from.y + dy * t
      const alpha = ((TAIL_COUNT - i + 1) / TAIL_COUNT) * 0.28 * lifeAlpha * (1 - progress * 0.28)
      const radius = Math.max(0.85, anim.radiusPx * (0.2 + (TAIL_COUNT - i) * 0.035))

      ctx.globalAlpha = alpha
      ctx.fillStyle = i % 2 === 0 ? ENERGY_COLOR : ENERGY_SHADOW_COLOR
      ctx.beginPath()
      ctx.arc(sparkX, sparkY, radius, 0, Math.PI * 2)
      ctx.fill()
    }
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
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius)
    glow.addColorStop(0, 'rgba(255, 246, 207, 0.95)')
    glow.addColorStop(0.32, 'rgba(255, 216, 107, 0.58)')
    glow.addColorStop(1, 'rgba(242, 153, 74, 0)')

    ctx.globalAlpha = 0.88 * lifeAlpha
    ctx.beginPath()
    ctx.fillStyle = glow
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = lifeAlpha
    ctx.beginPath()
    ctx.fillStyle = ENERGY_HOT_COLOR
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 0.75 * lifeAlpha
    ctx.strokeStyle = ENERGY_COLOR
    ctx.lineWidth = 0.9
    ctx.stroke()
  }

  private drawArrivalPulse(
    ctx: CanvasRenderingContext2D,
    to: { x: number; y: number },
    progress: number,
    radiusPx: number,
  ): void {
    const pulse = smoothstep(0.74, 1, progress)
    if (pulse <= 0) return

    const alpha = (1 - pulse) * 0.48
    const radius = radiusPx * 1.8 + pulse * 18

    ctx.globalAlpha = alpha
    ctx.strokeStyle = ENERGY_COLOR
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(to.x, to.y, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  private drawAmountLabel(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    nx: number,
    ny: number,
    progress: number,
    lifeAlpha: number,
  ): void {
    const labelAlpha = lifeAlpha * (1 - smoothstep(0.7, 1, progress))
    if (labelAlpha <= 0.02) return

    const offset = 12
    ctx.save()
    ctx.globalAlpha = labelAlpha
    ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
    ctx.shadowBlur = 5
    ctx.fillStyle = ENERGY_COLOR
    ctx.fillText(label, x + nx * offset, y + ny * offset - 4)
    ctx.restore()
  }
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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
