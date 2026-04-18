import type Sigma from 'sigma'

import {
  applyImageBucketHysteresis,
  isSafeAvatarUrl,
  type ImageLodBucket,
} from '@/features/graph/render/avatar'

import type { AvatarBitmapCache, MonogramInput } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import type { AvatarCandidate, AvatarScheduler } from '@/features/graph-v2/renderer/avatar/avatarScheduler'
import type { PerfBudget } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type {
  AvatarBudget,
  AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const AVATAR_NODE_INSET_PX = 1
const MAX_VELOCITY_DELTA_MS = 250

interface AvatarNodeMotionSample {
  x: number
  y: number
  t: number
}

type EffectiveAvatarBudget = AvatarBudget & AvatarRuntimeOptions

interface AvatarDrawItem {
  pubkey: string
  x: number
  y: number
  r: number
  url: string | null
  fastMoving: boolean
  priority: number
  monogramInput: MonogramInput
  monogramCanvas: HTMLCanvasElement
}

export interface AvatarOverlayRendererDeps {
  sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>
  cache: AvatarBitmapCache
  scheduler: AvatarScheduler
  budget: PerfBudget
  isMoving: () => boolean
  getRuntimeOptions?: () => AvatarRuntimeOptions
}

const buildUrlKey = (pubkey: string, url: string): string => `${pubkey}::${url}`

export class AvatarOverlayRenderer {
  private readonly sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>
  private readonly cache: AvatarBitmapCache
  private readonly scheduler: AvatarScheduler
  private readonly budget: PerfBudget
  private readonly isMoving: () => boolean
  private readonly getRuntimeOptions: () => AvatarRuntimeOptions | null
  private readonly lastBucketByUrl = new Map<string, ImageLodBucket>()
  private readonly lastMotionByNode = new Map<string, AvatarNodeMotionSample>()
  private lastFrameTs = 0
  private lastCameraSignature: string | null = null
  private readonly boundAfterRender: () => void
  private disposed = false

  constructor(deps: AvatarOverlayRendererDeps) {
    this.sigma = deps.sigma
    this.cache = deps.cache
    this.scheduler = deps.scheduler
    this.budget = deps.budget
    this.isMoving = deps.isMoving
    this.getRuntimeOptions = deps.getRuntimeOptions ?? (() => null)
    this.boundAfterRender = () => this.onAfterRender()
    this.sigma.on('afterRender', this.boundAfterRender)
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    this.sigma.off('afterRender', this.boundAfterRender)
  }

  private onAfterRender() {
    if (this.disposed) {
      return
    }
    const nowMs = performance.now()
    if (this.lastFrameTs > 0) {
      this.budget.recordFrame(nowMs - this.lastFrameTs)
    }
    this.lastFrameTs = nowMs

    const budget = this.resolveRuntimeBudget()
    if (!budget.drawAvatars) {
      return
    }
    this.cache.setCap(budget.lruCap)

    const ctx = this.getOverlayContext()
    if (!ctx) {
      return
    }

    if (this.isMoving()) {
      return
    }

    const cameraState = this.sigma.getCamera().getState()
    const cameraRatio = cameraState.ratio
    const cameraSignature = [
      cameraState.x,
      cameraState.y,
      cameraState.ratio,
      cameraState.angle,
    ].join('|')
    const cameraChanged =
      this.lastCameraSignature !== null &&
      this.lastCameraSignature !== cameraSignature
    this.lastCameraSignature = cameraSignature
    const graph = this.sigma.getGraph()
    const drawItems: AvatarDrawItem[] = []
    const seenNodes = new Set<string>()

    graph.forEachNode((pubkey, attrs) => {
      const nodeAttrs = attrs as SigmaNodeAttributes
      if (nodeAttrs.hidden) {
        return
      }
      const display = this.sigma.getNodeDisplayData(pubkey)
      if (!display) {
        return
      }
      const nodeRadiusPx = this.sigma.scaleSize(display.size, cameraRatio)
      const avatarRadiusPx = Math.max(0, nodeRadiusPx - AVATAR_NODE_INSET_PX)
      if (avatarRadiusPx < budget.sizeThreshold) {
        return
      }
      const viewport = this.sigma.framedGraphToViewport(display)
      if (!this.isInViewport(viewport.x, viewport.y, avatarRadiusPx)) {
        return
      }
      seenNodes.add(pubkey)
      const fastMoving = this.isFastMovingNode(
        pubkey,
        viewport.x,
        viewport.y,
        nowMs,
        budget,
        cameraChanged,
      )

      const monogramInput: MonogramInput = {
        label: nodeAttrs.label || pubkey.slice(0, 2),
        color: nodeAttrs.color || '#7dd3a7',
      }
      const priority = resolvePriority(nodeAttrs, viewport, this.sigma)
      drawItems.push({
        pubkey,
        x: viewport.x,
        y: viewport.y,
        r: avatarRadiusPx,
        url: nodeAttrs.pictureUrl,
        fastMoving,
        priority,
        monogramInput,
        monogramCanvas: this.cache.getMonogram(pubkey, monogramInput),
      })
    })

    const candidates: AvatarCandidate[] = []
    let imageDrawCount = 0
    const selectedDrawItems = this.selectDrawItems(drawItems, budget)

    for (const item of selectedDrawItems) {
      const disableImage =
        item.fastMoving || imageDrawCount >= budget.maxImageDrawsPerFrame
      const drewImage = this.drawAvatarCircle({
        ctx,
        x: item.x,
        y: item.y,
        r: item.r,
        monogram: item.monogramCanvas,
        pubkey: item.pubkey,
        url: item.url,
        disableImage,
      })
      if (drewImage) {
        imageDrawCount += 1
      }

      if (item.fastMoving) {
        continue
      }
      if (cameraRatio > budget.zoomThreshold) {
        continue
      }
      if (!item.url || !isSafeAvatarUrl(item.url)) {
        continue
      }
      const url = item.url
      const urlKey = buildUrlKey(item.pubkey, url)
      const bucket = this.resolveBucket(
        urlKey,
        item.r * 2,
        budget.maxBucket,
      )

      candidates.push({
        pubkey: item.pubkey,
        urlKey,
        url,
        bucket,
        priority: item.priority,
        monogram: item.monogramInput,
      })
    }

    this.pruneMotionSamples(seenNodes)
    this.scheduler.reconcile(candidates, budget)
  }

  private drawAvatarCircle({
    ctx,
    x,
    y,
    r,
    monogram,
    pubkey,
    url,
    disableImage,
  }: {
    ctx: CanvasRenderingContext2D
    x: number
    y: number
    r: number
    monogram: HTMLCanvasElement
    pubkey: string
    url: string | null
    disableImage?: boolean
  }): boolean {
    let drawable: CanvasImageSource = monogram
    let isImage = false
    if (url && !disableImage) {
      const urlKey = buildUrlKey(pubkey, url)
      const entry = this.cache.get(urlKey)
      if (entry && entry.state === 'ready') {
        drawable = entry.bitmap
        isImage = true
      }
    }
    const size = r * 2
    try {
      ctx.drawImage(drawable, x - r, y - r, size, size)
      return isImage
    } catch {
      if (isImage) {
        try {
          ctx.drawImage(monogram, x - r, y - r, size, size)
        } catch {
          // canvas source may be invalidated; fall back silently
        }
      }
      return false
    }
  }

  private resolveRuntimeBudget(): EffectiveAvatarBudget {
    const snapshot = this.budget.snapshot()
    const budget = snapshot.budget
    const runtimeOptions = this.getRuntimeOptions()
    if (!runtimeOptions) {
      return {
        ...budget,
        hideImagesOnFastNodes: false,
        fastNodeVelocityThreshold: Number.POSITIVE_INFINITY,
      }
    }
    const adaptiveVisualsActive = snapshot.isDegraded || budget.maxBucket <= 64
    return {
      ...budget,
      sizeThreshold: adaptiveVisualsActive
        ? Math.max(runtimeOptions.sizeThreshold, budget.sizeThreshold)
        : runtimeOptions.sizeThreshold,
      zoomThreshold: adaptiveVisualsActive
        ? Math.min(runtimeOptions.zoomThreshold, budget.zoomThreshold)
        : runtimeOptions.zoomThreshold,
      hideImagesOnFastNodes:
        runtimeOptions.hideImagesOnFastNodes || snapshot.isDegraded,
      fastNodeVelocityThreshold: snapshot.isDegraded
        ? Math.min(runtimeOptions.fastNodeVelocityThreshold, 180)
        : runtimeOptions.fastNodeVelocityThreshold,
    }
  }

  private selectDrawItems(
    items: AvatarDrawItem[],
    budget: EffectiveAvatarBudget,
  ): AvatarDrawItem[] {
    const cap = Math.max(0, budget.maxAvatarDrawsPerFrame)
    if (cap <= 0) {
      return []
    }
    if (items.length <= cap) {
      return items
    }
    return [...items]
      .sort((a, b) => {
        const priorityDelta = a.priority - b.priority
        if (priorityDelta !== 0) {
          return priorityDelta
        }
        return b.r - a.r
      })
      .slice(0, cap)
  }

  private isFastMovingNode(
    pubkey: string,
    x: number,
    y: number,
    nowMs: number,
    budget: EffectiveAvatarBudget,
    cameraChanged: boolean,
  ): boolean {
    const previous = this.lastMotionByNode.get(pubkey)
    this.lastMotionByNode.set(pubkey, { x, y, t: nowMs })

    if (!budget.hideImagesOnFastNodes || !previous || cameraChanged) {
      return false
    }

    const deltaMs = Math.min(nowMs - previous.t, MAX_VELOCITY_DELTA_MS)
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return false
    }

    const dx = x - previous.x
    const dy = y - previous.y
    const velocityPxPerSecond = Math.sqrt(dx * dx + dy * dy) / (deltaMs / 1000)
    return velocityPxPerSecond > budget.fastNodeVelocityThreshold
  }

  private pruneMotionSamples(seenNodes: ReadonlySet<string>) {
    for (const pubkey of this.lastMotionByNode.keys()) {
      if (!seenNodes.has(pubkey)) {
        this.lastMotionByNode.delete(pubkey)
      }
    }
  }

  private resolveBucket(
    urlKey: string,
    requestedPixels: number,
    maxBucket: ImageLodBucket,
  ): ImageLodBucket {
    const previous = this.lastBucketByUrl.get(urlKey) ?? null
    const next = applyImageBucketHysteresis({
      previousBucket: previous,
      requestedPixels,
    })
    const clamped = Math.min(next, maxBucket) as ImageLodBucket
    this.lastBucketByUrl.set(urlKey, clamped)
    return clamped
  }

  private isInViewport(x: number, y: number, r: number): boolean {
    const container = this.sigma.getContainer()
    const w = container.clientWidth
    const h = container.clientHeight
    return x + r >= 0 && x - r <= w && y + r >= 0 && y - r <= h
  }

  private getOverlayContext(): CanvasRenderingContext2D | null {
    const canvases = this.sigma.getCanvases()
    const labels = canvases.labels ?? canvases.mouse ?? null
    if (!labels) {
      return null
    }
    return labels.getContext('2d')
  }
}

const resolvePriority = (
  attrs: SigmaNodeAttributes,
  viewport: { x: number; y: number },
  sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
): number => {
  if (attrs.isRoot) return 0
  if (attrs.isSelected) return 1
  if (attrs.isNeighbor) return 2
  const container = sigma.getContainer()
  const cx = container.clientWidth / 2
  const cy = container.clientHeight / 2
  const dx = viewport.x - cx
  const dy = viewport.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  return 3 + dist
}
