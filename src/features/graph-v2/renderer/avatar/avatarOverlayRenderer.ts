import type Sigma from 'sigma'

import {
  applyImageBucketHysteresis,
  buildAvatarUrlKey,
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
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarBudget,
  type AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import type {
  RenderEdgeAttributes,
  RenderNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const AVATAR_NODE_INSET_PX = 1
const FORCED_AVATAR_MIN_RADIUS_PX = 18
const ZOOMED_OUT_MONOGRAM_MIN_RADIUS_PX = 11
const MAX_VELOCITY_DELTA_MS = 250
const FULL_CIRCLE_RADIANS = Math.PI * 2
const FOCUS_AURA_RING_GAP_PX = 3
const FOCUS_AURA_OUTER_LINE_WIDTH_FACTOR = 0.42
const FOCUS_AURA_INNER_LINE_WIDTH_FACTOR = 0.14
const FOCUS_AURA_OUTER_ALPHA = 0.22
const FOCUS_AURA_INNER_ALPHA = 0.52
const EMPTY_SET = new Set<string>()
interface AvatarDrawSelectionItem {
  pubkey: string
  r: number
  priority: number
  isPersistentAvatar?: boolean
}

interface FocusAuraItem {
  pubkey: string
  x: number
  y: number
  r: number
  color: string
}

interface AvatarRevealSelectionItem {
  pubkey: string
  distanceSquared: number
}

interface AvatarNodeMotionSample {
  x: number
  y: number
  t: number
}

type AvatarRevealPointer = { x: number; y: number }

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
  zoomedOutMonogram: boolean
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
  getHoveredNeighborPubkeys?: () => ReadonlySet<string>
  getAvatarRevealPointer?: () => AvatarRevealPointer | null
  getRuntimeOptions?: () => AvatarRuntimeOptions
}

interface AvatarImageSelectionItem {
  pubkey: string
  url: string | null
}

export const retainInflightAvatarPubkeys = <
  T extends AvatarImageSelectionItem,
>(
  items: readonly T[],
  selectedPubkeys: ReadonlySet<string>,
  hasInflight: (urlKey: string) => boolean,
) => {
  const retainedPubkeys = new Set(selectedPubkeys)

  for (const item of items) {
    if (!item.url || retainedPubkeys.has(item.pubkey)) {
      continue
    }

    if (hasInflight(buildAvatarUrlKey(item.pubkey, item.url))) {
      retainedPubkeys.add(item.pubkey)
    }
  }

  return retainedPubkeys
}

const withAlpha = (color: string, alpha: number) => {
  const normalized = color.trim()
  const match = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)
  if (!match) {
    return `rgba(244, 251, 255, ${alpha})`
  }

  const hex = match[1]!.toLowerCase()
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex
  const red = Number.parseInt(expanded.slice(0, 2), 16)
  const green = Number.parseInt(expanded.slice(2, 4), 16)
  const blue = Number.parseInt(expanded.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

const resolveRevealDistanceSquared = (
  node: AvatarRevealPointer,
  pointer: AvatarRevealPointer,
) => {
  const dx = node.x - pointer.x
  const dy = node.y - pointer.y
  return dx * dx + dy * dy
}

export const resolveAvatarDrawRadiusPx = ({
  avatarRadiusPx,
  hasPriorityAvatarSizing,
  zoomedOutMonogram,
}: {
  avatarRadiusPx: number
  hasPriorityAvatarSizing: boolean
  zoomedOutMonogram: boolean
}) =>
  hasPriorityAvatarSizing
    ? Math.max(avatarRadiusPx, FORCED_AVATAR_MIN_RADIUS_PX)
    : avatarRadiusPx > 0
      ? avatarRadiusPx
      : zoomedOutMonogram
        ? ZOOMED_OUT_MONOGRAM_MIN_RADIUS_PX
        : avatarRadiusPx

export const selectAvatarDrawItemsForFrame = <
  T extends AvatarDrawSelectionItem,
>(
  items: T[],
  cap: number,
  forcedPubkeys: ReadonlySet<string>,
): T[] => {
  const forcedItems = items.filter((item) => forcedPubkeys.has(item.pubkey))
  const persistentItems = items.filter(
    (item) =>
      item.isPersistentAvatar && !forcedPubkeys.has(item.pubkey),
  )
  const persistentPubkeys = new Set(
    persistentItems.map((item) => item.pubkey),
  )
  for (const item of forcedItems) {
    persistentPubkeys.add(item.pubkey)
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

  return [...selected, ...persistentItems, ...forcedItems]
}

export const selectClosestAvatarRevealPubkeys = <
  T extends AvatarRevealSelectionItem,
>(
  candidates: T[],
  cap: number,
): string[] => {
  const normalizedCap = Number.isFinite(cap)
    ? Math.max(0, Math.floor(cap))
    : 0
  if (normalizedCap === 0 || candidates.length === 0) {
    return []
  }

  const selected: T[] = []
  for (const candidate of candidates) {
    const insertIndex = selected.findIndex((item) => {
      if (candidate.distanceSquared !== item.distanceSquared) {
        return candidate.distanceSquared < item.distanceSquared
      }
      return candidate.pubkey < item.pubkey
    })

    if (insertIndex === -1) {
      if (selected.length < normalizedCap) {
        selected.push(candidate)
      }
      continue
    }

    selected.splice(insertIndex, 0, candidate)
    if (selected.length > normalizedCap) {
      selected.pop()
    }
  }

  return selected.map((item) => item.pubkey)
}

export const selectAvatarDrawContext = <T>(
  itemPubkey: string,
  forcedPubkeys: ReadonlySet<string>,
  baseContext: T,
  forcedContext: T | null,
) =>
  forcedPubkeys.has(itemPubkey) && forcedContext
    ? forcedContext
    : baseContext

export const shouldDisableAvatarImage = ({
  selectedForImage,
  globalMotionActive,
  monogramOnly,
  fastMoving,
  imageDrawCount,
  maxImageDrawsPerFrame,
}: {
  selectedForImage: boolean
  globalMotionActive: boolean
  monogramOnly: boolean
  fastMoving: boolean
  imageDrawCount: number
  maxImageDrawsPerFrame: number
}) =>
  !selectedForImage ||
  globalMotionActive ||
  monogramOnly ||
  fastMoving ||
  imageDrawCount >= maxImageDrawsPerFrame

export const resolveAvatarFrameDrawCap = ({
  baseCap,
  visibleCount,
  showAllVisibleImages,
}: {
  baseCap: number
  visibleCount: number
  showAllVisibleImages: boolean
}) =>
  showAllVisibleImages
    ? Math.max(Math.max(0, Math.floor(baseCap)), Math.max(0, Math.floor(visibleCount)))
    : Math.max(0, Math.floor(baseCap))

export const resolveAvatarCacheCap = ({
  baseCap,
  visiblePhotoCount,
  showAllVisibleImages,
}: {
  baseCap: number
  visiblePhotoCount: number
  showAllVisibleImages: boolean
}) =>
  showAllVisibleImages
    ? Math.max(Math.max(16, Math.floor(baseCap)), Math.max(0, Math.floor(visiblePhotoCount)))
    : Math.max(16, Math.floor(baseCap))

export class AvatarOverlayRenderer {
  private readonly sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>
  private readonly cache: AvatarBitmapCache
  private readonly scheduler: AvatarScheduler
  private readonly budget: PerfBudget
  private readonly isMoving: () => boolean
  private readonly getForcedAvatarPubkey: () => string | null
  private readonly getHoveredNeighborPubkeys: () => ReadonlySet<string>
  private readonly getAvatarRevealPointer: () => AvatarRevealPointer | null
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
    this.getHoveredNeighborPubkeys = deps.getHoveredNeighborPubkeys ?? (() => EMPTY_SET)
    this.getAvatarRevealPointer = deps.getAvatarRevealPointer ?? (() => null)
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
    const forcedCtx = this.getForcedOverlayContext()
    if (forcedCtx) {
      this.clearForcedOverlayContext(forcedCtx)
    }
    const ctx = this.getOverlayContext()
    if (!ctx) {
      return
    }

    const directForcedAvatarPubkey = this.getForcedAvatarPubkey()
    const forcedAvatarPubkeys = new Set<string>()
    if (directForcedAvatarPubkey) {
      forcedAvatarPubkeys.add(directForcedAvatarPubkey)
    }
    const revealPointer = this.getAvatarRevealPointer()
    const revealRadiusPx = Math.max(0, budget.hoverRevealRadiusPx)
    const revealRadiusSquared = revealRadiusPx * revealRadiusPx
    const moving = this.isMoving()
    const hoveredNeighborPubkeys = this.getHoveredNeighborPubkeys()
    const allowZoomedOutImages =
      budget.allowZoomedOutImages || budget.showAllVisibleImages

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
    const focusAuraItems: FocusAuraItem[] = []
    const revealCandidates: AvatarRevealSelectionItem[] = []
    const seenNodes = new Set<string>()

    graph.forEachNode((pubkey, attrs) => {
      const nodeAttrs = attrs as RenderNodeAttributes
      if (nodeAttrs.hidden) {
        return
      }
      const display = this.sigma.getNodeDisplayData(pubkey)
      if (!display) {
        return
      }
      const nodeRadiusPx = this.sigma.scaleSize(display.size, cameraRatio)
      const avatarRadiusPx = Math.max(0, nodeRadiusPx - AVATAR_NODE_INSET_PX)
      const viewport = this.sigma.framedGraphToViewport(display)
      let isRevealCandidate = false
      let revealDistanceSquared: number | null = null
      if (
        revealPointer &&
        revealRadiusPx > 0 &&
        pubkey !== directForcedAvatarPubkey
      ) {
        const distanceSquared = resolveRevealDistanceSquared(
          viewport,
          revealPointer,
        )
        if (distanceSquared <= revealRadiusSquared) {
          isRevealCandidate = true
          revealDistanceSquared = distanceSquared
        }
      }
      const isPersistentAvatar =
        forcedAvatarPubkeys.has(pubkey) ||
        nodeAttrs.isRoot ||
        nodeAttrs.isPinned ||
        nodeAttrs.isSelected
      const hasPriorityAvatarSizing =
        pubkey === directForcedAvatarPubkey ||
        nodeAttrs.isRoot ||
        nodeAttrs.isPinned ||
        nodeAttrs.isSelected
      const zoomedOutMonogram = avatarRadiusPx < budget.sizeThreshold
      const drawRadiusPx = resolveAvatarDrawRadiusPx({
        avatarRadiusPx,
        hasPriorityAvatarSizing,
        zoomedOutMonogram,
      })
      if (!this.isInViewport(viewport.x, viewport.y, drawRadiusPx)) {
        return
      }
      seenNodes.add(pubkey)
      if (
        nodeAttrs.focusState === 'neighbor' ||
        hoveredNeighborPubkeys.has(pubkey)
      ) {
        focusAuraItems.push({
          pubkey,
          x: viewport.x,
          y: viewport.y,
          r: Math.max(nodeRadiusPx, drawRadiusPx),
          color: nodeAttrs.color,
        })
      }
      if (!budget.drawAvatars) {
        return
      }
      if (
        !budget.showZoomedOutMonograms &&
        !allowZoomedOutImages &&
        !isPersistentAvatar &&
        !isRevealCandidate &&
        zoomedOutMonogram
      ) {
        return
      }
      if (revealDistanceSquared !== null) {
        revealCandidates.push({ pubkey, distanceSquared: revealDistanceSquared })
      }
      const fastMoving =
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
        showBackground: budget.showMonogramBackgrounds,
        showText: budget.showMonogramText,
      }
      const priority = resolvePriority(nodeAttrs, viewport, this.sigma)
      drawItems.push({
        pubkey,
        x: viewport.x,
        y: viewport.y,
        r: drawRadiusPx,
        url: nodeAttrs.pictureUrl,
        fastMoving,
        monogramOnly:
          !isPersistentAvatar &&
          zoomedOutMonogram &&
          !allowZoomedOutImages,
        isPersistentAvatar,
        zoomedOutMonogram,
        priority,
        monogramInput,
        monogramCanvas: this.cache.getMonogram(pubkey, monogramInput),
      })
    })

    this.drawFocusAuras(ctx, focusAuraItems)
    if (!budget.drawAvatars) {
      this.pruneMotionSamples(seenNodes)
      return
    }

    for (const pubkey of selectClosestAvatarRevealPubkeys(
      revealCandidates,
      budget.hoverRevealMaxNodes,
    )) {
      forcedAvatarPubkeys.add(pubkey)
    }

    const candidates: AvatarCandidate[] = []
    let imageDrawCount = 0
    const resolvedDrawItems = drawItems
      .map((item) => {
        const isPersistentAvatar =
          item.isPersistentAvatar || forcedAvatarPubkeys.has(item.pubkey)
        return {
          ...item,
          isPersistentAvatar,
          monogramOnly:
            !isPersistentAvatar &&
            item.zoomedOutMonogram &&
            !allowZoomedOutImages,
        }
      })
      .filter(
        (item) =>
          budget.showZoomedOutMonograms ||
          allowZoomedOutImages ||
          item.isPersistentAvatar ||
          !item.zoomedOutMonogram,
      )
    const visiblePhotoCount = resolvedDrawItems.filter(
      (item) => item.url && isSafeAvatarUrl(item.url),
    ).length
    this.cache.setCap(
      resolveAvatarCacheCap({
        baseCap: budget.lruCap,
        visiblePhotoCount,
        showAllVisibleImages: budget.showAllVisibleImages,
      }),
    )
    const selectedDrawItems = selectAvatarDrawItemsForFrame(
      resolvedDrawItems,
      resolveAvatarFrameDrawCap({
        baseCap: budget.maxAvatarDrawsPerFrame,
        visibleCount: resolvedDrawItems.length,
        showAllVisibleImages: budget.showAllVisibleImages,
      }),
      forcedAvatarPubkeys,
    )
    const selectedPubkeys = new Set(
      selectedDrawItems.map((item) => item.pubkey),
    )
    const selectedOrInflightPubkeys = retainInflightAvatarPubkeys(
      resolvedDrawItems,
      selectedPubkeys,
      (urlKey) => this.scheduler.hasInflight(urlKey),
    )
    const selectedOrder = new Map(
      selectedDrawItems.map((item, index) => [item.pubkey, index]),
    )
    const unselectedDrawItems = resolvedDrawItems.filter(
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
      const selectedForImage = selectedOrInflightPubkeys.has(item.pubkey)
      const hasVisibleMonogramPart =
        item.monogramInput.showBackground !== false ||
        item.monogramInput.showText !== false
      const disableImage = shouldDisableAvatarImage({
        selectedForImage,
        globalMotionActive: moving && !budget.showAllVisibleImages,
        monogramOnly: item.monogramOnly,
        fastMoving: item.fastMoving,
        imageDrawCount,
        maxImageDrawsPerFrame: resolveAvatarFrameDrawCap({
          baseCap: budget.maxImageDrawsPerFrame,
          visibleCount: visiblePhotoCount,
          showAllVisibleImages: budget.showAllVisibleImages,
        }),
      })
      const drewImage = this.drawAvatarCircle({
        ctx: selectAvatarDrawContext(
          item.pubkey,
          forcedAvatarPubkeys,
          ctx,
          forcedCtx,
        ),
        x: item.x,
        y: item.y,
        r: item.r,
        monogram: item.monogramCanvas,
        pubkey: item.pubkey,
        url: item.url,
        disableImage,
        hasVisibleMonogramPart,
      })
      if (drewImage) {
        imageDrawCount += 1
      }

      if (item.fastMoving && !budget.showAllVisibleImages) {
        continue
      }
      if (!selectedForImage) {
        continue
      }
      if (item.monogramOnly) {
        continue
      }
      if (!allowZoomedOutImages && cameraRatio > budget.zoomThreshold) {
        continue
      }
      if (!item.url || !isSafeAvatarUrl(item.url)) {
        continue
      }
      const url = item.url
      const urlKey = buildAvatarUrlKey(item.pubkey, url)
      const bucket = this.resolveBucket(
        urlKey,
        item.r * 2,
        Math.min(budget.maxBucket, budget.maxInteractiveBucket) as ImageLodBucket,
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
    if (moving && !budget.showAllVisibleImages) {
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
    hasVisibleMonogramPart,
  }: {
    ctx: CanvasRenderingContext2D
    x: number
    y: number
    r: number
    monogram: HTMLCanvasElement
    pubkey: string
    url: string | null
    disableImage?: boolean
    hasVisibleMonogramPart: boolean
  }): boolean {
    let drawable: CanvasImageSource = monogram
    let isImage = false
    if (url && !disableImage) {
      const urlKey = buildAvatarUrlKey(pubkey, url)
      const entry = this.cache.get(urlKey)
      if (entry && entry.state === 'ready') {
        drawable = entry.bitmap
        isImage = true
      }
    }
    if (!isImage && !hasVisibleMonogramPart) {
      return false
    }
    const size = r * 2
    try {
      ctx.drawImage(drawable, x - r, y - r, size, size)
      return isImage
    } catch {
      if (isImage && hasVisibleMonogramPart) {
        try {
          ctx.drawImage(monogram, x - r, y - r, size, size)
        } catch {
          // canvas source may be invalidated; fall back silently
        }
      }
      return false
    }
  }

  private drawFocusAuras(
    ctx: CanvasRenderingContext2D,
    items: readonly FocusAuraItem[],
  ) {
    const itemsByPubkey = new Map<string, FocusAuraItem>()
    for (const item of items) {
      itemsByPubkey.set(item.pubkey, item)
    }
    for (const item of itemsByPubkey.values()) {
      this.drawFocusAura(ctx, item)
    }
  }

  private drawFocusAura(
    ctx: CanvasRenderingContext2D,
    item: FocusAuraItem,
  ) {
    const innerLineWidth = Math.max(1.5, item.r * FOCUS_AURA_INNER_LINE_WIDTH_FACTOR)
    const outerLineWidth = Math.max(3, item.r * FOCUS_AURA_OUTER_LINE_WIDTH_FACTOR)
    const innerRadius = item.r + FOCUS_AURA_RING_GAP_PX
    const outerRadius =
      item.r +
      FOCUS_AURA_RING_GAP_PX +
      Math.max(innerLineWidth * 0.5, outerLineWidth * 0.45)

    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.beginPath()
    ctx.lineWidth = outerLineWidth
    ctx.strokeStyle = withAlpha(item.color, FOCUS_AURA_OUTER_ALPHA)
    ctx.arc(item.x, item.y, outerRadius, 0, FULL_CIRCLE_RADIANS)
    ctx.stroke()

    ctx.beginPath()
    ctx.lineWidth = innerLineWidth
    ctx.strokeStyle = withAlpha(item.color, FOCUS_AURA_INNER_ALPHA)
    ctx.arc(item.x, item.y, innerRadius, 0, FULL_CIRCLE_RADIANS)
    ctx.stroke()
    ctx.restore()
  }

  private resolveRuntimeBudget(): EffectiveAvatarBudget {
    const snapshot = this.budget.snapshot()
    const budget = snapshot.budget
    const runtimeOptions = this.getRuntimeOptions()
    if (!runtimeOptions) {
      return {
        ...budget,
        showZoomedOutMonograms: true,
        hoverRevealRadiusPx: DEFAULT_AVATAR_RUNTIME_OPTIONS.hoverRevealRadiusPx,
        hoverRevealMaxNodes: DEFAULT_AVATAR_RUNTIME_OPTIONS.hoverRevealMaxNodes,
        showMonogramBackgrounds: DEFAULT_AVATAR_RUNTIME_OPTIONS.showMonogramBackgrounds,
        showMonogramText: true,
        hideImagesOnFastNodes: false,
        fastNodeVelocityThreshold: Number.POSITIVE_INFINITY,
        allowZoomedOutImages: false,
        showAllVisibleImages: false,
        maxInteractiveBucket: budget.maxBucket,
        maxSocialCaptureBucket: DEFAULT_AVATAR_RUNTIME_OPTIONS.maxSocialCaptureBucket,
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
      hoverRevealRadiusPx: runtimeOptions.hoverRevealRadiusPx,
      hoverRevealMaxNodes: runtimeOptions.hoverRevealMaxNodes,
      showZoomedOutMonograms: runtimeOptions.showZoomedOutMonograms,
      showMonogramBackgrounds: runtimeOptions.showMonogramBackgrounds,
      showMonogramText: runtimeOptions.showMonogramText,
      hideImagesOnFastNodes:
        runtimeOptions.hideImagesOnFastNodes || snapshot.isDegraded,
      fastNodeVelocityThreshold: snapshot.isDegraded
        ? Math.min(runtimeOptions.fastNodeVelocityThreshold, 180)
        : runtimeOptions.fastNodeVelocityThreshold,
      allowZoomedOutImages:
        runtimeOptions.allowZoomedOutImages && !snapshot.isDegraded,
      showAllVisibleImages: runtimeOptions.showAllVisibleImages,
      maxInteractiveBucket: runtimeOptions.maxInteractiveBucket,
      maxSocialCaptureBucket: runtimeOptions.maxSocialCaptureBucket,
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
      maxBucket,
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

  private getForcedOverlayContext(): CanvasRenderingContext2D | null {
    const canvases = this.sigma.getCanvases()
    const mouse = canvases.mouse ?? null
    if (!mouse) {
      return null
    }
    return mouse.getContext('2d')
  }

  private clearForcedOverlayContext(ctx: CanvasRenderingContext2D) {
    const container = this.sigma.getContainer()
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight)
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
