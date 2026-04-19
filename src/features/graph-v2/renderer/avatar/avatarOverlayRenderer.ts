import type Sigma from 'sigma'

import {
  applyImageBucketHysteresis,
  isSafeAvatarUrl,
  type ImageLodBucket,
} from '@/features/graph-v2/renderer/avatar/avatarImageUtils'

import type {
  AvatarBitmapCache,
  MonogramInput,
} from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import type {
  AvatarCandidate,
  AvatarScheduler,
} from '@/features/graph-v2/renderer/avatar/avatarScheduler'
import type { PerfBudget } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type {
  AvatarBudget,
  AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import type {
  RenderEdgeAttributes,
  RenderNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const AVATAR_NODE_INSET_PX = 1
const FORCED_AVATAR_MIN_RADIUS_PX = 18
const ZOOMED_OUT_MONOGRAM_MIN_RADIUS_PX = 11
const MAX_VELOCITY_DELTA_MS = 250

interface AvatarDrawSelectionItem {
  pubkey: string
  r: number
  priority: number
  isPersistentAvatar?: boolean
}

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
  monogramOnly: boolean
  isPersistentAvatar: boolean
  priority: number
  monogramInput: MonogramInput
  monogramCanvas: HTMLCanvasElement
}

export interface AvatarOverlayRendererDeps {
  sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>
  cache: AvatarBitmapCache
  scheduler: AvatarScheduler
  budget: PerfBudget
  isMoving: () => boolean
  getForcedAvatarPubkey?: () => string | null
  getRuntimeOptions?: () => AvatarRuntimeOptions
}

const buildUrlKey = (pubkey: string, url: string): string => `${pubkey}::${url}`

export const selectAvatarDrawItemsForFrame = <
  T extends AvatarDrawSelectionItem,
>(
  items: T[],
  cap: number,
  forcedPubkey: string | null,
): T[] => {
  const forcedItem = forcedPubkey
    ? (items.find((item) => item.pubkey === forcedPubkey) ?? null)
    : null
  const persistentItems = items.filter(
    (item) =>
      item.isPersistentAvatar && item.pubkey !== forcedItem?.pubkey,
  )
  const persistentPubkeys = new Set(
    persistentItems.map((item) => item.pubkey),
  )
  if (forcedItem) {
    persistentPubkeys.add(forcedItem.pubkey)
  }
  const selectableItems = items.filter(
    (item) => !persistentPubkeys.has(item.pubkey),
  )
  const normalizedCap = Math.max(0, cap)
  const selected =
    selectableItems.length <= normalizedCap
      ? selectableItems
      : [...selectableItems]
          .sort((a, b) => {
            const priorityDelta = a.priority - b.priority
            if (priorityDelta !== 0) {
              return priorityDelta
            }
            return b.r - a.r
          })
          .slice(0, normalizedCap)

  return forcedItem
    ? [...selected, ...persistentItems, forcedItem]
    : [...selected, ...persistentItems]
}

export class AvatarOverlayRenderer {
  private readonly sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>
  private readonly cache: AvatarBitmapCache
  private readonly scheduler: AvatarScheduler
  private readonly budget: PerfBudget
  private readonly isMoving: () => boolean
  private readonly getForcedAvatarPubkey: () => string | null
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
    this.getForcedAvatarPubkey = deps.getForcedAvatarPubkey ?? (() => null)
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

    const forcedAvatarPubkey = this.getForcedAvatarPubkey()
    const moving = this.isMoving()

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
      const forcedAvatar = pubkey === forcedAvatarPubkey
      const nodeAttrs = attrs as RenderNodeAttributes
      const isPersistentAvatar =
        forcedAvatar ||
        nodeAttrs.isRoot ||
        nodeAttrs.isPinned ||
        nodeAttrs.isSelected
      if (nodeAttrs.hidden) {
        return
      }
      const display = this.sigma.getNodeDisplayData(pubkey)
      if (!display) {
        return
      }
      const nodeRadiusPx = this.sigma.scaleSize(display.size, cameraRatio)
      const avatarRadiusPx = Math.max(0, nodeRadiusPx - AVATAR_NODE_INSET_PX)
      const zoomedOutMonogram = avatarRadiusPx < budget.sizeThreshold
      if (
        !budget.showZoomedOutMonograms &&
        !isPersistentAvatar &&
        zoomedOutMonogram
      ) {
        return
      }
      const drawRadiusPx = isPersistentAvatar
        ? Math.max(avatarRadiusPx, FORCED_AVATAR_MIN_RADIUS_PX)
        : zoomedOutMonogram
          ? ZOOMED_OUT_MONOGRAM_MIN_RADIUS_PX
          : avatarRadiusPx
      const viewport = this.sigma.framedGraphToViewport(display)
      if (!this.isInViewport(viewport.x, viewport.y, drawRadiusPx)) {
        return
      }
      seenNodes.add(pubkey)
      const fastMoving =
        !isPersistentAvatar &&
        this.isFastMovingNode(
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
        paletteKey: pubkey,
      }
      const priority = resolvePriority(nodeAttrs, viewport, this.sigma)
      drawItems.push({
        pubkey,
        x: viewport.x,
        y: viewport.y,
        r: drawRadiusPx,
        url: nodeAttrs.pictureUrl,
        fastMoving,
        monogramOnly: !isPersistentAvatar && zoomedOutMonogram,
        isPersistentAvatar,
        priority,
        monogramInput,
        monogramCanvas: this.cache.getMonogram(pubkey, monogramInput),
      })
    })

    const candidates: AvatarCandidate[] = []
    let imageDrawCount = 0
    const selectedDrawItems = selectAvatarDrawItemsForFrame(
      drawItems,
      budget.maxAvatarDrawsPerFrame,
      forcedAvatarPubkey,
    )
    const selectedPubkeys = new Set(
      selectedDrawItems.map((item) => item.pubkey),
    )
    const selectedOrder = new Map(
      selectedDrawItems.map((item, index) => [item.pubkey, index]),
    )
    const unselectedDrawItems = drawItems.filter(
      (item) => !selectedPubkeys.has(item.pubkey),
    )
    const orderedDrawItems = budget.showZoomedOutMonograms
      ? [
          ...unselectedDrawItems,
          ...selectedDrawItems,
        ].sort((a, b) => {
          const aOrder = selectedOrder.get(a.pubkey)
          const bOrder = selectedOrder.get(b.pubkey)
          if (aOrder !== undefined && bOrder !== undefined) {
            return aOrder - bOrder
          }
          if (aOrder !== undefined) return 1
          if (bOrder !== undefined) return -1
          return b.priority - a.priority
        })
      : selectedDrawItems

    for (const item of orderedDrawItems) {
      const isPersistentAvatar = item.isPersistentAvatar
      const selectedForImage = selectedPubkeys.has(item.pubkey)
      const disableImage =
        !selectedForImage ||
        (!isPersistentAvatar &&
          (moving ||
            item.monogramOnly ||
            item.fastMoving ||
            imageDrawCount >= budget.maxImageDrawsPerFrame))
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

      if (!isPersistentAvatar && item.fastMoving) {
        continue
      }
      if (!selectedForImage) {
        continue
      }
      if (!isPersistentAvatar && item.monogramOnly) {
        continue
      }
      if (!isPersistentAvatar && cameraRatio > budget.zoomThreshold) {
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
        urgent: isPersistentAvatar,
        monogram: item.monogramInput,
      })
    }

    this.pruneMotionSamples(seenNodes)
    if (moving) {
      this.scheduler.prime(candidates, budget)
      return
    }
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
        showZoomedOutMonograms: true,
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
      showZoomedOutMonograms: runtimeOptions.showZoomedOutMonograms,
      hideImagesOnFastNodes:
        runtimeOptions.hideImagesOnFastNodes || snapshot.isDegraded,
      fastNodeVelocityThreshold: snapshot.isDegraded
        ? Math.min(runtimeOptions.fastNodeVelocityThreshold, 180)
        : runtimeOptions.fastNodeVelocityThreshold,
    }
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
  attrs: RenderNodeAttributes,
  viewport: { x: number; y: number },
  sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>,
): number => {
  if (attrs.isRoot) return 0
  if (attrs.isPinned) return 1
  if (attrs.isSelected) return 2
  if (attrs.isNeighbor) return 3
  const container = sigma.getContainer()
  const cx = container.clientWidth / 2
  const cy = container.clientHeight / 2
  const dx = viewport.x - cx
  const dy = viewport.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  return 4 + dist
}
