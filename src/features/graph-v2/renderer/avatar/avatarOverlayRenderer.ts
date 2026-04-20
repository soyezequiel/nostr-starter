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
import {
  isAvatarTraceEnabled,
  traceAvatarFlow,
} from '@/features/graph-runtime/debug/avatarTrace'
import type {
  AvatarLoaderBlockDebugEntry,
  AvatarOverlayDebugSnapshot,
  AvatarVisibleNodeDebugSnapshot,
} from '@/features/graph-v2/renderer/avatar/avatarDebug'
import { readAvatarDebugHost } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import type {
  AvatarCandidate,
  AvatarScheduler,
} from '@/features/graph-v2/renderer/avatar/avatarScheduler'
import type { PerfBudget } from '@/features/graph-v2/renderer/avatar/perfBudget'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarBudget,
  type AvatarRuntimeOptions,
  type AvatarUrlKey,
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
const ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_FLOOR = 6
const ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_CEILING = 8
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

interface AvatarDrawResult {
  kind: 'image' | 'monogram' | 'skipped'
  cacheState: AvatarVisibleNodeDebugSnapshot['cacheState']
  cacheFailureReason: string | null
  fallbackReason: string | null
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
  getBlockedAvatar?: (urlKey: AvatarUrlKey) => AvatarLoaderBlockDebugEntry | null
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

export const resolveAvatarImageDisableReason = ({
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
}) => {
  if (!selectedForImage) {
    return 'not_selected_for_image'
  }
  if (globalMotionActive) {
    return 'global_motion_active'
  }
  if (monogramOnly) {
    return 'monogram_only'
  }
  if (fastMoving) {
    return 'fast_moving'
  }
  if (imageDrawCount >= maxImageDrawsPerFrame) {
    return 'image_draw_cap'
  }
  return null
}

export const shouldDisableAvatarImage = (args: {
  selectedForImage: boolean
  globalMotionActive: boolean
  monogramOnly: boolean
  fastMoving: boolean
  imageDrawCount: number
  maxImageDrawsPerFrame: number
}) => resolveAvatarImageDisableReason(args) !== null

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

export const resolveAvatarLoadConcurrency = ({
  baseConcurrency,
  visiblePhotoCount,
  showAllVisibleImages,
}: {
  baseConcurrency: number
  visiblePhotoCount: number
  showAllVisibleImages: boolean
}) => {
  const normalizedBase = Math.max(0, Math.floor(baseConcurrency))
  const normalizedVisiblePhotoCount = Math.max(0, Math.floor(visiblePhotoCount))

  if (!showAllVisibleImages) {
    return normalizedBase
  }
  if (normalizedVisiblePhotoCount === 0) {
    return 0
  }

  return Math.min(
    ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_CEILING,
    Math.max(normalizedBase, ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_FLOOR),
    normalizedVisiblePhotoCount,
  )
}

const incrementCountMap = (map: Record<string, number>, key: string | null) => {
  if (!key) {
    return
  }
  map[key] = (map[key] ?? 0) + 1
}

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
  private readonly getBlockedAvatar: (urlKey: AvatarUrlKey) => AvatarLoaderBlockDebugEntry | null
  private readonly lastBucketByUrl = new Map<string, ImageLodBucket>()
  private readonly lastMotionByNode = new Map<string, AvatarNodeMotionSample>()
  private lastFrameTs = 0
  private lastCameraSignature: string | null = null
  private lastVisibleNodePubkeys: string[] = []
  private lastDebugSnapshot: AvatarOverlayDebugSnapshot | null = null
  private lastAvatarTraceSignature: string | null = null
  private lastAvatarTraceAtMs = 0
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
    this.getBlockedAvatar = deps.getBlockedAvatar ?? (() => null)
    this.boundAfterRender = () => this.onAfterRender()
    this.sigma.on('afterRender', this.boundAfterRender)
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    this.sigma.off('afterRender', this.boundAfterRender)
  }

  public getDebugSnapshot(): AvatarOverlayDebugSnapshot | null {
    return this.lastDebugSnapshot
  }

  public getVisibleNodePubkeys(): string[] {
    return this.lastVisibleNodePubkeys.slice()
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
      this.lastVisibleNodePubkeys = []
      this.lastDebugSnapshot = null
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
    this.lastVisibleNodePubkeys = Array.from(seenNodes)

    this.drawFocusAuras(ctx, focusAuraItems)
    if (!budget.drawAvatars) {
      this.lastDebugSnapshot = {
        generatedAtMs: nowMs,
        cameraRatio,
        moving,
        globalMotionActive: moving && !budget.showAllVisibleImages,
        resolvedBudget: {
          sizeThreshold: budget.sizeThreshold,
          zoomThreshold: budget.zoomThreshold,
          maxAvatarDrawsPerFrame: budget.maxAvatarDrawsPerFrame,
          maxImageDrawsPerFrame: budget.maxImageDrawsPerFrame,
          lruCap: budget.lruCap,
          visualConcurrency: budget.concurrency,
          effectiveLoadConcurrency: 0,
          concurrency: budget.concurrency,
          maxBucket: budget.maxBucket,
          maxInteractiveBucket: budget.maxInteractiveBucket,
          showAllVisibleImages: budget.showAllVisibleImages,
          allowZoomedOutImages: allowZoomedOutImages,
          showZoomedOutMonograms: budget.showZoomedOutMonograms,
          hideImagesOnFastNodes: budget.hideImagesOnFastNodes,
          fastNodeVelocityThreshold: budget.fastNodeVelocityThreshold,
        },
        counts: {
          visibleNodes: 0,
          nodesWithPictureUrl: 0,
          nodesWithSafePictureUrl: 0,
          selectedForImage: 0,
          loadCandidates: 0,
          pendingCacheMiss: 0,
          pendingCandidates: 0,
          blockedCandidates: 0,
          inflightCandidates: 0,
          drawnImages: 0,
          monogramDraws: 0,
          withPictureMonogramDraws: 0,
        },
        byDisableReason: {},
        byLoadSkipReason: {},
        byDrawFallbackReason: {},
        byCacheState: {},
        nodes: [],
      }
      this.traceFrameSummary(nowMs, this.lastDebugSnapshot)
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
    const debugNodes: AvatarVisibleNodeDebugSnapshot[] = []
    const byDisableReason: Record<string, number> = {}
    const byLoadSkipReason: Record<string, number> = {}
    const byDrawFallbackReason: Record<string, number> = {}
    const byCacheState: Record<string, number> = {}
    const globalMotionActive = moving && !budget.showAllVisibleImages
    let imageDrawCount = 0
    let drawnImageCount = 0
    let monogramDrawCount = 0
    let withPictureMonogramDrawCount = 0
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
    const effectiveLoadConcurrency = resolveAvatarLoadConcurrency({
      baseConcurrency: budget.concurrency,
      visiblePhotoCount,
      showAllVisibleImages: budget.showAllVisibleImages,
    })
    const schedulerBudget = {
      ...budget,
      concurrency: effectiveLoadConcurrency,
    }
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
    const maxImageDrawsPerFrame = resolveAvatarFrameDrawCap({
      baseCap: budget.maxImageDrawsPerFrame,
      visibleCount: visiblePhotoCount,
      showAllVisibleImages: budget.showAllVisibleImages,
    })

    for (const item of orderedDrawItems) {
      const isPersistentAvatar = item.isPersistentAvatar
      const selectedForImage = selectedOrInflightPubkeys.has(item.pubkey)
      const hasVisibleMonogramPart =
        item.monogramInput.showBackground !== false ||
        item.monogramInput.showText !== false
      const hasPictureUrl = Boolean(item.url)
      const hasSafePictureUrl = Boolean(item.url && isSafeAvatarUrl(item.url))
      const urlKey =
        item.url !== null ? buildAvatarUrlKey(item.pubkey, item.url) : null
      const blockEntry =
        urlKey !== null ? this.getBlockedAvatar(urlKey) : null
      const disableImageReason =
        hasPictureUrl && !hasSafePictureUrl
          ? 'unsafe_url'
          : resolveAvatarImageDisableReason({
              selectedForImage,
              globalMotionActive,
              monogramOnly: item.monogramOnly,
              fastMoving: item.fastMoving,
              imageDrawCount,
              maxImageDrawsPerFrame,
            })
      const drawResult = this.drawAvatarCircle({
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
        disableImageReason,
        hasVisibleMonogramPart,
      })

      if (drawResult.kind === 'image') {
        imageDrawCount += 1
        drawnImageCount += 1
      } else if (drawResult.kind === 'monogram') {
        monogramDrawCount += 1
        if (hasPictureUrl) {
          withPictureMonogramDrawCount += 1
        }
      }

      let loadSkipReason: string | null = null
      let requestedBucket: ImageLodBucket | null = null
      if (!hasPictureUrl) {
        loadSkipReason = 'missing_url'
      } else if (item.fastMoving && !budget.showAllVisibleImages) {
        loadSkipReason = 'fast_moving'
      } else if (!selectedForImage) {
        loadSkipReason = 'not_selected_for_image'
      } else if (item.monogramOnly) {
        loadSkipReason = 'monogram_only'
      } else if (!allowZoomedOutImages && cameraRatio > budget.zoomThreshold) {
        loadSkipReason = 'zoom_threshold'
      } else if (!hasSafePictureUrl) {
        loadSkipReason = 'unsafe_url'
      } else if (!urlKey) {
        loadSkipReason = 'missing_url'
      } else {
        requestedBucket = this.resolveBucket(
          urlKey,
          item.r * 2,
          Math.min(
            budget.maxBucket,
            budget.maxInteractiveBucket,
          ) as ImageLodBucket,
        )
        candidates.push({
          pubkey: item.pubkey,
          urlKey,
          url: item.url!,
          bucket: requestedBucket,
          priority: item.priority,
          urgent: isPersistentAvatar,
          monogram: item.monogramInput,
        })
      }

      const cacheState = drawResult.cacheState
      incrementCountMap(byCacheState, cacheState)
      incrementCountMap(byDisableReason, disableImageReason)
      incrementCountMap(byLoadSkipReason, loadSkipReason)
      incrementCountMap(byDrawFallbackReason, drawResult.fallbackReason)

      debugNodes.push({
        pubkey: item.pubkey,
        label: item.monogramInput.label,
        url: item.url,
        host: readAvatarDebugHost(item.url),
        urlKey,
        radiusPx: item.r,
        priority: item.priority,
        selectedForImage,
        isPersistentAvatar,
        zoomedOutMonogram: item.zoomedOutMonogram,
        monogramOnly: item.monogramOnly,
        fastMoving: item.fastMoving,
        globalMotionActive,
        disableImageReason,
        drawResult: drawResult.kind,
        drawFallbackReason: drawResult.fallbackReason,
        loadDecision: !hasPictureUrl
          ? 'not_applicable'
          : loadSkipReason === null
            ? 'candidate'
            : 'skipped',
        loadSkipReason,
        cacheState,
        cacheFailureReason: drawResult.cacheFailureReason,
        blocked: blockEntry !== null,
        blockReason: blockEntry?.reason ?? null,
        inflight: urlKey !== null && this.scheduler.hasInflight(urlKey),
        requestedBucket,
        hasPictureUrl,
        hasSafePictureUrl,
      })
    }

    const pendingCacheMissCount = debugNodes.filter(
      (item) => item.hasSafePictureUrl && item.cacheState === 'missing',
    ).length
    const pendingCandidateCount = debugNodes.filter(
      (item) =>
        item.loadDecision === 'candidate' &&
        (item.cacheState === 'missing' || item.cacheState === 'loading'),
    ).length
    const blockedCandidateCount = debugNodes.filter(
      (item) => item.loadDecision === 'candidate' && item.blocked,
    ).length
    const inflightCandidateCount = debugNodes.filter(
      (item) => item.loadDecision === 'candidate' && item.inflight,
    ).length

    this.lastDebugSnapshot = {
      generatedAtMs: nowMs,
      cameraRatio,
      moving,
      globalMotionActive,
      resolvedBudget: {
        sizeThreshold: budget.sizeThreshold,
        zoomThreshold: budget.zoomThreshold,
        maxAvatarDrawsPerFrame: budget.maxAvatarDrawsPerFrame,
        maxImageDrawsPerFrame,
        lruCap: budget.lruCap,
        visualConcurrency: budget.concurrency,
        effectiveLoadConcurrency,
        concurrency: budget.concurrency,
        maxBucket: budget.maxBucket,
        maxInteractiveBucket: budget.maxInteractiveBucket,
        showAllVisibleImages: budget.showAllVisibleImages,
        allowZoomedOutImages,
        showZoomedOutMonograms: budget.showZoomedOutMonograms,
        hideImagesOnFastNodes: budget.hideImagesOnFastNodes,
        fastNodeVelocityThreshold: budget.fastNodeVelocityThreshold,
      },
      counts: {
        visibleNodes: orderedDrawItems.length,
        nodesWithPictureUrl: orderedDrawItems.filter((item) => Boolean(item.url)).length,
        nodesWithSafePictureUrl: visiblePhotoCount,
        selectedForImage: debugNodes.filter((item) => item.selectedForImage).length,
        loadCandidates: candidates.length,
        pendingCacheMiss: pendingCacheMissCount,
        pendingCandidates: pendingCandidateCount,
        blockedCandidates: blockedCandidateCount,
        inflightCandidates: inflightCandidateCount,
        drawnImages: drawnImageCount,
        monogramDraws: monogramDrawCount,
        withPictureMonogramDraws: withPictureMonogramDrawCount,
      },
      byDisableReason,
      byLoadSkipReason,
      byDrawFallbackReason,
      byCacheState,
      nodes: debugNodes,
    }
    this.traceFrameSummary(nowMs, this.lastDebugSnapshot)

    this.pruneMotionSamples(seenNodes)
    if (moving && !budget.showAllVisibleImages) {
      this.scheduler.prime(candidates, schedulerBudget)
      return
    }
    this.scheduler.reconcile(candidates, schedulerBudget)
  }

  private traceFrameSummary(
    nowMs: number,
    snapshot: AvatarOverlayDebugSnapshot,
  ) {
    if (!isAvatarTraceEnabled()) {
      return
    }
    if (
      snapshot.counts.visibleNodes === 0 &&
      snapshot.counts.nodesWithPictureUrl === 0
    ) {
      return
    }

    const signature = JSON.stringify({
      moving: snapshot.moving,
      globalMotionActive: snapshot.globalMotionActive,
      counts: snapshot.counts,
      byDisableReason: snapshot.byDisableReason,
      byLoadSkipReason: snapshot.byLoadSkipReason,
      byDrawFallbackReason: snapshot.byDrawFallbackReason,
      byCacheState: snapshot.byCacheState,
      resolvedBudget: snapshot.resolvedBudget,
    })

    if (signature === this.lastAvatarTraceSignature) {
      return
    }
    if (
      this.lastAvatarTraceSignature !== null &&
      nowMs - this.lastAvatarTraceAtMs < 1000
    ) {
      return
    }

    this.lastAvatarTraceSignature = signature
    this.lastAvatarTraceAtMs = nowMs
    traceAvatarFlow('renderer.avatarOverlay.frameSummary', {
      generatedAtMs: snapshot.generatedAtMs,
      cameraRatio: snapshot.cameraRatio,
      moving: snapshot.moving,
      globalMotionActive: snapshot.globalMotionActive,
      counts: snapshot.counts,
      byDisableReason: snapshot.byDisableReason,
      byLoadSkipReason: snapshot.byLoadSkipReason,
      byDrawFallbackReason: snapshot.byDrawFallbackReason,
      byCacheState: snapshot.byCacheState,
      resolvedBudget: snapshot.resolvedBudget,
    })
  }

  private drawAvatarCircle({
    ctx,
    x,
    y,
    r,
    monogram,
    pubkey,
    url,
    disableImageReason,
    hasVisibleMonogramPart,
  }: {
    ctx: CanvasRenderingContext2D
    x: number
    y: number
    r: number
    monogram: HTMLCanvasElement
    pubkey: string
    url: string | null
    disableImageReason?: string | null
    hasVisibleMonogramPart: boolean
  }): AvatarDrawResult {
    let drawable: CanvasImageSource = monogram
    let isImage = false
    let cacheState: AvatarVisibleNodeDebugSnapshot['cacheState'] = null
    let cacheFailureReason: string | null = null
    let fallbackReason = disableImageReason ?? null

    if (url) {
      const urlKey = buildAvatarUrlKey(pubkey, url)
      const entry = this.cache.get(urlKey)
      if (entry) {
        cacheState = entry.state
        if (entry.state === 'failed') {
          cacheFailureReason = entry.reason
        }
      } else {
        cacheState = 'missing'
      }
      if (!disableImageReason && entry && entry.state === 'ready') {
        drawable = entry.bitmap
        isImage = true
      } else if (fallbackReason === null) {
        fallbackReason =
          entry?.state === 'failed'
            ? entry.reason ?? 'cache_failed'
            : entry?.state === 'loading'
              ? 'cache_loading'
              : 'cache_miss'
      }
    }
    if (!isImage && !hasVisibleMonogramPart) {
      return {
        kind: 'skipped',
        cacheState,
        cacheFailureReason,
        fallbackReason,
      }
    }
    const size = r * 2
    try {
      ctx.drawImage(drawable, x - r, y - r, size, size)
      return {
        kind: isImage ? 'image' : 'monogram',
        cacheState,
        cacheFailureReason,
        fallbackReason: isImage ? null : fallbackReason,
      }
    } catch {
      if (isImage && hasVisibleMonogramPart) {
        try {
          ctx.drawImage(monogram, x - r, y - r, size, size)
        } catch {
          // canvas source may be invalidated; fall back silently
        }
        return {
          kind: 'monogram',
          cacheState,
          cacheFailureReason,
          fallbackReason: 'draw_error',
        }
      }
      return {
        kind: 'skipped',
        cacheState,
        cacheFailureReason,
        fallbackReason,
      }
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
