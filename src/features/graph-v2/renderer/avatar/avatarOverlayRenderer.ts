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
const MIN_FAST_NODE_VELOCITY_THRESHOLD_PX = 80
const FULL_CIRCLE_RADIANS = Math.PI * 2
const FOCUS_AURA_RING_GAP_PX = 3
const FOCUS_AURA_OUTER_LINE_WIDTH_FACTOR = 0.42
const FOCUS_AURA_INNER_LINE_WIDTH_FACTOR = 0.14
const FOCUS_AURA_OUTER_ALPHA = 0.22
const FOCUS_AURA_INNER_ALPHA = 0.52
const EXPANSION_RING_GAP_PX = 4
const EXPANSION_RING_MIN_LINE_WIDTH_PX = 2
const EXPANSION_RING_MAX_LINE_WIDTH_PX = 5
const EXPANSION_RING_LINE_WIDTH_FACTOR = 0.22
const EXPANSION_RING_TRACK_ALPHA = 0.18
const EXPANSION_RING_PROGRESS_ALPHA = 0.96
const EXPANSION_RING_COLOR = '#7dd3a7'
const ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_FLOOR = 6
const ALL_VISIBLE_AVATAR_LOAD_CONCURRENCY_CEILING = 8
const AVATAR_URL_METADATA_CACHE_CAP = 4096
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

interface ExpansionRingItem {
  pubkey: string
  x: number
  y: number
  r: number
  progress: number
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
  urlKey: AvatarUrlKey | null
  urlHost: string | null
  hasPictureUrl: boolean
  hasSafePictureUrl: boolean
  fastMoving: boolean
  monogramOnly: boolean
  isPersistentAvatar: boolean
  zoomedOutMonogram: boolean
  priority: number
  monogramInput: MonogramInput
}

interface AvatarUrlMetadata {
  hasPictureUrl: boolean
  hasSafePictureUrl: boolean
  urlKey: AvatarUrlKey | null
  host: string | null
}

export const createAvatarUrlMetadataResolver = (
  capacity = AVATAR_URL_METADATA_CACHE_CAP,
) => {
  const cache = new Map<string, AvatarUrlMetadata>()
  const normalizedCapacity = Math.max(1, Math.floor(capacity))

  return {
    resolve(pubkey: string, url: string | null): AvatarUrlMetadata {
      if (url === null) {
        return {
          hasPictureUrl: false,
          hasSafePictureUrl: false,
          urlKey: null,
          host: null,
        }
      }

      const key = `${pubkey}\0${url}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing
      }

      const metadata = {
        hasPictureUrl: true,
        hasSafePictureUrl: isSafeAvatarUrl(url),
        urlKey: buildAvatarUrlKey(pubkey, url),
        host: readAvatarDebugHost(url),
      }
      cache.set(key, metadata)
      while (cache.size > normalizedCapacity) {
        const oldestKey = cache.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        cache.delete(oldestKey)
      }
      return metadata
    },
    size() {
      return cache.size
    },
  }
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
  getSelectedNodePubkey?: () => string | null
  getHoveredNodePubkey?: () => string | null
  getForcedAvatarPubkey?: () => string | null
  getHoveredNeighborPubkeys?: () => ReadonlySet<string>
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
  const forcedItems: T[] = []
  const persistentItems: T[] = []
  const selectableItems: T[] = []

  for (const item of items) {
    if (forcedPubkeys.has(item.pubkey)) {
      forcedItems.push(item)
    } else if (item.isPersistentAvatar) {
      persistentItems.push(item)
    } else {
      selectableItems.push(item)
    }
  }

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

export const selectAvatarDrawContext = <T>(
  itemPubkey: string,
  forcedPubkeys: ReadonlySet<string>,
  baseContext: T,
  forcedContext: T | null,
) =>
  forcedPubkeys.has(itemPubkey) && forcedContext
    ? forcedContext
    : baseContext

export const shouldDrawAvatarForRendererFocus = ({
  rendererFocusPubkey = null,
  rendererFocusNeighborPubkeys = EMPTY_SET,
  pubkey,
}: {
  rendererFocusPubkey?: string | null
  rendererFocusNeighborPubkeys?: ReadonlySet<string>
  pubkey: string
}) => {
  if (rendererFocusPubkey === null) {
    return true
  }

  return (
    pubkey === rendererFocusPubkey ||
    rendererFocusNeighborPubkeys.has(pubkey)
  )
}

export const resolveAvatarGlobalMotionActive = ({
  moving,
  hideImagesOnFastNodes,
}: {
  moving: boolean
  hideImagesOnFastNodes: boolean
}) => moving && hideImagesOnFastNodes

export const resolveAvatarItemGlobalMotionActive = ({
  globalMotionActive,
  isPersistentAvatar = false,
}: {
  globalMotionActive: boolean
  isPersistentAvatar?: boolean
}) => globalMotionActive && !isPersistentAvatar

export const resolveAvatarImageDisableReason = ({
  selectedForImage,
  globalMotionActive,
  monogramOnly,
  fastMoving,
  imageDrawCount,
  maxImageDrawsPerFrame,
  hasReadyImage = false,
}: {
  selectedForImage: boolean
  globalMotionActive: boolean
  monogramOnly: boolean
  fastMoving: boolean
  imageDrawCount: number
  maxImageDrawsPerFrame: number
  hasReadyImage?: boolean
}) => {
  if (!selectedForImage) {
    return 'not_selected_for_image'
  }
  if (globalMotionActive && !hasReadyImage) {
    return 'global_motion_active'
  }
  if (monogramOnly) {
    return 'monogram_only'
  }
  if (fastMoving && !hasReadyImage) {
    return 'fast_moving'
  }
  if (imageDrawCount >= maxImageDrawsPerFrame && !hasReadyImage) {
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
  hasReadyImage?: boolean
}) => resolveAvatarImageDisableReason(args) !== null

export const resolveFastNodeVelocityThresholdPx = ({
  baseThreshold,
  cameraRatio,
}: {
  baseThreshold: number
  cameraRatio: number
}) => {
  const normalizedBase = Number.isFinite(baseThreshold)
    ? Math.max(0, baseThreshold)
    : Number.POSITIVE_INFINITY
  if (!Number.isFinite(normalizedBase)) {
    return normalizedBase
  }
  return Math.max(
    MIN_FAST_NODE_VELOCITY_THRESHOLD_PX,
    normalizedBase / Math.sqrt(Math.max(1, cameraRatio)),
  )
}

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
    ? (() => {
        const normalizedBaseCap = Math.max(16, Math.floor(baseCap))
        const normalizedVisiblePhotoCount = Math.max(
          0,
          Math.floor(visiblePhotoCount),
        )
        const visibleHeadroom = Math.max(
          32,
          Math.ceil(normalizedVisiblePhotoCount * 0.25),
        )
        return Math.max(
          normalizedBaseCap,
          normalizedVisiblePhotoCount + visibleHeadroom,
        )
      })()
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
  private readonly getSelectedNodePubkey: () => string | null
  private readonly getHoveredNodePubkey: () => string | null
  private readonly getForcedAvatarPubkey: () => string | null
  private readonly getHoveredNeighborPubkeys: () => ReadonlySet<string>
  private readonly getRuntimeOptions: () => AvatarRuntimeOptions | null
  private readonly getBlockedAvatar: (urlKey: AvatarUrlKey) => AvatarLoaderBlockDebugEntry | null
  private readonly avatarUrlMetadata = createAvatarUrlMetadataResolver()
  private readonly lastBucketByUrl = new Map<string, ImageLodBucket>()
  private readonly lastMotionByNode = new Map<string, AvatarNodeMotionSample>()
  private expansionAnimationFrameId: number | null = null
  private lastFrameTs = 0
  private lastCameraSignature: string | null = null
  private lastVisibleNodePubkeys: string[] = []
  private lastDebugSnapshot: AvatarOverlayDebugSnapshot | null = null
  private lastAvatarTraceSignature: string | null = null
  private lastAvatarTraceAtMs = 0
  private readonly boundAfterRender: () => void
  private debugDetailsEnabled = false
  private disposed = false

  constructor(deps: AvatarOverlayRendererDeps) {
    this.sigma = deps.sigma
    this.cache = deps.cache
    this.scheduler = deps.scheduler
    this.budget = deps.budget
    this.isMoving = deps.isMoving
    this.getSelectedNodePubkey = deps.getSelectedNodePubkey ?? (() => null)
    this.getHoveredNodePubkey = deps.getHoveredNodePubkey ?? (() => null)
    this.getForcedAvatarPubkey = deps.getForcedAvatarPubkey ?? (() => null)
    this.getHoveredNeighborPubkeys = deps.getHoveredNeighborPubkeys ?? (() => EMPTY_SET)
    this.getRuntimeOptions = deps.getRuntimeOptions ?? (() => null)
    this.getBlockedAvatar = deps.getBlockedAvatar ?? (() => null)
    this.boundAfterRender = () => this.onAfterRender()
    this.sigma.on('afterRender', this.boundAfterRender)
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    this.sigma.off('afterRender', this.boundAfterRender)
    if (this.expansionAnimationFrameId !== null) {
      cancelAnimationFrame(this.expansionAnimationFrameId)
    }
  }

  public getDebugSnapshot(): AvatarOverlayDebugSnapshot | null {
    return this.lastDebugSnapshot
  }

  public setDebugDetailsEnabled(enabled: boolean) {
    this.debugDetailsEnabled = enabled
  }

  public getVisibleNodePubkeys(): string[] {
    return this.lastVisibleNodePubkeys.slice()
  }

  public getVisibleNodePubkeyCount(): number {
    return this.lastVisibleNodePubkeys.length
  }

  public forEachVisibleNodePubkey(callback: (pubkey: string) => void): number {
    for (const pubkey of this.lastVisibleNodePubkeys) {
      callback(pubkey)
    }
    return this.lastVisibleNodePubkeys.length
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
    const moving = this.isMoving()
    const rendererFocusNeighborPubkeys = this.getHoveredNeighborPubkeys()
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
    const rawRendererFocusPubkey = this.getHoveredNodePubkey()
    const rendererFocusPubkey =
      rawRendererFocusPubkey !== null && graph.hasNode(rawRendererFocusPubkey)
        ? rawRendererFocusPubkey
        : null
    const drawItems: AvatarDrawItem[] = []
    const focusAuraItems: FocusAuraItem[] = []
    const expansionRingItems: ExpansionRingItem[] = []
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
      const avatarAllowedByFocus = shouldDrawAvatarForRendererFocus({
        rendererFocusPubkey,
        rendererFocusNeighborPubkeys,
        pubkey,
      })
      const isFocusedAvatar = pubkey === rendererFocusPubkey
      const isPersistentAvatar =
        forcedAvatarPubkeys.has(pubkey) ||
        nodeAttrs.isRoot ||
        nodeAttrs.isPinned ||
        isFocusedAvatar
      const hasPriorityAvatarSizing =
        pubkey === directForcedAvatarPubkey ||
        nodeAttrs.isRoot ||
        nodeAttrs.isPinned ||
        isFocusedAvatar
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
      if (rendererFocusNeighborPubkeys.has(pubkey)) {
        focusAuraItems.push({
          pubkey,
          x: viewport.x,
          y: viewport.y,
          r: Math.max(nodeRadiusPx, drawRadiusPx),
          color: nodeAttrs.color,
        })
      }
      if (nodeAttrs.isExpanding && nodeAttrs.expansionProgress !== null) {
        expansionRingItems.push({
          pubkey,
          x: viewport.x,
          y: viewport.y,
          r: Math.max(nodeRadiusPx, drawRadiusPx),
          progress: nodeAttrs.expansionProgress,
        })
      }
      if (!budget.drawAvatars) {
        return
      }
      if (!avatarAllowedByFocus) {
        return
      }
      if (
        !budget.showZoomedOutMonograms &&
        !allowZoomedOutImages &&
        !isPersistentAvatar &&
        zoomedOutMonogram
      ) {
        return
      }
      const fastMoving =
        this.isFastMovingNode(
          pubkey,
          viewport.x,
          viewport.y,
          nowMs,
          budget,
          cameraChanged,
          cameraRatio,
        )

      const monogramInput: MonogramInput = {
        label: nodeAttrs.label || pubkey.slice(0, 2),
        color: nodeAttrs.color || '#7dd3a7',
        paletteKey: pubkey,
        showBackground: budget.showMonogramBackgrounds,
        showText: budget.showMonogramText,
      }
      const priority = resolvePriority(nodeAttrs, viewport, this.sigma)
      const urlMetadata = this.avatarUrlMetadata.resolve(pubkey, nodeAttrs.pictureUrl)
      drawItems.push({
        pubkey,
        x: viewport.x,
        y: viewport.y,
        r: drawRadiusPx,
        url: nodeAttrs.pictureUrl,
        urlKey: urlMetadata.urlKey,
        urlHost: urlMetadata.host,
        hasPictureUrl: urlMetadata.hasPictureUrl,
        hasSafePictureUrl: urlMetadata.hasSafePictureUrl,
        fastMoving,
        monogramOnly:
          !isPersistentAvatar &&
          zoomedOutMonogram &&
          !allowZoomedOutImages,
        isPersistentAvatar,
        zoomedOutMonogram,
        priority,
        monogramInput,
      })
    })
    this.lastVisibleNodePubkeys = Array.from(seenNodes)

    this.drawFocusAuras(ctx, focusAuraItems)
    if (!budget.drawAvatars) {
      this.drawExpansionRings(ctx, expansionRingItems)
      this.lastDebugSnapshot = {
        generatedAtMs: nowMs,
        cameraRatio,
        moving,
        globalMotionActive: resolveAvatarGlobalMotionActive({
          moving,
          hideImagesOnFastNodes: budget.hideImagesOnFastNodes,
        }),
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

    if (expansionRingItems.length > 0 && this.expansionAnimationFrameId === null) {
      this.expansionAnimationFrameId = requestAnimationFrame(() => {
        this.expansionAnimationFrameId = null
        if (this.sigma) {
          this.sigma.refresh()
        }
      })
    }

    const includeDebugNodes = this.debugDetailsEnabled || isAvatarTraceEnabled()
    const candidates: AvatarCandidate[] = []
    const debugNodes: AvatarVisibleNodeDebugSnapshot[] = []
    const byDisableReason: Record<string, number> = {}
    const byLoadSkipReason: Record<string, number> = {}
    const byDrawFallbackReason: Record<string, number> = {}
    const byCacheState: Record<string, number> = {}
    const globalMotionActive = resolveAvatarGlobalMotionActive({
      moving,
      hideImagesOnFastNodes: budget.hideImagesOnFastNodes,
    })
    let imageDrawCount = 0
    let drawnImageCount = 0
    let monogramDrawCount = 0
    let withPictureMonogramDrawCount = 0
    const resolvedDrawItems: AvatarDrawItem[] = []
    let visiblePhotoCount = 0
    for (const item of drawItems) {
      const isPersistentAvatar =
        item.isPersistentAvatar || forcedAvatarPubkeys.has(item.pubkey)
      if (
        !budget.showZoomedOutMonograms &&
        !allowZoomedOutImages &&
        !isPersistentAvatar &&
        item.zoomedOutMonogram
      ) {
        continue
      }

      const monogramOnly =
        !isPersistentAvatar &&
        item.zoomedOutMonogram &&
        !allowZoomedOutImages
      const resolvedItem =
        item.isPersistentAvatar === isPersistentAvatar &&
        item.monogramOnly === monogramOnly
          ? item
          : {
              ...item,
              isPersistentAvatar,
              monogramOnly,
            }
      resolvedDrawItems.push(resolvedItem)
      if (resolvedItem.hasSafePictureUrl) {
        visiblePhotoCount += 1
      }
    }
    const isDegraded = this.budget.snapshot().isDegraded
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
    // Keep total overlay work bounded by the frame cap instead of only
    // capping image candidates and then drawing monograms for the full set.
    const orderedDrawItems = selectedDrawItems
    const maxImageDrawsPerFrame = resolveAvatarFrameDrawCap({
      baseCap: budget.maxImageDrawsPerFrame,
      visibleCount: visiblePhotoCount,
      showAllVisibleImages: budget.showAllVisibleImages,
    })
    let nodesWithPictureUrlCount = 0
    let selectedForImageCount = 0
    let pendingCacheMissCount = 0
    let pendingCandidateCount = 0
    let blockedCandidateCount = 0
    let inflightCandidateCount = 0

    for (const item of orderedDrawItems) {
      const isPersistentAvatar = item.isPersistentAvatar
      const selectedForImage = selectedOrInflightPubkeys.has(item.pubkey)
      const hasVisibleMonogramPart =
        item.monogramInput.showBackground !== false ||
        item.monogramInput.showText !== false
      const hasPictureUrl = item.hasPictureUrl
      const hasSafePictureUrl = item.hasSafePictureUrl
      const urlKey = item.urlKey
      const avatarCacheEntry = urlKey !== null ? this.cache.get(urlKey) : null
      const hasReadyImage = avatarCacheEntry?.state === 'ready'
      const blockEntry =
        urlKey !== null ? this.getBlockedAvatar(urlKey) : null
      const inflight = urlKey !== null && this.scheduler.hasInflight(urlKey)
      const itemGlobalMotionActive = resolveAvatarItemGlobalMotionActive({
        globalMotionActive,
        isPersistentAvatar,
      })
      const itemFastMoving = isPersistentAvatar ? false : item.fastMoving
      const disableImageReason =
        hasPictureUrl && !hasSafePictureUrl
          ? 'unsafe_url'
          : resolveAvatarImageDisableReason({
              selectedForImage,
              globalMotionActive: itemGlobalMotionActive,
              monogramOnly: item.monogramOnly,
              fastMoving: itemFastMoving,
              imageDrawCount,
              maxImageDrawsPerFrame,
              hasReadyImage,
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
        monogram: this.cache.getMonogram(item.pubkey, item.monogramInput),
        url: item.url,
        urlKey,
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
      } else if (itemFastMoving) {
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

      const loadDecision = !hasPictureUrl
        ? 'not_applicable'
        : loadSkipReason === null
          ? 'candidate'
          : 'skipped'
      if (hasPictureUrl) {
        nodesWithPictureUrlCount += 1
      }
      if (selectedForImage) {
        selectedForImageCount += 1
      }
      if (hasSafePictureUrl && cacheState === 'missing') {
        pendingCacheMissCount += 1
      }
      if (
        loadDecision === 'candidate' &&
        (cacheState === 'missing' || cacheState === 'loading')
      ) {
        pendingCandidateCount += 1
      }
      if (loadDecision === 'candidate' && blockEntry !== null) {
        blockedCandidateCount += 1
      }
      if (loadDecision === 'candidate' && inflight) {
        inflightCandidateCount += 1
      }

      if (includeDebugNodes) {
        debugNodes.push({
          pubkey: item.pubkey,
          label: item.monogramInput.label,
          url: item.url,
          host: item.urlHost,
          urlKey,
          radiusPx: item.r,
          priority: item.priority,
          selectedForImage,
          isPersistentAvatar,
          zoomedOutMonogram: item.zoomedOutMonogram,
          monogramOnly: item.monogramOnly,
          fastMoving: itemFastMoving,
          globalMotionActive: itemGlobalMotionActive,
          disableImageReason,
          drawResult: drawResult.kind,
          drawFallbackReason: drawResult.fallbackReason,
          loadDecision,
          loadSkipReason,
          cacheState,
          cacheFailureReason: drawResult.cacheFailureReason,
          blocked: blockEntry !== null,
          blockReason: blockEntry?.reason ?? null,
          inflight,
          requestedBucket,
          hasPictureUrl,
          hasSafePictureUrl,
        })
      }
    }

    this.drawExpansionRings(ctx, expansionRingItems)

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
        visibleNodes: resolvedDrawItems.length,
        nodesWithPictureUrl: nodesWithPictureUrlCount,
        nodesWithSafePictureUrl: visiblePhotoCount,
        selectedForImage: selectedForImageCount,
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
    if (globalMotionActive) {
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
    url,
    urlKey,
    disableImageReason,
    hasVisibleMonogramPart,
  }: {
    ctx: CanvasRenderingContext2D
    x: number
    y: number
    r: number
    monogram: HTMLCanvasElement
    url: string | null
    urlKey: AvatarUrlKey | null
    disableImageReason?: string | null
    hasVisibleMonogramPart: boolean
  }): AvatarDrawResult {
    let drawable: CanvasImageSource = monogram
    let isImage = false
    let cacheState: AvatarVisibleNodeDebugSnapshot['cacheState'] = null
    let cacheFailureReason: string | null = null
    let fallbackReason = disableImageReason ?? null

    if (url && urlKey) {
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

  private drawExpansionRings(
    ctx: CanvasRenderingContext2D,
    items: readonly ExpansionRingItem[],
  ) {
    const itemsByPubkey = new Map<string, ExpansionRingItem>()
    for (const item of items) {
      itemsByPubkey.set(item.pubkey, item)
    }
    for (const item of itemsByPubkey.values()) {
      this.drawExpansionRing(ctx, item)
    }
  }

  private drawExpansionRing(
    ctx: CanvasRenderingContext2D,
    item: ExpansionRingItem,
  ) {
    const lineWidth = Math.min(
      EXPANSION_RING_MAX_LINE_WIDTH_PX,
      Math.max(
        EXPANSION_RING_MIN_LINE_WIDTH_PX,
        item.r * EXPANSION_RING_LINE_WIDTH_FACTOR,
      ),
    )
    const radius = item.r + EXPANSION_RING_GAP_PX + lineWidth * 0.5
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    
    // Animate a 1/4 circle spanning around the node
    const speed = 0.006 // radians per millisecond
    const startAngle = now * speed
    const endAngle = startAngle + FULL_CIRCLE_RADIANS * 0.25

    ctx.save()

    ctx.beginPath()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = withAlpha(
      EXPANSION_RING_COLOR,
      EXPANSION_RING_TRACK_ALPHA,
    )
    ctx.arc(item.x, item.y, radius, 0, FULL_CIRCLE_RADIANS)
    ctx.stroke()

    ctx.beginPath()
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.strokeStyle = withAlpha(
      EXPANSION_RING_COLOR,
      EXPANSION_RING_PROGRESS_ALPHA,
    )
    ctx.arc(item.x, item.y, radius, startAngle, endAngle)
    ctx.stroke()

    ctx.restore()
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
      allowZoomedOutImages: runtimeOptions.allowZoomedOutImages,
      showAllVisibleImages: runtimeOptions.showAllVisibleImages,
      maxInteractiveBucket: runtimeOptions.maxInteractiveBucket,
    }
  }

  private isFastMovingNode(
    pubkey: string,
    x: number,
    y: number,
    nowMs: number,
    budget: EffectiveAvatarBudget,
    cameraChanged: boolean,
    cameraRatio: number,
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
    return velocityPxPerSecond > resolveFastNodeVelocityThresholdPx({
      baseThreshold: budget.fastNodeVelocityThreshold,
      cameraRatio,
    })
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
