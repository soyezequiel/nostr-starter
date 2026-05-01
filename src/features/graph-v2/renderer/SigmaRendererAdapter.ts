import Sigma from 'sigma'
import type { Coordinates, TouchCoords } from 'sigma/types'

import {
  DEFAULT_CONNECTION_VISUAL_CONFIG,
  MAX_CONNECTION_OPACITY,
  normalizeConnectionVisualConfig,
  type ConnectionFocusStyle,
  type ConnectionVisualConfig,
} from '@/features/graph-v2/connectionVisualConfig'
import { hasRenderableSigmaContainer } from '@/features/graph-v2/renderer/containerDimensions'
import { installSigmaPixelRatioCap } from '@/features/graph-v2/renderer/sigmaPixelRatio'
import type {
  GraphInteractionCallbacks,
  GraphPhysicsSnapshot,
  GraphSceneSnapshot,
  RendererAdapter,
} from '@/features/graph-v2/renderer/contracts'
import { drawCachedDiscNodeLabel } from '@/features/graph-v2/renderer/cachedNodeLabels'
import { ForceAtlasRuntime } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type { ForceAtlasPhysicsTuning } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import {
  NodePositionLedger,
  PhysicsGraphStore,
  RenderGraphStore,
  resolveDetachedNodePlacement,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import type {
  RenderEdgeAttributes,
  RenderNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import {
  buildDragHopDistances,
  DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
} from '@/features/graph-v2/renderer/dragNeighborhood'
import {
  createDragNeighborhoodInfluenceConfig,
  createDragNeighborhoodInfluenceState,
  dampInfluenceVelocities,
  DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  releaseDraggedNode,
  stepDragNeighborhoodInfluence,
  type DragNeighborhoodInfluenceConfig,
  type DragNeighborhoodInfluenceState,
  type DragNeighborhoodInfluenceTuning,
} from '@/features/graph-v2/renderer/dragInfluence'
import { AvatarBitmapCache } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'
import { AvatarOverlayRenderer } from '@/features/graph-v2/renderer/avatar/avatarOverlayRenderer'
import { AvatarScheduler } from '@/features/graph-v2/renderer/avatar/avatarScheduler'
import { detectDeviceTier } from '@/features/graph-v2/renderer/avatar/deviceTier'
import { PerfBudget } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  DEFAULT_BUDGETS,
} from '@/features/graph-v2/renderer/avatar/types'
import type { AvatarRuntimeOptions } from '@/features/graph-v2/renderer/avatar/types'
import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import {
  createSuppressedNodeClick,
  createPendingNodeDragGesture,
  shouldSuppressNodeClick,
  shouldStartNodeDrag,
  type PendingNodeDragGesture,
  type SuppressedNodeClick,
} from '@/features/graph-v2/renderer/nodeDragGesture'
import {
  installStrictNodeHitTesting,
  type SpatialNodeHitTester,
} from '@/features/graph-v2/renderer/spatialNodeHitTest'
import { noopNodeHoverProgram } from '@/features/graph-v2/renderer/noopNodeHoverProgram'
import type {
  DebugDragCandidate,
  DebugNeighborGroups,
  DebugDragRuntimeState,
  DebugDragTimelineEvent,
  DebugDragTimelineStage,
  DebugNodePosition,
  DebugPhysicsDiagnostics,
  DebugProjectionDiagnostics,
  DebugRenderInvalidationState,
  DebugRenderPhysicsPosition,
} from '@/features/graph-v2/testing/browserDebug'
import {
  isGraphPerfTraceEnabled,
  nowGraphPerfMs,
  traceGraphPerf,
  traceGraphPerfDuration,
} from '@/features/graph-runtime/debug/perfTrace'

const HOVER_SELECTED_NODE_COLOR = '#f4fbff'
const HOVER_DIM_NODE_COLOR = '#121a22'
const HOVER_EDGE_BRIGHT_COLOR = '#f4fbff'
const HOVER_DIM_EDGE_COLOR = '#10171f'
const HIGHLIGHT_TRANSITION_MS = 180
const FOCUS_TRANSITION_RENDER_ITEM_LIMIT = 2500
const HOVER_FOCUS_DWELL_MS = 500
const TOUCH_TAP_MOVE_TOLERANCE_PX = 16
const TOUCH_MOUSE_COMPATIBILITY_SUPPRESSION_MS = 400
const STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS = 160
const OUTSIDE_NODE_CLICK_DEDUP_MS = 500
const MOBILE_GRAPH_INTERACTION_QUERY = '(max-width: 720px)'
const PHYSICS_BRIDGE_BACKGROUND_SYNC_CAP = 96
const PHYSICS_BRIDGE_VIEWPORT_PADDING_RATIO = 0.12
const PHYSICS_AUTO_FIT_INTERVAL_MS = 120
const DRAG_TIMELINE_LIMIT = 200
const GRAPH_BOUNDS_UNLOCK_INITIAL_FRAME_DELAY = 2
const GRAPH_BOUNDS_UNLOCK_MAX_DEFERRED_FRAMES = 8
const GRAPH_BOUNDS_UNLOCK_MAX_WAIT_MS = 180
export const DEFAULT_INITIAL_CAMERA_ZOOM = 2.5
export const MIN_INITIAL_CAMERA_ZOOM = 0.75
export const MAX_INITIAL_CAMERA_ZOOM = 3
const NODE_ZOOM_OUT_MIN_SCALE = 0.42
const NODE_ZOOM_OUT_SCALE_EXPONENT = 0.55
const AVATAR_MIN_SIZE_THRESHOLD = 4
const AVATAR_MAX_SIZE_THRESHOLD = 48
const AVATAR_MIN_ZOOM_THRESHOLD = 0.5
const AVATAR_MAX_ZOOM_THRESHOLD = 6
const AVATAR_MIN_HOVER_REVEAL_RADIUS = 0
const AVATAR_MAX_HOVER_REVEAL_RADIUS = 180
const AVATAR_MIN_HOVER_REVEAL_MAX_NODES = 0
const AVATAR_MAX_HOVER_REVEAL_MAX_NODES = 96
const AVATAR_MIN_FAST_NODE_VELOCITY = 40
const AVATAR_MAX_FAST_NODE_VELOCITY = 2000
const AVATAR_MAX_INTERACTIVE_BUCKETS = [32, 64, 128, 256] as const
const EMPTY_HOVER_NEIGHBORS = new Set<string>()

// P2: camera ratio above this value means the user is zoomed out enough to hide lightweight edges
const EDGE_ZOOM_LOD_CAMERA_RATIO_THRESHOLD = 1.8
const EDGE_ZOOM_LOD_MIN_WEIGHT = 0.5
// P4: extra viewport margin in graph units to avoid popping at the edges
const EDGE_VIEWPORT_CULLING_MARGIN = 50

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const getRendererNowMs = () =>
  typeof performance !== 'undefined' &&
  typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

interface GraphBoundsSnapshot {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface SigmaGraphExtent {
  x: [number, number]
  y: [number, number]
}

const normalizeGraphPointForExtent = (
  point: { x: number; y: number },
  extent: SigmaGraphExtent,
) => {
  const width = extent.x[1] - extent.x[0]
  const height = extent.y[1] - extent.y[0]
  const ratio = Math.max(width, height, 1)
  const centerX = (extent.x[0] + extent.x[1]) / 2
  const centerY = (extent.y[0] + extent.y[1]) / 2

  return {
    x: 0.5 + (point.x - centerX) / ratio,
    y: 0.5 + (point.y - centerY) / ratio,
  }
}

const resolveGraphDimensionCorrection = (
  viewport: { width: number; height: number },
  graph: { width: number; height: number },
) => {
  const viewportRatio = viewport.height / viewport.width
  const graphRatio = graph.height / graph.width
  if (
    (viewportRatio < 1 && graphRatio > 1) ||
    (viewportRatio > 1 && graphRatio < 1)
  ) {
    return 1
  }

  return Math.min(
    Math.max(graphRatio, 1 / graphRatio),
    Math.max(1 / viewportRatio, viewportRatio),
  )
}

const cloneSigmaGraphExtent = (
  extent: SigmaGraphExtent,
): SigmaGraphExtent => ({
  x: [extent.x[0], extent.x[1]],
  y: [extent.y[0], extent.y[1]],
})

const isUsableSigmaGraphExtent = (
  extent: SigmaGraphExtent | null | undefined,
): extent is SigmaGraphExtent =>
  !!extent &&
  Number.isFinite(extent.x[0]) &&
  Number.isFinite(extent.x[1]) &&
  Number.isFinite(extent.y[0]) &&
  Number.isFinite(extent.y[1]) &&
  extent.x[0] !== extent.x[1] &&
  extent.y[0] !== extent.y[1]

const normalizeBucketOption = <T extends readonly ImageLodBucket[]>(
  value: ImageLodBucket | undefined,
  allowed: T,
  fallback: ImageLodBucket,
): ImageLodBucket =>
  allowed.includes(value as T[number])
    ? (value as ImageLodBucket)
    : fallback

const easeInOut = (value: number) => {
  const t = clampNumber(value, 0, 1)
  return t * t * (3 - 2 * t)
}

const lerpNumber = (from: number, to: number, amount: number) =>
  from + (to - from) * amount

const isMobileGraphInteractionMode = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return (
    window.matchMedia(MOBILE_GRAPH_INTERACTION_QUERY).matches ||
    window.matchMedia('(pointer: coarse)').matches
  )
}

const parseHexRgb = (color: string) => {
  const normalized = color.trim()
  if (!normalized.startsWith('#')) {
    return null
  }

  const hex =
    normalized.length === 4
      ? normalized
          .slice(1)
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized.slice(1)

  if (!/^[\da-f]{6}$/i.test(hex)) {
    return null
  }

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

const toHexChannel = (value: number) =>
  Math.round(clampNumber(value, 0, 255))
    .toString(16)
    .padStart(2, '0')

const mixColor = (from: string, to: string, amount: number) => {
  if (from === to) {
    return to
  }

  const fromRgb = parseHexRgb(from)
  const toRgb = parseHexRgb(to)
  if (!fromRgb || !toRgb) {
    return amount < 1 ? from : to
  }

  return `#${toHexChannel(lerpNumber(fromRgb.r, toRgb.r, amount))}${toHexChannel(
    lerpNumber(fromRgb.g, toRgb.g, amount),
  )}${toHexChannel(lerpNumber(fromRgb.b, toRgb.b, amount))}`
}

const applyColorOpacity = (color: string, opacity: number) => {
  const rgb = parseHexRgb(color)
  if (!rgb) {
    return color
  }

  const normalizedOpacity = clampNumber(
    opacity,
    0,
    MAX_CONNECTION_OPACITY,
  )
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${normalizedOpacity})`
}

const resolveConnectionBaseColor = (
  color: string,
  config: ConnectionVisualConfig,
) => {
  switch (config.colorMode) {
    case 'calm':
      return mixColor(color, '#6c7a8d', 0.42)
    case 'mono':
      return '#7a92bd'
    case 'semantic':
    default:
      return color
  }
}

const resolveConnectionBaseSize = (
  size: number,
  config: ConnectionVisualConfig,
) => Math.max(0.25, size * config.thicknessScale)

const getMidpoint = (from: Coordinates, to: Coordinates): Coordinates => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2,
})

const getDistance = (from: Coordinates, to: Coordinates) =>
  Math.hypot(to.x - from.x, to.y - from.y)

const resolveZoomOutNodeScale = (cameraRatio: number) =>
  clampNumber(
    1 / Math.pow(Math.max(cameraRatio, 1), NODE_ZOOM_OUT_SCALE_EXPONENT),
    NODE_ZOOM_OUT_MIN_SCALE,
    1,
  )

const isControlModifierPressed = (
  event: { original?: MouseEvent | TouchEvent } | null | undefined,
) =>
  Boolean(
    event?.original &&
      'ctrlKey' in event.original &&
      event.original.ctrlKey,
  )

type HoverFocusSnapshot = {
  pubkey: string | null
  neighbors: Set<string>
}

const EMPTY_RENDERER_FOCUS: HoverFocusSnapshot = {
  pubkey: null,
  neighbors: EMPTY_HOVER_NEIGHBORS,
}

type EdgeFocusVisualPreset = {
  brightColor: string
  dimColor: string
  dimSize: number
  focusSizeBonus: number
  focusMinSize: number
}

const EDGE_FOCUS_VISUAL_PRESETS: Record<
  ConnectionFocusStyle,
  EdgeFocusVisualPreset
> = {
  soft: {
    brightColor: '#d8e4f0',
    dimColor: '#1c2530',
    dimSize: 0.35,
    focusSizeBonus: 0.9,
    focusMinSize: 2.1,
  },
  balanced: {
    brightColor: HOVER_EDGE_BRIGHT_COLOR,
    dimColor: HOVER_DIM_EDGE_COLOR,
    dimSize: 0.2,
    focusSizeBonus: 1.6,
    focusMinSize: 2.8,
  },
  dramatic: {
    brightColor: '#ffffff',
    dimColor: '#0b1017',
    dimSize: 0.12,
    focusSizeBonus: 2.3,
    focusMinSize: 3.4,
  },
}

type HighlightTransition = {
  from: HoverFocusSnapshot
  to: HoverFocusSnapshot
  startedAt: number
  durationMs: number
}

type SigmaMovementCaptorShim = {
  isMoving: boolean
}

const mixNodeVisualAttributes = (
  from: RenderNodeAttributes,
  to: RenderNodeAttributes,
  amount: number,
): RenderNodeAttributes => ({
  ...to,
  color: mixColor(from.color, to.color, amount),
  size: lerpNumber(from.size, to.size, amount),
  zIndex: Math.round(lerpNumber(from.zIndex, to.zIndex, amount)),
  highlighted: amount < 0.5 ? from.highlighted : to.highlighted,
  forceLabel: from.forceLabel || to.forceLabel,
  label: from.forceLabel && !to.forceLabel && amount < 0.75 ? from.label : to.label,
})

const mixEdgeVisualAttributes = (
  from: RenderEdgeAttributes,
  to: RenderEdgeAttributes,
  amount: number,
): RenderEdgeAttributes => ({
  ...to,
  color: mixColor(from.color, to.color, amount),
  size: lerpNumber(from.size, to.size, amount),
  zIndex: Math.round(lerpNumber(from.zIndex, to.zIndex, amount)),
  hidden: amount < 0.5 ? from.hidden : to.hidden,
})

export class SigmaRendererAdapter implements RendererAdapter {
  private sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes> | null = null

  private container: HTMLElement | null = null

  private resizeObserver: ResizeObserver | null = null

  private pixelRatioCapDispose: (() => void) | null = null

  private pendingContainerRefresh = false

  private pendingContainerRefreshFrame: number | null = null

  private pendingAvatarSettledRefresh = false

  private positionLedger: NodePositionLedger | null = null

  private renderStore: RenderGraphStore | null = null

  private physicsStore: PhysicsGraphStore | null = null

  private nodeHitTester: SpatialNodeHitTester | null = null

  private forceRuntime: ForceAtlasRuntime | null = null

  private callbacks: GraphInteractionCallbacks | null = null

  private scene: GraphSceneSnapshot | null = null

  private pendingDragGesture: PendingNodeDragGesture | null = null

  private suppressedClick: SuppressedNodeClick | null = null

  private suppressedStageClickUntil = 0

  private lastOutsideNodeFocusClearAt = 0

  private draggedNodePubkey: string | null = null

  private shouldPinDraggedNodeOnRelease = false

  private manualDragFixedNodes = new Map<
    string,
    { x: number; y: number; atMs: number }
  >()

  private lastReleasedNodePubkey: string | null = null

  private lastReleasedGraphPosition: { x: number; y: number } | null = null

  private lastReleasedAtMs: number | null = null

  private dragTimeline: DebugDragTimelineEvent[] = []

  private resumePhysicsAfterDrag = true

  private pendingDragFrame: number | null = null

  private pendingPhysicsBridgeFrame: number | null = null

  private pendingFitCameraAfterPhysicsFrame: number | null = null

  private pendingGraphBoundsUnlockFrame: number | null = null

  private graphBoundsUnlockStartedAtMs: number | null = null

  private graphBoundsUnlockDeferredCount = 0

  private shouldRepeatFitCameraUntilPhysicsSettles = false

  private lastPhysicsAutoFitAtMs: number | null = null

  private physicsBridgeViewportCursor = 0

  private physicsBridgeBackgroundCursor = 0

  private physicsBridgeFrameSkipCount = 0

  private pendingGraphPosition: { x: number; y: number } | null = null

  private dragHopDistances: Map<string, number> = new Map()

  private dragInfluenceState: DragNeighborhoodInfluenceState | null = null

  private dragInfluenceConfig: DragNeighborhoodInfluenceConfig =
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG

  private lastDragGraphPosition: { x: number; y: number } | null = null

  // Desfase (en coords del grafo) entre donde el usuario tocó/clickeó y el
  // centro del nodo arrastrado. Se aplica en cada frame para que el nodo no
  // teletransporte al puntero al iniciar el drag (sobre todo en mobile).
  private dragAnchorOffset: { dx: number; dy: number } = { dx: 0, dy: 0 }

  private lastDragFlushTimestamp: number | null = null

  private moveBodyCount = 0

  private flushCount = 0

  private lastMoveBodyPointer: { x: number; y: number } | null = null

  private lastScheduledGraphPosition: { x: number; y: number } | null = null

  private lastFlushedGraphPosition: { x: number; y: number } | null = null

  private hoveredNodePubkey: string | null = null

  private hoveredNeighbors: Set<string> = new Set()

  private pendingHoverFocusPubkey: string | null = null

  private hoverFocusDwellTimer: ReturnType<typeof setTimeout> | null = null

  private currentHoverFocus: HoverFocusSnapshot = {
    pubkey: null,
    neighbors: this.hoveredNeighbors,
  }

  private selectedSceneFocus: HoverFocusSnapshot = {
    pubkey: null,
    neighbors: EMPTY_HOVER_NEIGHBORS,
  }

  private draggedNodeFocus: HoverFocusSnapshot = {
    pubkey: null,
    neighbors: EMPTY_HOVER_NEIGHBORS,
  }

  private draggedNodeEdgeIds: Set<string> | null = null

  private rendererFocusEdgeIdsByPubkey = new Map<string, Set<string>>()

  private hideEdgesOnMoveBeforeDrag: boolean | null = null

  private highlightTransition: HighlightTransition | null = null

  private pendingHighlightTransitionFrame: number | null = null

  private isCameraLocked = false

  private isGraphBoundsLocked = false

  private lastRenderInvalidation: DebugRenderInvalidationState['lastInvalidation'] =
    { action: null, atMs: null }

  private avatarCache: AvatarBitmapCache | null = null

  private avatarLoader: AvatarLoader | null = null

  private avatarScheduler: AvatarScheduler | null = null

  private avatarOverlay: AvatarOverlayRenderer | null = null

  private avatarDebugDetailsEnabled = false

  private avatarBudget: PerfBudget | null = null

  private motionActive = false

  private motionClearTimer: ReturnType<typeof setTimeout> | null = null

  private motionClearDeadlineMs = 0

  private cameraMotionActive = false

  private cameraMotionClearTimer: ReturnType<typeof setTimeout> | null = null

  private cameraMotionClearDeadlineMs = 0

  private touchCameraMotionClearTimer: ReturnType<typeof setTimeout> | null =
    null

  private touchCameraMotionClearDeadlineMs = 0

  private touchGestureActive = false

  private touchMouseResumeTimer: ReturnType<typeof setTimeout> | null = null

  private gestureStartListenerCleanup: (() => void) | null = null

  private readonly MOTION_RESUME_MS = 140

  private hideAvatarsOnMove = false

  private avatarImagesEnabled = true

  private hideConnectionsForLowPerformance = false

  private edgeZoomLodEnabled = false

  private collapseMutualEdgesEnabled = false

  private edgeViewportCullingEnabled = false

  private readonly colorWithOpacityCache = new Map<string, string>()

  private cachedViewportBBox: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null

  private avatarRuntimeOptions: AvatarRuntimeOptions =
    DEFAULT_AVATAR_RUNTIME_OPTIONS

  private connectionVisualConfig = DEFAULT_CONNECTION_VISUAL_CONFIG

  private initialCameraZoom = DEFAULT_INITIAL_CAMERA_ZOOM

  private readonly flushContainerRefresh = () => {
    this.pendingContainerRefreshFrame = null

    if (!this.sigma || !hasRenderableSigmaContainer(this.container)) {
      return
    }

    if (this.isCameraInteractionActive()) {
      this.pendingContainerRefresh = true
      return
    }

    this.pendingContainerRefresh = false
    this.recordRenderInvalidation('container-refresh')
    this.traceRendererEvent('safeRefresh.flush', {
      via: 'container-refresh',
    })
    this.sigma.refresh()
  }

  private scheduleContainerRefresh() {
    if (this.pendingContainerRefreshFrame !== null) {
      return
    }

    this.pendingContainerRefreshFrame = requestAnimationFrame(
      this.flushContainerRefresh,
    )
  }

  private safeRefresh() {
    if (!this.sigma) {
      return
    }

    this.recordRenderInvalidation('refresh')
    this.traceRendererEvent('safeRefresh', {
      renderable: hasRenderableSigmaContainer(this.container),
    })

    if (!hasRenderableSigmaContainer(this.container)) {
      this.pendingContainerRefresh = true
      return
    }

    if (this.isCameraInteractionActive()) {
      this.pendingContainerRefresh = true
      return
    }

    this.pendingContainerRefresh = false
    this.scheduleContainerRefresh()
  }

  private safeRender() {
    if (!this.sigma) {
      return
    }

    this.recordRenderInvalidation('render')
    this.traceRendererEvent('safeRender', {
      renderable: hasRenderableSigmaContainer(this.container),
    })

    if (!hasRenderableSigmaContainer(this.container)) {
      this.pendingContainerRefresh = true
      return
    }

    this.sigma.scheduleRender()
  }

  private isCameraInteractionActive() {
    return this.cameraMotionActive || this.touchGestureActive
  }

  private flushDeferredCameraInteractionRefreshes() {
    if (!this.sigma || this.isCameraInteractionActive()) {
      return
    }

    if (!hasRenderableSigmaContainer(this.container)) {
      return
    }

    if (this.pendingContainerRefresh) {
      this.pendingContainerRefresh = false
      this.pendingAvatarSettledRefresh = false
      this.scheduleContainerRefresh()
      return
    }

    if (this.pendingAvatarSettledRefresh) {
      this.pendingAvatarSettledRefresh = false
      this.sigma.scheduleRefresh()
    }
  }

  private recordRenderInvalidation(
    action: DebugRenderInvalidationState['lastInvalidation']['action'],
  ) {
    this.lastRenderInvalidation = {
      action,
      atMs: nowGraphPerfMs(),
    }
  }

  private traceRendererEvent(
    stage: string,
    details: Record<string, unknown> = {},
  ) {
    if (!isGraphPerfTraceEnabled()) {
      return
    }

    const forceRuntime = this.forceRuntime as {
      isRunning?: () => boolean
      isSuspended?: () => boolean
    } | null

    traceGraphPerf(`renderer.${stage}`, {
      ...details,
      graphBoundsLocked: this.isGraphBoundsLocked,
      cameraLocked: this.isCameraLocked,
      draggedNodePubkey: this.draggedNodePubkey,
      pendingDragFrame: this.pendingDragFrame !== null,
      pendingPhysicsBridgeFrame: this.pendingPhysicsBridgeFrame !== null,
      pendingGraphBoundsUnlockFrame: this.pendingGraphBoundsUnlockFrame !== null,
      graphBoundsUnlockStartedAtMs: this.graphBoundsUnlockStartedAtMs,
      graphBoundsUnlockDeferredCount: this.graphBoundsUnlockDeferredCount,
      forceAtlasRunning:
        typeof forceRuntime?.isRunning === 'function'
          ? forceRuntime.isRunning()
          : false,
      forceAtlasSuspended:
        typeof forceRuntime?.isSuspended === 'function'
          ? forceRuntime.isSuspended()
          : false,
    })
  }

  private observeContainer(container: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.sigma || !hasRenderableSigmaContainer(container)) {
        return
      }

      this.scheduleContainerRefresh()
    })
    this.resizeObserver.observe(container)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return
    }

    this.callbacks?.onClearSelection()
  }

  public getNodePosition(pubkey: string): DebugNodePosition | null {
    return this.renderStore?.getNodePosition(pubkey) ?? null
  }

  public getViewportPosition(pubkey: string): DebugNodePosition | null {
    if (!this.sigma) {
      return null
    }

    const position = this.getNodePosition(pubkey)

    if (!position) {
      return null
    }

    return this.sigma.graphToViewport(position)
  }

  public graphToViewport(position: { x: number; y: number }) {
    if (!this.sigma) {
      return null
    }

    return this.sigma.graphToViewport(position)
  }

  public getProjectionDiagnostics(): DebugProjectionDiagnostics {
    const sigma = this.sigma as (Sigma<
      RenderNodeAttributes,
      RenderEdgeAttributes
    > & {
      getDimensions?: () => { width: number; height: number }
      getBBox?: () => { x: [number, number]; y: [number, number] }
      getCustomBBox?: () => { x: [number, number]; y: [number, number] } | null
    }) | null
    const camera =
      typeof sigma?.getCamera === 'function' ? sigma.getCamera() : null
    const cameraState = camera?.getState?.() ?? null
    const hasCustomBBoxGetter = typeof sigma?.getCustomBBox === 'function'

    return {
      graphBoundsLocked: this.isGraphBoundsLocked,
      cameraLocked: this.isCameraLocked,
      dimensions:
        typeof sigma?.getDimensions === 'function'
          ? sigma.getDimensions()
          : this.container
            ? {
                width: this.container.offsetWidth,
                height: this.container.offsetHeight,
              }
            : null,
      camera: cameraState
        ? {
            x: cameraState.x,
            y: cameraState.y,
            ratio: cameraState.ratio,
            angle: cameraState.angle,
          }
        : null,
      bbox: typeof sigma?.getBBox === 'function' ? sigma.getBBox() : null,
      customBBox: hasCustomBBoxGetter ? (sigma.getCustomBBox?.() ?? null) : null,
      customBBoxKnown: hasCustomBBoxGetter,
    }
  }

  public getRenderPhysicsPosition(pubkey: string): DebugRenderPhysicsPosition {
    const renderStore = this.renderStore as
      | (RenderGraphStore & {
          getGraph?: RenderGraphStore['getGraph']
          getNodePosition?: RenderGraphStore['getNodePosition']
        })
      | null
    const physicsStore = this.physicsStore as
      | (PhysicsGraphStore & {
          getGraph?: PhysicsGraphStore['getGraph']
          getNodePosition?: PhysicsGraphStore['getNodePosition']
          isNodeFixed?: PhysicsGraphStore['isNodeFixed']
        })
      | null
    const renderGraph =
      typeof renderStore?.getGraph === 'function'
        ? renderStore.getGraph()
        : null
    const physicsGraph =
      typeof physicsStore?.getGraph === 'function'
        ? physicsStore.getGraph()
        : null
    const renderAttributes =
      renderGraph?.hasNode(pubkey) === true
        ? renderGraph.getNodeAttributes(pubkey)
        : null
    const physicsAttributes =
      physicsGraph?.hasNode(pubkey) === true
        ? physicsGraph.getNodeAttributes(pubkey)
        : null
    const renderFallbackPosition =
      renderAttributes || typeof renderStore?.getNodePosition !== 'function'
        ? null
        : renderStore.getNodePosition(pubkey)
    const physicsFallbackPosition =
      physicsAttributes || typeof physicsStore?.getNodePosition !== 'function'
        ? null
        : physicsStore.getNodePosition(pubkey)

    return {
      render: renderAttributes
        ? { x: renderAttributes.x, y: renderAttributes.y }
        : renderFallbackPosition
          ? { x: renderFallbackPosition.x, y: renderFallbackPosition.y }
        : null,
      physics: physicsAttributes
        ? { x: physicsAttributes.x, y: physicsAttributes.y }
        : physicsFallbackPosition
          ? { x: physicsFallbackPosition.x, y: physicsFallbackPosition.y }
        : null,
      renderFixed: renderAttributes?.fixed ?? null,
      physicsFixed:
        physicsAttributes?.fixed ??
        (typeof physicsStore?.isNodeFixed === 'function'
          ? physicsStore.isNodeFixed(pubkey)
          : null),
    }
  }

  public getRenderInvalidationState(): DebugRenderInvalidationState {
    return {
      pendingContainerRefresh: this.pendingContainerRefresh,
      pendingContainerRefreshFrame: this.pendingContainerRefreshFrame !== null,
      pendingDragFrame: this.pendingDragFrame !== null,
      pendingPhysicsBridgeFrame: this.pendingPhysicsBridgeFrame !== null,
      pendingFitCameraAfterPhysicsFrame:
        this.pendingFitCameraAfterPhysicsFrame !== null,
      pendingGraphBoundsUnlockFrame: this.pendingGraphBoundsUnlockFrame !== null,
      graphBoundsUnlockStartedAtMs: this.graphBoundsUnlockStartedAtMs,
      graphBoundsUnlockDeferredCount: this.graphBoundsUnlockDeferredCount,
      graphBoundsLocked: this.isGraphBoundsLocked,
      cameraLocked: this.isCameraLocked,
      forceAtlasRunning: this.forceRuntime?.isRunning() ?? false,
      forceAtlasSuspended: this.forceRuntime?.isSuspended() ?? false,
      lastInvalidation: this.lastRenderInvalidation,
    }
  }

  public getDragTimeline(): DebugDragTimelineEvent[] {
    return this.dragTimeline.map((event) => ({
      ...event,
      pointerViewport: event.pointerViewport
        ? { ...event.pointerViewport }
        : null,
      pointerGraph: event.pointerGraph ? { ...event.pointerGraph } : null,
      nodeRenderPosition: event.nodeRenderPosition
        ? { ...event.nodeRenderPosition }
        : null,
      nodePhysicsPosition: event.nodePhysicsPosition
        ? { ...event.nodePhysicsPosition }
        : null,
      nodeViewportPosition: event.nodeViewportPosition
        ? { ...event.nodeViewportPosition }
        : null,
      camera: event.camera ? { ...event.camera } : null,
      bbox: event.bbox
        ? { x: [...event.bbox.x], y: [...event.bbox.y] }
        : null,
      customBBox: event.customBBox
        ? { x: [...event.customBBox.x], y: [...event.customBBox.y] }
        : null,
      details: event.details ? { ...event.details } : undefined,
    }))
  }

  private recordDragTimelineEvent(
    stage: DebugDragTimelineStage,
    options: {
      pubkey?: string | null
      pointerViewport?: { x: number; y: number } | null
      pointerGraph?: { x: number; y: number } | null
      details?: Record<string, unknown>
    } = {},
  ) {
    const pubkey =
      options.pubkey ?? this.draggedNodePubkey ?? this.lastReleasedNodePubkey
    const renderPhysics = pubkey
      ? this.getRenderPhysicsPosition(pubkey)
      : {
          render: null,
          physics: null,
          renderFixed: null,
          physicsFixed: null,
        }
    const projection = this.getProjectionDiagnostics()
    const canProjectViewport =
      typeof (this.sigma as { graphToViewport?: unknown } | null)
        ?.graphToViewport === 'function'
    const viewportPosition =
      pubkey && canProjectViewport ? this.getViewportPosition(pubkey) : null
    const forceRuntime = this.forceRuntime as {
      isRunning?: () => boolean
      isSuspended?: () => boolean
    } | null
    const event: DebugDragTimelineEvent = {
      stage,
      timestampMs: getRendererNowMs(),
      pubkey,
      pointerViewport: options.pointerViewport
        ? { x: options.pointerViewport.x, y: options.pointerViewport.y }
        : null,
      pointerGraph: options.pointerGraph
        ? { x: options.pointerGraph.x, y: options.pointerGraph.y }
        : null,
      nodeRenderPosition: renderPhysics.render,
      nodePhysicsPosition: renderPhysics.physics,
      nodeViewportPosition: viewportPosition
        ? { x: viewportPosition.x, y: viewportPosition.y }
        : null,
      camera: projection.camera,
      bbox: projection.bbox,
      customBBox: projection.customBBox,
      graphBoundsLocked: this.isGraphBoundsLocked,
      pendingGraphBoundsUnlockFrame:
        this.pendingGraphBoundsUnlockFrame !== null,
      graphBoundsUnlockDeferredCount: this.graphBoundsUnlockDeferredCount,
      manualDragFixedNodeCount: this.manualDragFixedNodes.size,
      renderFixed: renderPhysics.renderFixed,
      physicsFixed: renderPhysics.physicsFixed,
      forceAtlasRunning:
        typeof forceRuntime?.isRunning === 'function'
          ? forceRuntime.isRunning()
          : false,
      forceAtlasSuspended:
        typeof forceRuntime?.isSuspended === 'function'
          ? forceRuntime.isSuspended()
          : false,
      details: options.details,
    }

    this.dragTimeline.push(event)
    if (this.dragTimeline.length > DRAG_TIMELINE_LIMIT) {
      this.dragTimeline.splice(
        0,
        this.dragTimeline.length - DRAG_TIMELINE_LIMIT,
      )
    }
  }

  public getNeighborGroups(pubkey: string): DebugNeighborGroups | null {
    if (!this.physicsStore) {
      return null
    }

    const graph = this.physicsStore.getGraph()

    if (!graph.hasNode(pubkey)) {
      return null
    }

    const depth1 = new Set<string>()
    const depth2 = new Set<string>()
    const depth3 = new Set<string>()

    graph.forEachNeighbor(pubkey, (neighborPubkey) => {
      depth1.add(neighborPubkey)
    })

    for (const neighborPubkey of depth1) {
      graph.forEachNeighbor(neighborPubkey, (candidatePubkey) => {
        if (candidatePubkey === pubkey || depth1.has(candidatePubkey)) {
          return
        }

        depth2.add(candidatePubkey)
      })
    }

    for (const neighborPubkey of depth2) {
      graph.forEachNeighbor(neighborPubkey, (candidatePubkey) => {
        if (
          candidatePubkey === pubkey ||
          depth1.has(candidatePubkey) ||
          depth2.has(candidatePubkey)
        ) {
          return
        }

        depth3.add(candidatePubkey)
      })
    }

    const outside = graph
      .nodes()
      .filter(
        (nodePubkey) =>
          nodePubkey !== pubkey &&
          !depth1.has(nodePubkey) &&
          !depth2.has(nodePubkey) &&
          !depth3.has(nodePubkey),
      )
      .sort((left, right) => left.localeCompare(right))

    return {
      sourcePubkey: pubkey,
      depth0: [pubkey],
      depth1: Array.from(depth1).sort((left, right) => left.localeCompare(right)),
      depth2: Array.from(depth2).sort((left, right) => left.localeCompare(right)),
      depth3: Array.from(depth3).sort((left, right) => left.localeCompare(right)),
      outside,
    }
  }

  public findDragCandidate({
    minDegree = 3,
    maxDegree = 10,
  }: {
    minDegree?: number
    maxDegree?: number
  } = {}): DebugDragCandidate | null {
    if (!this.physicsStore) {
      return null
    }

    const graph = this.physicsStore.getGraph()
    const candidates = graph
      .nodes()
      .map((pubkey) => ({
        pubkey,
        degree: graph.degree(pubkey),
      }))
      .filter(
        (candidate) =>
          candidate.degree >= minDegree && candidate.degree <= maxDegree,
      )
      .sort((left, right) => right.degree - left.degree || left.pubkey.localeCompare(right.pubkey))

    return candidates[0] ?? null
  }

  public getDragRuntimeState(): DebugDragRuntimeState {
    const hopEntries = Array.from(this.dragHopDistances.entries())
      .filter(([pubkey]) => pubkey !== this.draggedNodePubkey)
      .sort(
        (left, right) =>
          left[1] - right[1] || left[0].localeCompare(right[0]),
      )
    const maxHopDistance = hopEntries.reduce(
      (max, [, hop]) => (hop > max ? hop : max),
      0,
    )

    return {
      draggedNodePubkey: this.draggedNodePubkey,
      pendingDragGesturePubkey: this.pendingDragGesture?.pubkey ?? null,
      lastReleasedNodePubkey: this.lastReleasedNodePubkey,
      lastReleasedGraphPosition: this.lastReleasedGraphPosition,
      lastReleasedAtMs: this.lastReleasedAtMs,
      manualDragFixedNodeCount: this.manualDragFixedNodes.size,
      forceAtlasRunning: this.forceRuntime?.isRunning() ?? false,
      forceAtlasSuspended: this.forceRuntime?.isSuspended() ?? false,
      moveBodyCount: this.moveBodyCount,
      flushCount: this.flushCount,
      lastMoveBodyPointer: this.lastMoveBodyPointer,
      lastScheduledGraphPosition: this.lastScheduledGraphPosition,
      lastFlushedGraphPosition: this.lastFlushedGraphPosition,
      influencedNodeCount: hopEntries.length,
      maxHopDistance: hopEntries.length > 0 ? maxHopDistance : null,
      influenceHopSample: hopEntries
        .slice(0, 12)
        .map(([pubkey, hopDistance]) => ({ pubkey, hopDistance })),
    }
  }

  public getPhysicsDiagnostics(): DebugPhysicsDiagnostics | null {
    return this.forceRuntime?.getDiagnostics() ?? null
  }

  public setPhysicsTuning(tuning: Partial<ForceAtlasPhysicsTuning>) {
    this.forceRuntime?.setPhysicsTuning(tuning)
    this.ensurePhysicsPositionBridge()
  }

  public setAutoFreezeEnabled(enabled: boolean) {
    this.forceRuntime?.setAutoFreezeEnabled(enabled)
    this.ensurePhysicsPositionBridge()
  }

  public setPhysicsSuspended(suspended: boolean) {
    if (!this.forceRuntime) return
    if (this.draggedNodePubkey) {
      this.resumePhysicsAfterDrag = !suspended
    }
    if (suspended) {
      this.forceRuntime.suspend()
      this.cancelPhysicsPositionBridge()
    } else {
      this.forceRuntime.resume()
      this.ensurePhysicsPositionBridge()
    }
  }

  public setNodePinned(pubkey: string, pinned: boolean) {
    this.manualDragFixedNodes.delete(pubkey)

    const position =
      this.renderStore?.getNodePosition(pubkey) ??
      this.physicsStore?.getNodePosition(pubkey)

    if (!position) {
      this.physicsStore?.setNodeFixed(pubkey, pinned)
      this.forceRuntime?.reheat()
      this.ensurePhysicsPositionBridge()
      return
    }

    this.renderStore?.setNodePosition(pubkey, position.x, position.y)
    this.physicsStore?.setNodePosition(pubkey, position.x, position.y, pinned)
    this.nodeHitTester?.markDirty()
    this.forceRuntime?.reheat()
    this.safeRefresh()
    this.ensurePhysicsPositionBridge()
  }

  public placeDetachedNode(pubkey: string) {
    if (!this.renderStore || !this.physicsStore) {
      return false
    }

    const renderGraph = this.renderStore.getGraph()
    if (!renderGraph.hasNode(pubkey)) {
      return false
    }

    const targetAttributes = renderGraph.getNodeAttributes(pubkey)
    const targetPosition = resolveDetachedNodePlacement({
      nodes: renderGraph
        .nodes()
        .map((nodePubkey) => {
          const attributes = renderGraph.getNodeAttributes(nodePubkey)
          return {
            pubkey: nodePubkey,
            size: attributes.size,
            x: attributes.x,
            y: attributes.y,
          }
        }),
      targetPubkey: pubkey,
      targetSize: targetAttributes.size,
    })

    this.manualDragFixedNodes.delete(pubkey)
    this.renderStore.setNodePosition(pubkey, targetPosition.x, targetPosition.y)
    this.physicsStore.setNodePosition(
      pubkey,
      targetPosition.x,
      targetPosition.y,
      true,
    )
    this.nodeHitTester?.markDirty()
    this.safeRefresh()
    return true
  }

  private rememberReleasedNodePosition(
    pubkey: string,
    position: { x: number; y: number },
  ) {
    const atMs = getRendererNowMs()
    const lock = { x: position.x, y: position.y, atMs }
    this.lastReleasedNodePubkey = pubkey
    this.lastReleasedGraphPosition = { x: position.x, y: position.y }
    this.lastReleasedAtMs = atMs
    this.manualDragFixedNodes.set(pubkey, lock)
    this.applyManualDragFixedNode(pubkey, lock)
  }

  private applyManualDragFixedNode(
    pubkey: string,
    lock: { x: number; y: number },
  ) {
    let changed = false
    const renderStore = this.renderStore as
      | (RenderGraphStore & { hasNode?: (pubkey: string) => boolean })
      | null
    const physicsStore = this.physicsStore as
      | (PhysicsGraphStore & { hasNode?: (pubkey: string) => boolean })
      | null
    const renderCanSetPosition =
      typeof renderStore?.setNodePosition === 'function'
    const physicsCanSetPosition =
      typeof physicsStore?.setNodePosition === 'function'
    const physicsCanSetFixed = typeof physicsStore?.setNodeFixed === 'function'
    const renderHasNode =
      renderCanSetPosition &&
      (typeof renderStore?.hasNode === 'function'
        ? renderStore.hasNode(pubkey)
        : typeof renderStore?.getNodePosition === 'function'
          ? (renderStore.getNodePosition(pubkey) ?? null) !== null
          : true)
    const physicsHasNode =
      (physicsCanSetPosition || physicsCanSetFixed) &&
      (typeof physicsStore?.hasNode === 'function'
        ? physicsStore.hasNode(pubkey)
        : typeof physicsStore?.getNodePosition === 'function'
          ? (physicsStore.getNodePosition(pubkey) ?? null) !== null
          : true)

    if (renderHasNode) {
      changed = renderStore?.setNodePosition(pubkey, lock.x, lock.y) || changed
    }
    if (physicsHasNode) {
      if (physicsCanSetPosition) {
        changed =
          physicsStore?.setNodePosition(pubkey, lock.x, lock.y, true) ||
          changed
      } else {
        physicsStore?.setNodeFixed(pubkey, true)
        changed = true
      }
    }

    if (changed) {
      this.nodeHitTester?.markDirty()
    }
    return renderHasNode || physicsHasNode
  }

  private applyManualDragFixedNodes() {
    if (this.manualDragFixedNodes.size === 0) {
      return
    }

    const pinnedPubkeys = new Set(this.scene?.render.pins.pubkeys ?? [])
    for (const [pubkey, lock] of this.manualDragFixedNodes) {
      const applied = this.applyManualDragFixedNode(pubkey, lock)
      if (!applied || pinnedPubkeys.has(pubkey)) {
        this.manualDragFixedNodes.delete(pubkey)
      }
    }
  }

  private clearManualDragFixedNode(pubkey: string, keepFixed = false) {
    const lock = this.manualDragFixedNodes.get(pubkey)
    if (!lock) {
      return false
    }

    this.manualDragFixedNodes.delete(pubkey)

    const shouldRemainFixed =
      keepFixed || (this.scene?.render.pins.pubkeys ?? []).includes(pubkey)
    const position = {
      x: lock.x,
      y: lock.y,
    }
    let changed = false
    const renderCanSetPosition =
      typeof this.renderStore?.setNodePosition === 'function'
    const renderHasPosition =
      typeof this.renderStore?.getNodePosition === 'function'
        ? this.renderStore.getNodePosition(pubkey) !== null
        : renderCanSetPosition
    const physicsCanSetPosition =
      typeof this.physicsStore?.setNodePosition === 'function'
    const physicsHasPosition =
      typeof this.physicsStore?.getNodePosition === 'function'
        ? this.physicsStore.getNodePosition(pubkey) !== null
        : physicsCanSetPosition

    if (renderCanSetPosition && renderHasPosition) {
      changed =
        this.renderStore!.setNodePosition(pubkey, position.x, position.y) ||
        changed
    }
    if (physicsCanSetPosition && physicsHasPosition) {
      changed =
        this.physicsStore!.setNodePosition(
          pubkey,
          position.x,
          position.y,
          shouldRemainFixed,
        ) || changed
    } else if (typeof this.physicsStore?.setNodeFixed === 'function') {
      this.physicsStore?.setNodeFixed(pubkey, shouldRemainFixed)
    }

    if (changed) {
      this.nodeHitTester?.markDirty()
    }
    this.traceRendererEvent('releaseDrag.manualFixedLock.clear', {
      pubkey,
      keepFixed: shouldRemainFixed,
      position,
    })
    this.recordDragTimelineEvent('manual-lock-clear', {
      pubkey,
      details: {
        keepFixed: shouldRemainFixed,
        position,
      },
    })
    return true
  }

  private createPhysicsSceneWithManualDragFixes(
    scene: GraphPhysicsSnapshot,
  ): GraphPhysicsSnapshot {
    if (this.manualDragFixedNodes.size === 0) {
      return scene
    }

    let changed = false
    const nodes = scene.nodes.map((node) => {
      if (!this.manualDragFixedNodes.has(node.pubkey) || node.fixed) {
        return node
      }
      changed = true
      return { ...node, fixed: true }
    })

    return changed ? { ...scene, nodes } : scene
  }

  public recenterCamera() {
    this.sigma?.getCamera().animatedReset({ duration: 250 }).catch(() => {})
  }

  public fitCameraToGraph() {
    const sigma = this.sigma
    const renderStore = this.renderStore
    if (!sigma || !renderStore) {
      return false
    }

    const graph = renderStore.getGraph()
    if (graph.order === 0) {
      return false
    }

    const dimensions = sigma.getDimensions()
    if (dimensions.width <= 0 || dimensions.height <= 0) {
      return false
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    graph.forEachNode((_, attrs) => {
      if (attrs.hidden || !Number.isFinite(attrs.x) || !Number.isFinite(attrs.y)) {
        return
      }
      minX = Math.min(minX, attrs.x)
      minY = Math.min(minY, attrs.y)
      maxX = Math.max(maxX, attrs.x)
      maxY = Math.max(maxY, attrs.y)
    })

    if (!Number.isFinite(minX)) {
      return false
    }

    const centerGraph = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    }
    const centerViewport = sigma.graphToViewport(centerGraph)
    const centerFramed = sigma.viewportToFramedGraph(centerViewport)
    const camera = sigma.getCamera()
    const baseState = {
      ...camera.getState(),
      x: centerFramed.x,
      y: centerFramed.y,
      ratio: 1,
      angle: 0,
    }

    const corners = [
      sigma.graphToViewport({ x: minX, y: minY }, { cameraState: baseState }),
      sigma.graphToViewport({ x: maxX, y: minY }, { cameraState: baseState }),
      sigma.graphToViewport({ x: maxX, y: maxY }, { cameraState: baseState }),
      sigma.graphToViewport({ x: minX, y: maxY }, { cameraState: baseState }),
    ]
    let minViewportX = Infinity
    let minViewportY = Infinity
    let maxViewportX = -Infinity
    let maxViewportY = -Infinity
    for (const point of corners) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue
      }
      minViewportX = Math.min(minViewportX, point.x)
      minViewportY = Math.min(minViewportY, point.y)
      maxViewportX = Math.max(maxViewportX, point.x)
      maxViewportY = Math.max(maxViewportY, point.y)
    }

    const viewportWidth = maxViewportX - minViewportX
    const viewportHeight = maxViewportY - minViewportY
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
      return false
    }

    const paddingRatio = 0.12
    const availableWidth = Math.max(1, dimensions.width * (1 - paddingRatio * 2))
    const availableHeight = Math.max(1, dimensions.height * (1 - paddingRatio * 2))
    const nextRatio =
      viewportWidth <= 0 && viewportHeight <= 0
        ? 1
        : camera.getBoundedRatio(
            Math.max(
              viewportWidth / availableWidth,
              viewportHeight / availableHeight,
              0.05,
            ),
          )

    camera
      .animate({ ...baseState, ratio: nextRatio }, { duration: 250 })
      .catch(() => {})
    return true
  }

  public fitCameraToGraphAfterPhysicsSettles() {
    this.cancelPendingFitCameraAfterPhysics()
    this.shouldRepeatFitCameraUntilPhysicsSettles = false
    this.lastPhysicsAutoFitAtMs = null
    this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(
      this.flushFitCameraAfterPhysicsSettles,
    )
  }

  public fitCameraToGraphWhilePhysicsSettles() {
    this.cancelPendingFitCameraAfterPhysics()
    this.shouldRepeatFitCameraUntilPhysicsSettles = true
    this.lastPhysicsAutoFitAtMs = null
    this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(
      this.flushFitCameraAfterPhysicsSettles,
    )
  }

  public zoomIn() {
    this.sigma?.getCamera().animatedZoom({ duration: 180 }).catch(() => {})
  }

  public zoomOut() {
    this.sigma?.getCamera().animatedUnzoom({ duration: 180 }).catch(() => {})
  }

  /**
   * Pan the camera so that a graph-space coordinate lands at the viewport
   * center. Used by the minimap for click/drag navigation. The two-step
   * graph→viewport→framedGraph transform is a round-trip that yields the
   * target's framed-graph position (what the camera state expects).
   */
  public panCameraToGraph(graphX: number, graphY: number, options?: { animate?: boolean }) {
    const sigma = this.sigma
    if (!sigma) return
    const viewportPoint = sigma.graphToViewport({ x: graphX, y: graphY })
    const framed = sigma.viewportToFramedGraph(viewportPoint)
    const camera = sigma.getCamera()
    const state = camera.getState()
    if (options?.animate === false) {
      camera.setState({ ...state, x: framed.x, y: framed.y })
    } else {
      camera.animate({ x: framed.x, y: framed.y, ratio: state.ratio, angle: state.angle }, { duration: 180 })
    }
  }

  /**
   * Subscribe to camera-updated events. The minimap uses this to redraw
   * only when the viewport or layout shifts — no more continuous RAF.
   * Returns an unsubscribe fn.
   */
  public subscribeToRenderTicks(listener: () => void): () => void {
    const sigma = this.sigma
    if (!sigma) return () => {}
    const camera = sigma.getCamera()
    const onCam = () => listener()
    const onRender = () => listener()
    camera.on('updated', onCam)
    sigma.on('afterRender', onRender)
    return () => {
      camera.off('updated', onCam)
      sigma.off('afterRender', onRender)
    }
  }

  public subscribeToVisibleNodeTicks(
    listener: (visibleNodePubkeys: readonly string[]) => void,
  ): () => void {
    const sigma = this.sigma
    if (!sigma) return () => {}
    const onRender = () => listener(this.getVisibleNodePubkeys())
    sigma.on('afterRender', onRender)
    return () => {
      sigma.off('afterRender', onRender)
    }
  }

  public subscribeToCameraTicks(listener: () => void): () => void {
    const sigma = this.sigma
    if (!sigma) return () => {}
    const camera = sigma.getCamera()
    const onCam = () => listener()
    camera.on('updated', onCam)
    return () => {
      camera.off('updated', onCam)
    }
  }

  /**
   * Coarse snapshot for the minimap. It samples regular nodes aggressively
   * and keeps root / selection exact so navigation stays useful at low cost.
   */
  public getMinimapSnapshot(): {
    nodes: Array<{ x: number; y: number; color: string; isRoot: boolean; isSelected: boolean }>
    bounds: { minX: number; minY: number; maxX: number; maxY: number }
    viewport: { minX: number; minY: number; maxX: number; maxY: number } | null
  } | null {
    const sigma = this.sigma
    if (!this.renderStore || !sigma) return null
    const graph = this.renderStore.getGraph()
    if (graph.order === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const nodes: Array<{ x: number; y: number; color: string; isRoot: boolean; isSelected: boolean }> = []
    const sampleStride = Math.max(1, Math.ceil(graph.order / 96))
    let index = 0
    graph.forEachNode((_, attrs) => {
      index += 1
      const x = attrs.x
      const y = attrs.y
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (index % sampleStride !== 0 && !attrs.isRoot && !attrs.isSelected) return
      nodes.push({
        x,
        y,
        color: attrs.color ?? '#7dd3a7',
        isRoot: !!attrs.isRoot,
        isSelected: !!attrs.isSelected,
      })
    })
    if (!Number.isFinite(minX)) return null
    return {
      nodes,
      bounds: { minX, minY, maxX, maxY },
      viewport: this.getMinimapViewport(),
    }
  }

  public getMinimapViewport(): {
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null {
    const sigma = this.sigma
    if (!sigma) return null
    const dimensions = sigma.getDimensions()
    if (dimensions.width <= 0 || dimensions.height <= 0) return null
    const viewportCorners = [
      sigma.viewportToGraph({ x: 0, y: 0 }),
      sigma.viewportToGraph({ x: dimensions.width, y: 0 }),
      sigma.viewportToGraph({ x: dimensions.width, y: dimensions.height }),
      sigma.viewportToGraph({ x: 0, y: dimensions.height }),
    ]
    return viewportCorners.reduce<{
      minX: number
      minY: number
      maxX: number
      maxY: number
    } | null>((acc, point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return acc
      if (!acc) {
        return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
      }
      return {
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }
    }, null)
  }

  public setHideAvatarsOnMove(enabled: boolean) {
    if (this.hideAvatarsOnMove === enabled) {
      return
    }

    this.hideAvatarsOnMove = enabled
    this.safeRefresh()
  }

  public setAvatarImagesEnabled(enabled: boolean) {
    if (this.avatarImagesEnabled === enabled) {
      return
    }

    this.avatarImagesEnabled = enabled
    if (enabled) {
      this.avatarBudget?.enable()
    } else {
      this.avatarBudget?.disable()
    }
    this.safeRefresh()
  }

  public setHideConnectionsForLowPerformance(enabled: boolean) {
    if (this.hideConnectionsForLowPerformance === enabled) {
      return
    }

    this.hideConnectionsForLowPerformance = enabled
    this.safeRender()
  }

  public setConnectionVisualConfig(config: ConnectionVisualConfig) {
    const nextConfig = normalizeConnectionVisualConfig(config)
    if (
      this.connectionVisualConfig.opacity === nextConfig.opacity &&
      this.connectionVisualConfig.thicknessScale === nextConfig.thicknessScale &&
      this.connectionVisualConfig.colorMode === nextConfig.colorMode &&
      this.connectionVisualConfig.focusStyle === nextConfig.focusStyle
    ) {
      return
    }

    this.connectionVisualConfig = nextConfig
    this.colorWithOpacityCache.clear()
    this.safeRender()
  }

  public setAvatarRuntimeOptions(options: AvatarRuntimeOptions) {
    const nextOptions: AvatarRuntimeOptions = {
      sizeThreshold: clampNumber(
        options.sizeThreshold,
        AVATAR_MIN_SIZE_THRESHOLD,
        AVATAR_MAX_SIZE_THRESHOLD,
      ),
      zoomThreshold: clampNumber(
        options.zoomThreshold,
        AVATAR_MIN_ZOOM_THRESHOLD,
        AVATAR_MAX_ZOOM_THRESHOLD,
      ),
      hoverRevealRadiusPx: clampNumber(
        options.hoverRevealRadiusPx,
        AVATAR_MIN_HOVER_REVEAL_RADIUS,
        AVATAR_MAX_HOVER_REVEAL_RADIUS,
      ),
      hoverRevealMaxNodes: Math.round(
        clampNumber(
          options.hoverRevealMaxNodes ??
            DEFAULT_AVATAR_RUNTIME_OPTIONS.hoverRevealMaxNodes,
          AVATAR_MIN_HOVER_REVEAL_MAX_NODES,
          AVATAR_MAX_HOVER_REVEAL_MAX_NODES,
        ),
      ),
      showZoomedOutMonograms:
        options.showZoomedOutMonograms ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.showZoomedOutMonograms,
      showMonogramBackgrounds:
        options.showMonogramBackgrounds ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.showMonogramBackgrounds,
      showMonogramText:
        options.showMonogramText ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.showMonogramText,
      hideImagesOnFastNodes: options.hideImagesOnFastNodes,
      fastNodeVelocityThreshold: clampNumber(
        options.fastNodeVelocityThreshold,
        AVATAR_MIN_FAST_NODE_VELOCITY,
        AVATAR_MAX_FAST_NODE_VELOCITY,
      ),
      allowZoomedOutImages:
        options.allowZoomedOutImages ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.allowZoomedOutImages,
      showAllVisibleImages:
        options.showAllVisibleImages ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.showAllVisibleImages,
      maxInteractiveBucket: normalizeBucketOption(
        options.maxInteractiveBucket,
        AVATAR_MAX_INTERACTIVE_BUCKETS,
        DEFAULT_AVATAR_RUNTIME_OPTIONS.maxInteractiveBucket,
      ),
    }

    if (
      this.avatarRuntimeOptions.sizeThreshold === nextOptions.sizeThreshold &&
      this.avatarRuntimeOptions.zoomThreshold === nextOptions.zoomThreshold &&
      this.avatarRuntimeOptions.hoverRevealRadiusPx ===
        nextOptions.hoverRevealRadiusPx &&
      this.avatarRuntimeOptions.hoverRevealMaxNodes ===
        nextOptions.hoverRevealMaxNodes &&
      this.avatarRuntimeOptions.showZoomedOutMonograms ===
        nextOptions.showZoomedOutMonograms &&
      this.avatarRuntimeOptions.showMonogramBackgrounds ===
        nextOptions.showMonogramBackgrounds &&
      this.avatarRuntimeOptions.showMonogramText ===
        nextOptions.showMonogramText &&
      this.avatarRuntimeOptions.hideImagesOnFastNodes ===
        nextOptions.hideImagesOnFastNodes &&
      this.avatarRuntimeOptions.fastNodeVelocityThreshold ===
        nextOptions.fastNodeVelocityThreshold &&
      this.avatarRuntimeOptions.allowZoomedOutImages ===
        nextOptions.allowZoomedOutImages &&
      this.avatarRuntimeOptions.showAllVisibleImages ===
        nextOptions.showAllVisibleImages &&
      this.avatarRuntimeOptions.maxInteractiveBucket ===
        nextOptions.maxInteractiveBucket
    ) {
      return
    }

    this.avatarRuntimeOptions = nextOptions
    this.safeRefresh()
  }

  public getAvatarPerfSnapshot(): PerfBudgetSnapshot | null {
    return this.avatarBudget?.snapshot() ?? null
  }

  // P1: Cached opacity application — avoids hex-parse + rgba template on every edge per frame.
  private resolveColorWithOpacity(hexColor: string, opacityScale: number): string {
    const normalizedOpacityScale = Number.isFinite(opacityScale)
      ? clampNumber(opacityScale, 0, 1)
      : 1
    const effectiveOpacity =
      this.connectionVisualConfig.opacity * normalizedOpacityScale
    const cacheKey = `${hexColor}|${effectiveOpacity.toFixed(4)}`
    let cached = this.colorWithOpacityCache.get(cacheKey)
    if (cached === undefined) {
      cached = applyColorOpacity(hexColor, effectiveOpacity)
      this.colorWithOpacityCache.set(cacheKey, cached)
    }
    return cached
  }

  // P2: Toggle zoom-based LOD that hides lightweight edges when zoomed out.
  public setEdgeZoomLodEnabled(enabled: boolean) {
    if (this.edgeZoomLodEnabled === enabled) {
      return
    }
    this.edgeZoomLodEnabled = enabled
    this.safeRender()
  }

  // P3: Toggle that collapses A→B / B→A mutual-follow pairs into a single edge.
  public setCollapseMutualEdgesEnabled(enabled: boolean) {
    if (this.collapseMutualEdgesEnabled === enabled) {
      return
    }
    this.collapseMutualEdgesEnabled = enabled
    if (this.scene && this.renderStore) {
      this.renderStore.applyScene(this.buildRenderSnapshot(this.scene.render))
      this.safeRefresh()
    }
  }

  private buildRenderSnapshot(
    snapshot: GraphSceneSnapshot['render'],
  ): GraphSceneSnapshot['render'] {
    if (!this.collapseMutualEdgesEnabled) {
      return snapshot
    }
    const seenPairs = new Set<string>()
    const filteredEdges = snapshot.visibleEdges.filter((edge) => {
      const reverseKey = `${edge.target}\x00${edge.source}`
      if (seenPairs.has(reverseKey)) {
        return false
      }
      seenPairs.add(`${edge.source}\x00${edge.target}`)
      return true
    })
    if (filteredEdges.length === snapshot.visibleEdges.length) {
      return snapshot
    }
    return { ...snapshot, visibleEdges: filteredEdges }
  }

  // P4: Toggle that hides edges whose both endpoints are outside the visible viewport.
  public setEdgeViewportCullingEnabled(enabled: boolean) {
    if (this.edgeViewportCullingEnabled === enabled) {
      return
    }
    this.edgeViewportCullingEnabled = enabled
    this.safeRender()
  }

  private readonly updateViewportBBox = () => {
    const sigma = this.sigma
    if (!sigma) {
      this.cachedViewportBBox = null
      return
    }
    const dims = sigma.getDimensions()
    if (dims.width <= 0 || dims.height <= 0) {
      this.cachedViewportBBox = null
      return
    }
    const m = EDGE_VIEWPORT_CULLING_MARGIN
    // Convert viewport corners (with margin) to graph-space coordinates.
    const corners = [
      sigma.viewportToGraph({ x: -m, y: -m }),
      sigma.viewportToGraph({ x: dims.width + m, y: -m }),
      sigma.viewportToGraph({ x: -m, y: dims.height + m }),
      sigma.viewportToGraph({ x: dims.width + m, y: dims.height + m }),
    ]
    this.cachedViewportBBox = {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y)),
    }
  }

  // P5: Toggle for Barnes-Hut optimization at a lower node-count threshold (500 vs 2000).
  public setAggressiveBarnesHutEnabled(enabled: boolean) {
    this.forceRuntime?.setAggressiveBarnesHutEnabled(enabled)
  }

  public setAvatarDebugDetailsEnabled(enabled: boolean) {
    if (this.avatarDebugDetailsEnabled === enabled) {
      return
    }
    this.avatarDebugDetailsEnabled = enabled
    this.avatarOverlay?.setDebugDetailsEnabled(enabled)
    if (enabled) {
      this.safeRefresh()
    }
  }

  public getAvatarRuntimeDebugSnapshot(options?: {
    includeOverlayNodes?: boolean
  }): AvatarRuntimeStateDebugSnapshot | null {
    if (!this.sigma) {
      return null
    }

    const restoreDebugDetails = options?.includeOverlayNodes
      ? !this.avatarDebugDetailsEnabled
      : false
    if (options?.includeOverlayNodes) {
      this.avatarDebugDetailsEnabled = true
      this.avatarOverlay?.setDebugDetailsEnabled(true)
      this.safeRefresh()
    }

    const container = this.container
    const cameraState = this.sigma.getCamera().getState()
    const snapshot = {
      rootPubkey: this.scene?.render.cameraHint.rootPubkey ?? null,
      selectedNodePubkey: this.scene?.render.selection.selectedNodePubkey ?? null,
      viewport:
        container !== null
          ? {
              width: container.clientWidth,
              height: container.clientHeight,
            }
          : null,
      camera: {
        x: cameraState.x,
        y: cameraState.y,
        ratio: cameraState.ratio,
        angle: cameraState.angle,
      },
      physicsRunning: this.forceRuntime?.isRunning() ?? false,
      motionActive: this.motionActive,
      hideAvatarsOnMove: this.hideAvatarsOnMove,
      runtimeOptions: this.avatarRuntimeOptions,
      perfBudget: this.avatarBudget?.snapshot() ?? null,
      cache: this.avatarCache?.getDebugSnapshot() ?? null,
      loader: this.avatarLoader?.getDebugSnapshot() ?? null,
      scheduler: this.avatarScheduler?.getDebugSnapshot() ?? null,
      overlay: this.avatarOverlay?.getDebugSnapshot() ?? null,
    }
    if (restoreDebugDetails) {
      this.avatarDebugDetailsEnabled = false
      this.avatarOverlay?.setDebugDetailsEnabled(false)
    }
    return snapshot
  }

  public getVisibleNodePubkeys(): string[] {
    return this.avatarOverlay?.getVisibleNodePubkeys() ?? []
  }

  public setDragInfluenceTuning(
    tuning: Partial<DragNeighborhoodInfluenceTuning>,
  ) {
    this.dragInfluenceConfig = createDragNeighborhoodInfluenceConfig(tuning)

    if (!this.physicsStore || !this.draggedNodePubkey) {
      return
    }

    this.dragInfluenceState = createDragNeighborhoodInfluenceState(
      this.physicsStore,
      this.draggedNodePubkey,
      this.dragHopDistances,
      this.dragInfluenceConfig,
      this.dragInfluenceState,
    )
  }

  private readonly flushPendingDragFrame = () => {
    this.pendingDragFrame = null

    if (
      !this.sigma ||
      !this.renderStore ||
      !this.physicsStore ||
      !this.callbacks ||
      !this.draggedNodePubkey
    ) {
      return
    }

    this.markMotion()
    this.flushCount += 1
    const draggedNodePubkey = this.draggedNodePubkey
    const shouldEmitDragMove = this.pendingGraphPosition !== null
    const graphPosition = this.resolveCurrentDragGraphPosition()
    if (!graphPosition) {
      return
    }
    this.pendingGraphPosition = null
    const now = performance.now()
    const previousTimestamp = this.lastDragFlushTimestamp
    const deltaMs =
      previousTimestamp === null ? 16 : Math.max(now - previousTimestamp, 1)

    const draggedRenderChanged = this.renderStore.setNodePosition(
      draggedNodePubkey,
      graphPosition.x,
      graphPosition.y,
    )
    const physicsChanged = this.physicsStore.setNodePosition(
      draggedNodePubkey,
      graphPosition.x,
      graphPosition.y,
      true,
    )
    const dirtyPubkeys = new Set<string>([draggedNodePubkey])
    this.lastDragGraphPosition = graphPosition
    this.lastFlushedGraphPosition = graphPosition
    let dragInfluenceActive = false
    if (this.dragInfluenceState) {
      const dragStep = stepDragNeighborhoodInfluence(
        this.physicsStore,
        draggedNodePubkey,
        this.dragInfluenceState,
        deltaMs,
        this.dragInfluenceConfig,
      )
      dragInfluenceActive = dragStep.active
      for (const pubkey of dragStep.dirtyPubkeys) {
        dirtyPubkeys.add(pubkey)
      }
    }
    const syncedInfluence = this.syncPhysicsPositionsToRenderForPubkeys(dirtyPubkeys)
    if (draggedRenderChanged || physicsChanged || syncedInfluence) {
      this.nodeHitTester?.markDirty()
    }
    this.lastDragFlushTimestamp = now
    this.traceRendererEvent('flushPendingDragFrame', {
      draggedNodePubkey,
      draggedRenderChanged,
      physicsChanged,
      syncedInfluence,
      dirtyPubkeyCount: dirtyPubkeys.size,
      dragInfluenceActive,
      shouldEmitDragMove,
    })
    this.recordDragTimelineEvent('flush', {
      pubkey: draggedNodePubkey,
      pointerViewport: this.lastMoveBodyPointer,
      pointerGraph: this.lastScheduledGraphPosition,
      details: {
        graphPosition,
        draggedRenderChanged,
        physicsChanged,
        syncedInfluence,
        dirtyPubkeyCount: dirtyPubkeys.size,
        dragInfluenceActive,
        shouldEmitDragMove,
      },
    })
    this.safeRender()
    if (shouldEmitDragMove) {
      this.callbacks.onNodeDragMove(draggedNodePubkey, graphPosition)
    }

    if (
      this.draggedNodePubkey === draggedNodePubkey &&
      (this.pendingGraphPosition !== null || dragInfluenceActive)
    ) {
      this.ensureDragFrame()
    }
  }

  private resolveCurrentDragGraphPosition() {
    const pointerGraphPosition =
      this.pendingGraphPosition ?? this.lastScheduledGraphPosition

    if (pointerGraphPosition) {
      // Aplicar el anchor offset (desfase del clic respecto al centro del nodo)
      // para que el nodo siga al cursor sin teletransportarse al puntero.
      return {
        x: pointerGraphPosition.x + this.dragAnchorOffset.dx,
        y: pointerGraphPosition.y + this.dragAnchorOffset.dy,
      }
    }

    return this.lastDragGraphPosition
  }

  private ensureDragFrame() {
    if (this.pendingDragFrame !== null) {
      return
    }

    this.pendingDragFrame = requestAnimationFrame(this.flushPendingDragFrame)
  }

  private readonly scheduleDragFrame = (graphPosition: { x: number; y: number }) => {
    this.pendingGraphPosition = graphPosition
    this.lastScheduledGraphPosition = graphPosition

    this.ensureDragFrame()
  }

  private readonly cancelPendingDragFrame = () => {
    if (this.pendingDragFrame !== null) {
      cancelAnimationFrame(this.pendingDragFrame)
      this.pendingDragFrame = null
    }

    this.pendingGraphPosition = null
  }

  private cancelPendingGraphBoundsUnlock() {
    if (this.pendingGraphBoundsUnlockFrame === null) {
      this.graphBoundsUnlockStartedAtMs = null
      this.graphBoundsUnlockDeferredCount = 0
      return
    }

    cancelAnimationFrame(this.pendingGraphBoundsUnlockFrame)
    this.pendingGraphBoundsUnlockFrame = null
    this.graphBoundsUnlockStartedAtMs = null
    this.graphBoundsUnlockDeferredCount = 0
  }

  private collectReleasePhysicsSyncPubkeys(draggedNodePubkey: string) {
    const physicsStore = this.physicsStore
    if (!physicsStore || typeof physicsStore.hasNode !== 'function') {
      return []
    }

    const pubkeys: string[] = []
    const seen = new Set<string>()
    const addPubkey = (pubkey: string | null | undefined) => {
      if (!pubkey || seen.has(pubkey) || !physicsStore.hasNode(pubkey)) {
        return false
      }

      seen.add(pubkey)
      pubkeys.push(pubkey)
      return true
    }

    addPubkey(draggedNodePubkey)
    addPubkey(this.scene?.render.cameraHint.rootPubkey)
    addPubkey(this.scene?.render.selection.selectedNodePubkey)
    addPubkey(this.hoveredNodePubkey)

    for (const pubkey of this.scene?.render.pins.pubkeys ?? []) {
      addPubkey(pubkey)
    }
    this.avatarOverlay?.forEachVisibleNodePubkey(addPubkey)
    for (const pubkey of this.resolveRendererFocus().neighbors) {
      addPubkey(pubkey)
    }
    for (const [pubkey] of this.dragHopDistances) {
      addPubkey(pubkey)
    }
    this.collectViewportRenderPubkeys(addPubkey)

    return pubkeys
  }

  private scheduleGraphBoundsUnlockAfterRelease(
    draggedNodePubkey: string,
    releaseSyncPubkeys: readonly string[],
    keepReleasedNodeFixed: boolean,
    startedAtMs: number = getRendererNowMs(),
    frameDelay = GRAPH_BOUNDS_UNLOCK_INITIAL_FRAME_DELAY,
  ) {
    const shouldPreserveDeferredCount =
      this.graphBoundsUnlockStartedAtMs === startedAtMs
    const deferredCount = shouldPreserveDeferredCount
      ? this.graphBoundsUnlockDeferredCount
      : 0

    this.cancelPendingGraphBoundsUnlock()
    this.graphBoundsUnlockStartedAtMs = startedAtMs
    this.graphBoundsUnlockDeferredCount = deferredCount
    this.recordDragTimelineEvent('unlock-start', {
      pubkey: draggedNodePubkey,
      details: {
        releaseSyncPubkeyCount: releaseSyncPubkeys.length,
        keepReleasedNodeFixed,
        frameDelay,
        startedAtMs,
      },
    })

    const unlock = () => {
      this.pendingGraphBoundsUnlockFrame = null
      this.unlockGraphBoundsAfterRelease(
        draggedNodePubkey,
        releaseSyncPubkeys,
        keepReleasedNodeFixed,
        startedAtMs,
      )
    }

    if (typeof globalThis.requestAnimationFrame !== 'function') {
      unlock()
      return
    }

    const scheduleNextFrame = (remainingFrames: number) => {
      if (typeof globalThis.requestAnimationFrame !== 'function') {
        unlock()
        return
      }
      this.pendingGraphBoundsUnlockFrame = globalThis.requestAnimationFrame(() => {
        if (remainingFrames <= 1) {
          unlock()
          return
        }
        scheduleNextFrame(remainingFrames - 1)
      })
    }

    scheduleNextFrame(Math.max(1, frameDelay))
  }

  private captureCurrentViewportGraphBounds(): GraphBoundsSnapshot | null {
    const sigma = this.sigma as (Sigma<
      RenderNodeAttributes,
      RenderEdgeAttributes
    > & {
      getDimensions?: () => { width: number; height: number }
      viewportToGraph?: (point: { x: number; y: number }) => {
        x: number
        y: number
      }
    }) | null

    if (!sigma || typeof sigma.viewportToGraph !== 'function') {
      return null
    }

    const dimensions =
      typeof sigma.getDimensions === 'function'
        ? sigma.getDimensions()
        : this.container
          ? {
              width: this.container.offsetWidth,
              height: this.container.offsetHeight,
            }
          : null

    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      return null
    }

    const corners = [
      sigma.viewportToGraph({ x: 0, y: 0 }),
      sigma.viewportToGraph({ x: dimensions.width, y: 0 }),
      sigma.viewportToGraph({ x: 0, y: dimensions.height }),
      sigma.viewportToGraph({ x: dimensions.width, y: dimensions.height }),
    ].filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )

    if (corners.length === 0) {
      return null
    }

    return {
      minX: Math.min(...corners.map((point) => point.x)),
      minY: Math.min(...corners.map((point) => point.y)),
      maxX: Math.max(...corners.map((point) => point.x)),
      maxY: Math.max(...corners.map((point) => point.y)),
    }
  }

  private preserveCameraForGraphBounds(bounds: GraphBoundsSnapshot | null) {
    const sigma = this.sigma as (Sigma<
      RenderNodeAttributes,
      RenderEdgeAttributes
    > & {
      getDimensions?: () => { width: number; height: number }
      getBBox?: () => SigmaGraphExtent
      getSetting?: (key: string) => unknown
    }) | null

    if (!sigma || !bounds || typeof sigma.getBBox !== 'function') {
      return false
    }

    const getCamera = (
      sigma as {
        getCamera?: () => ReturnType<
          Sigma<RenderNodeAttributes, RenderEdgeAttributes>['getCamera']
        >
      }
    ).getCamera
    if (typeof getCamera !== 'function') {
      return false
    }

    const camera = getCamera.call(sigma)
    if (
      !camera ||
      typeof camera.getState !== 'function' ||
      typeof camera.setState !== 'function'
    ) {
      return false
    }

    const dimensions =
      typeof sigma.getDimensions === 'function'
        ? sigma.getDimensions()
        : this.container
          ? {
              width: this.container.offsetWidth,
              height: this.container.offsetHeight,
            }
          : null
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      return false
    }

    const bbox = sigma.getBBox()
    const graphWidth = Math.max(bbox.x[1] - bbox.x[0], 1)
    const graphHeight = Math.max(bbox.y[1] - bbox.y[0], 1)
    const centerGraph = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    }
    const minNormalized = normalizeGraphPointForExtent(
      { x: bounds.minX, y: bounds.minY },
      bbox,
    )
    const maxNormalized = normalizeGraphPointForExtent(
      { x: bounds.maxX, y: bounds.maxY },
      bbox,
    )
    const centerNormalized = normalizeGraphPointForExtent(centerGraph, bbox)
    const targetWidth = Math.abs(maxNormalized.x - minNormalized.x)
    const targetHeight = Math.abs(maxNormalized.y - minNormalized.y)
    const stagePadding =
      sigma.getSetting?.('autoRescale') === false
        ? 0
        : Number(sigma.getSetting?.('stagePadding') ?? 0) || 0
    const stageSize = Math.max(
      1,
      Math.min(dimensions.width, dimensions.height) - stagePadding * 2,
    )
    const correction = resolveGraphDimensionCorrection(dimensions, {
      width: graphWidth,
      height: graphHeight,
    })
    const rawRatio = Math.max(
      (targetWidth * stageSize * correction) / Math.max(dimensions.width, 1),
      (targetHeight * stageSize * correction) / Math.max(dimensions.height, 1),
      0.0001,
    )
    const currentState = camera.getState()
    const ratio =
      typeof camera.getBoundedRatio === 'function'
        ? camera.getBoundedRatio(rawRatio)
        : rawRatio

    camera.setState({
      ...currentState,
      x: centerNormalized.x,
      y: centerNormalized.y,
      ratio,
    })
    return true
  }

  private lockGraphBoundsPreservingViewport(
    graphBoundsBBox?: SigmaGraphExtent | null,
  ) {
    const viewportGraphBounds = this.captureCurrentViewportGraphBounds()
    this.setGraphBoundsLocked(true, graphBoundsBBox)
    const preservedViewport =
      this.preserveCameraForGraphBounds(viewportGraphBounds)
    this.traceRendererEvent('startDrag.lockGraphBounds', {
      preservedViewport,
    })
    return preservedViewport
  }

  /**
   * Remap the camera across a BBox unlock transition.
   *
   * While the graph bounds are locked the camera lives in normalised [0,1]²
   * space (the customBBox).  When we unlock, Sigma switches to the real
   * node-extent BBox.  If we just unlock without touching the camera, Sigma
   * re-interprets the same camera.x/y/ratio in the new BBox space which
   * produces a wildly different viewport (usually an extreme zoom-in because
   * the real BBox is hundreds of units wide).
   *
   * This method:
   *  1. Reads camera state + old BBox while still locked.
   *  2. Calls setGraphBoundsLocked(false) → Sigma adopts the real BBox.
   *  3. Reads the new BBox and remaps camera.x / camera.y / camera.ratio
   *     so that the same graph region remains visible.
   */
  private remapCameraAcrossBBoxUnlock(): boolean {
    const sigma = this.sigma as (Sigma<
      RenderNodeAttributes,
      RenderEdgeAttributes
    > & {
      getBBox?: () => SigmaGraphExtent
      getCustomBBox?: () => SigmaGraphExtent | null
      refresh?: () => unknown
    }) | null

    if (!sigma || typeof sigma.getBBox !== 'function') {
      this.setGraphBoundsLocked(false)
      return false
    }

    const camera = sigma.getCamera()
    if (
      !camera ||
      typeof camera.getState !== 'function' ||
      typeof camera.setState !== 'function'
    ) {
      this.setGraphBoundsLocked(false)
      return false
    }

    // 1. Capture state in old (locked) BBox space.
    // While locked Sigma's normalisation runs against `customBBox`, but
    // `getBBox()` returns `nodeExtent` which keeps drifting every render as
    // the dragged node moves (especially noticeable for off-graph zap nodes
    // placed far from the cluster).  Using nodeExtent here makes oldBBox and
    // newBBox effectively identical and the remap collapses into a no-op,
    // letting the camera jump on the next render when normalisation switches
    // back to nodeExtent.  Read the actual locked BBox instead.
    const oldState = camera.getState()
    const lockedCustomBBox =
      typeof sigma.getCustomBBox === 'function'
        ? sigma.getCustomBBox()
        : null
    const oldBBox = lockedCustomBBox ?? sigma.getBBox()

    // Refresh while still locked so Sigma recomputes nodeExtent from the latest
    // graph positions without reinterpreting the current camera yet. During
    // drag most position churn uses render-only scheduling, so getBBox() can
    // otherwise lag behind the graphology coordinates until the next refresh.
    sigma.refresh?.()

    // 2. Unlock → Sigma will adopt the freshly computed nodeExtent.
    this.setGraphBoundsLocked(false)

    const newBBox = sigma.getBBox()

    // 3. Remap camera coordinates
    //
    // Sigma's camera coordinates are normalised: (0.5, 0.5) is the center of
    // the BBox, and `ratio` is the fraction of the BBox visible on screen.
    // To preserve the same graph-space viewport across a BBox change we map:
    //
    //   graphCenter = oldBBox.center + (cam.x - 0.5) * oldBBox.size
    //   newCam.x    = 0.5 + (graphCenter - newBBox.center) / newBBox.size
    //   newCam.ratio = oldCam.ratio * (oldBBox.maxDim / newBBox.maxDim)
    //
    // where size = max(width, height) to match Sigma's internal normalisation.

    const oldWidth = Math.max(oldBBox.x[1] - oldBBox.x[0], 1)
    const oldHeight = Math.max(oldBBox.y[1] - oldBBox.y[0], 1)
    const oldMaxDim = Math.max(oldWidth, oldHeight)
    const oldCenterX = (oldBBox.x[0] + oldBBox.x[1]) / 2
    const oldCenterY = (oldBBox.y[0] + oldBBox.y[1]) / 2

    const newWidth = Math.max(newBBox.x[1] - newBBox.x[0], 1)
    const newHeight = Math.max(newBBox.y[1] - newBBox.y[0], 1)
    const newMaxDim = Math.max(newWidth, newHeight)
    const newCenterX = (newBBox.x[0] + newBBox.x[1]) / 2
    const newCenterY = (newBBox.y[0] + newBBox.y[1]) / 2

    // Graph-space center that was at the camera viewport center
    const graphCenterX = oldCenterX + (oldState.x - 0.5) * oldMaxDim
    const graphCenterY = oldCenterY + (oldState.y - 0.5) * oldMaxDim

    // Remap to new normalised space
    const newX = 0.5 + (graphCenterX - newCenterX) / newMaxDim
    const newY = 0.5 + (graphCenterY - newCenterY) / newMaxDim
    const rawRatio = oldState.ratio * (oldMaxDim / newMaxDim)
    const newRatio =
      typeof camera.getBoundedRatio === 'function'
        ? camera.getBoundedRatio(rawRatio)
        : rawRatio

    camera.setState({
      ...oldState,
      x: newX,
      y: newY,
      ratio: newRatio,
    })

    this.traceRendererEvent('remapCameraAcrossBBoxUnlock', {
      oldBBox,
      oldBBoxSource: lockedCustomBBox ? 'customBBox' : 'nodeExtent',
      newBBox,
      oldState,
      newState: { x: newX, y: newY, ratio: newRatio },
      graphCenter: { x: graphCenterX, y: graphCenterY },
    })
    return true
  }

  private refreshAfterGraphBoundsUnlock() {
    if (!this.sigma) {
      return false
    }

    if (!hasRenderableSigmaContainer(this.container)) {
      this.safeRefresh()
      return false
    }

    this.recordRenderInvalidation('refresh')
    this.traceRendererEvent('releaseDrag.unlockGraphBounds.refresh', {
      immediate: true,
    })
    this.sigma.refresh()
    return true
  }

  private unlockGraphBoundsAfterRelease(
    draggedNodePubkey: string,
    releaseSyncPubkeys: readonly string[],
    keepReleasedNodeFixed: boolean,
    startedAtMs: number,
  ) {
    if (!this.sigma || !this.renderStore || !this.physicsStore) {
      this.setGraphBoundsLocked(false)
      this.graphBoundsUnlockStartedAtMs = null
      this.graphBoundsUnlockDeferredCount = 0
      return
    }

    if (!this.isGraphBoundsLocked) {
      this.graphBoundsUnlockStartedAtMs = null
      this.graphBoundsUnlockDeferredCount = 0
      return
    }

    const forceRuntime = this.forceRuntime as {
      isRunning?: () => boolean
    } | null
    const physicsStillRunning =
      typeof forceRuntime?.isRunning === 'function'
        ? forceRuntime.isRunning()
        : false
    const waitedMs = getRendererNowMs() - startedAtMs
    const shouldDeferForPhysics =
      physicsStillRunning &&
      this.graphBoundsUnlockDeferredCount <
        GRAPH_BOUNDS_UNLOCK_MAX_DEFERRED_FRAMES &&
      waitedMs < GRAPH_BOUNDS_UNLOCK_MAX_WAIT_MS &&
      typeof globalThis.requestAnimationFrame === 'function'
    if (shouldDeferForPhysics) {
      this.graphBoundsUnlockDeferredCount += 1
      this.traceRendererEvent('releaseDrag.unlockGraphBounds.deferred', {
        draggedNodePubkey,
        releaseSyncPubkeyCount: releaseSyncPubkeys.length,
        startedAtMs,
        waitedMs,
        deferredCount: this.graphBoundsUnlockDeferredCount,
      })
      this.scheduleGraphBoundsUnlockAfterRelease(
        draggedNodePubkey,
        releaseSyncPubkeys,
        keepReleasedNodeFixed,
        startedAtMs,
        1,
      )
      this.recordDragTimelineEvent('unlock-defer', {
        pubkey: draggedNodePubkey,
        details: {
          releaseSyncPubkeyCount: releaseSyncPubkeys.length,
          startedAtMs,
          waitedMs,
          deferredCount: this.graphBoundsUnlockDeferredCount,
        },
      })
      return
    }

    // Capture camera state and old BBox *before* unlocking so we can remap
    // the camera into the new coordinate space.  The previous approach used
    // captureCurrentViewportGraphBounds() which called viewportToGraph while
    // the customBBox [0,1] was still active — producing bounds in [0,1] scale.
    // After setGraphBoundsLocked(false) replaced the BBox with the real one
    // (~1920 units wide), preserveCameraForGraphBounds normalised those tiny
    // bounds against the large BBox and computed a microscopic ratio, causing
    // an extreme zoom-in (camera ratio clamped to minCameraRatio = 0.05).
    //
    // The fix: capture the camera + old BBox, unlock, read the new BBox, and
    // linearly remap camera.x/y/ratio between the two BBox spaces so the
    // viewport stays identical.
    const preservedViewport = this.remapCameraAcrossBBoxUnlock()
    this.graphBoundsUnlockStartedAtMs = null
    this.graphBoundsUnlockDeferredCount = 0

    const syncedVisible =
      releaseSyncPubkeys.length > 0
        ? this.syncPhysicsPositionsToRenderForPubkeys(releaseSyncPubkeys)
        : false
    if (syncedVisible) {
      this.nodeHitTester?.markDirty()
    }
    const manualFixedLockCleared = this.clearManualDragFixedNode(
      draggedNodePubkey,
      keepReleasedNodeFixed,
    )
    if (manualFixedLockCleared) {
      if (typeof this.forceRuntime?.reheat === 'function') {
        this.forceRuntime.reheat()
      }
      this.ensurePhysicsPositionBridge()
    }

    this.traceRendererEvent('releaseDrag.unlockGraphBounds', {
      preservedViewport,
      syncedVisible,
      releaseSyncPubkeyCount: releaseSyncPubkeys.length,
      draggedNodePubkey,
      forcedWhilePhysicsRunning: physicsStillRunning,
      manualFixedLockCleared,
    })
    this.recordDragTimelineEvent('unlock-done', {
      pubkey: draggedNodePubkey,
      details: {
        preservedViewport,
        syncedVisible,
        releaseSyncPubkeyCount: releaseSyncPubkeys.length,
        forcedWhilePhysicsRunning: physicsStillRunning,
        manualFixedLockCleared,
      },
    })
    this.refreshAfterGraphBoundsUnlock()
  }

  private readonly startDrag = (
    pubkey: string,
    anchorOffset?: { dx: number; dy: number },
    anchorViewportOrigin?: { x: number; y: number },
    graphBoundsBBox?: SigmaGraphExtent | null,
  ) => {
    if (!this.renderStore || !this.physicsStore || !this.callbacks) {
      return
    }

    this.cancelPendingGraphBoundsUnlock()
    this.manualDragFixedNodes.delete(pubkey)
    this.lastScheduledGraphPosition = null
    this.resumePhysicsAfterDrag = !(this.forceRuntime?.isSuspended() ?? false)
    this.draggedNodeFocus = this.createFocusSnapshot(pubkey, {
      requireNode: true,
    })
    this.draggedNodePubkey = pubkey
    this.refreshDraggedNodeEdgeIds(pubkey)
    this.cancelHighlightTransition()
    this.setNodeDragEdgeRendering(true)
    this.lockGraphBoundsPreservingViewport(graphBoundsBBox)
    const currentNodePosition =
      this.renderStore.getNodePosition(pubkey) ??
      this.physicsStore.getNodePosition(pubkey)
    this.dragAnchorOffset = anchorOffset
      ? { dx: anchorOffset.dx, dy: anchorOffset.dy }
      : { dx: 0, dy: 0 }
    this.shouldPinDraggedNodeOnRelease = false
    this.markMotion()
    this.dragHopDistances = buildDragHopDistances(
      this.physicsStore.getGraph(),
      pubkey,
      DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
    )
    this.dragInfluenceState = createDragNeighborhoodInfluenceState(
      this.physicsStore,
      pubkey,
      this.dragHopDistances,
      this.dragInfluenceConfig,
    )
    this.lastDragGraphPosition =
      currentNodePosition
    this.lastDragFlushTimestamp = null
    this.cancelPendingDragFrame()
    this.physicsStore.setNodeFixed(pubkey, true)
    this.forceRuntime?.suspend()
    this.cancelPendingHoverFocus()
    this.applyHoverFocusSnapshot(pubkey, this.draggedNodeFocus)
    this.traceRendererEvent('startDrag', {
      pubkey,
      anchorOffset: this.dragAnchorOffset,
      anchorViewportOrigin,
      graphBoundsBBox,
      dragHopDistanceCount: this.dragHopDistances.size,
    })
    this.recordDragTimelineEvent('promote', {
      pubkey,
      pointerViewport: anchorViewportOrigin,
      details: {
        anchorOffset: this.dragAnchorOffset,
        currentNodePosition,
        dragHopDistanceCount: this.dragHopDistances.size,
      },
    })
    this.callbacks.onNodeDragStart(pubkey)
  }

  private readonly releaseDrag = (options?: { pinOnRelease?: boolean }) => {
    this.pendingDragGesture = null

    if (!this.draggedNodePubkey || !this.renderStore || !this.physicsStore || !this.callbacks) {
      this.setNodeDragEdgeRendering(false)
      this.setCameraLocked(false)
      this.setGraphBoundsLocked(false)
      this.cancelPendingGraphBoundsUnlock()
      this.cancelPendingDragFrame()
      this.dragHopDistances = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      this.lastScheduledGraphPosition = null
      this.dragAnchorOffset = { dx: 0, dy: 0 }
      this.draggedNodeFocus = this.createEmptyFocusSnapshot()
      this.draggedNodeEdgeIds = null
      this.shouldPinDraggedNodeOnRelease = false
      return
    }

    this.flushPendingDragFrame()

    const draggedNodePubkey = this.draggedNodePubkey
    const shouldPinOnRelease =
      options?.pinOnRelease ?? this.shouldPinDraggedNodeOnRelease
    const keepReleasedNodeFixed =
      shouldPinOnRelease ||
      (this.scene?.render.pins.pubkeys ?? []).includes(draggedNodePubkey)
    const releaseViewportPosition = this.getViewportPosition(draggedNodePubkey)
    const releaseSyncPubkeys =
      this.collectReleasePhysicsSyncPubkeys(draggedNodePubkey)

    // Drain residual spring velocities before resuming FA2 so small clusters
    // don't get kicked out by leftover momentum from the influence engine.
    if (this.dragInfluenceState) {
      dampInfluenceVelocities(this.dragInfluenceState, 0.2)
    }

    const releasePosition =
      this.renderStore.getNodePosition(draggedNodePubkey) ??
      this.physicsStore.getNodePosition(draggedNodePubkey)
    if (releasePosition) {
      this.rememberReleasedNodePosition(draggedNodePubkey, releasePosition)
    } else {
      releaseDraggedNode(
        this.physicsStore,
        draggedNodePubkey,
        shouldPinOnRelease
          ? [draggedNodePubkey]
          : (this.scene?.render.pins.pubkeys ?? []),
      )
    }
    const releaseSyncedVisible =
      releaseSyncPubkeys.length > 0
        ? this.syncPhysicsPositionsToRenderForPubkeys(releaseSyncPubkeys)
        : false
    if (releaseSyncedVisible) {
      this.nodeHitTester?.markDirty()
    }
    this.setCameraLocked(false)
    this.dragHopDistances = new Map()
    this.dragInfluenceState = null
    this.lastDragGraphPosition = null
    this.lastScheduledGraphPosition = null
    this.dragAnchorOffset = { dx: 0, dy: 0 }

    this.draggedNodePubkey = null
    this.draggedNodeFocus = this.createEmptyFocusSnapshot()
    this.draggedNodeEdgeIds = null
    this.setNodeDragEdgeRendering(false)
    this.shouldPinDraggedNodeOnRelease = false
    this.lastDragFlushTimestamp = null
    this.cancelPendingDragFrame()
    this.suppressedClick = createSuppressedNodeClick(draggedNodePubkey)
    this.suppressedStageClickUntil =
      Date.now() + STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS

    // Dragging edits graph coordinates while FA2 is suspended, so the last
    // convergence signal is no longer valid even if topology/settings stayed
    // the same. Resume from the current coordinates and let FA2 settle again.
    const shouldResumePhysicsAfterRelease = this.resumePhysicsAfterDrag
    if (shouldResumePhysicsAfterRelease) {
      this.forceRuntime?.resume({ invalidateConvergence: true })
      this.recordDragTimelineEvent('physics-resume', {
        pubkey: draggedNodePubkey,
        details: { invalidateConvergence: true },
      })
      this.ensurePhysicsPositionBridge()
    } else {
      this.cancelPhysicsPositionBridge()
    }
    this.resumePhysicsAfterDrag = true
    this.safeRender()
    if (this.isGraphBoundsLocked) {
      this.scheduleGraphBoundsUnlockAfterRelease(
        draggedNodePubkey,
        releaseSyncPubkeys,
        keepReleasedNodeFixed,
      )
    } else {
      const manualFixedLockCleared = this.clearManualDragFixedNode(
        draggedNodePubkey,
        keepReleasedNodeFixed,
      )
      if (
        manualFixedLockCleared &&
        shouldResumePhysicsAfterRelease &&
        typeof this.forceRuntime?.reheat === 'function'
      ) {
        this.forceRuntime.reheat()
      }
    }
    this.traceRendererEvent('releaseDrag', {
      draggedNodePubkey,
      shouldPinOnRelease,
      releaseSyncPubkeyCount: releaseSyncPubkeys.length,
      releaseSyncedVisible,
      releaseViewportPosition,
      releaseGraphPosition: releasePosition,
      manualDragFixedNodeCount: this.manualDragFixedNodes.size,
      graphBoundsUnlockScheduled: this.pendingGraphBoundsUnlockFrame !== null,
    })
    this.recordDragTimelineEvent('release', {
      pubkey: draggedNodePubkey,
      pointerViewport: releaseViewportPosition,
      details: {
        shouldPinOnRelease,
        releaseSyncPubkeyCount: releaseSyncPubkeys.length,
        releaseSyncedVisible,
        releaseGraphPosition: releasePosition,
        manualDragFixedNodeCount: this.manualDragFixedNodes.size,
        graphBoundsUnlockScheduled:
          this.pendingGraphBoundsUnlockFrame !== null,
      },
    })

    if (isMobileGraphInteractionMode()) {
      this.clearInteractiveRendererFocus({ notifySelection: true })
    } else {
      // Recalculate hover based on actual pointer position after release.
      this.recalculateHoverAfterDrag()
    }

    if (releasePosition) {
      this.callbacks.onNodeDragEnd(draggedNodePubkey, releasePosition, {
        pinNode: shouldPinOnRelease,
      })
    }
  }

  public setInitialCameraZoom(zoom: number) {
    this.initialCameraZoom = clampNumber(
      zoom,
      MIN_INITIAL_CAMERA_ZOOM,
      MAX_INITIAL_CAMERA_ZOOM,
    )
  }

  private applyDefaultCameraZoom() {
    const camera = this.sigma?.getCamera()
    if (!camera) {
      return
    }

    const state = camera.getState()
    camera.setState({
      ...state,
      ratio: camera.getBoundedRatio(1 / this.initialCameraZoom),
    })
  }

  private createSigmaSettings() {
    return {
      renderEdgeLabels: false,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      labelDensity: 0.18,
      labelRenderedSizeThreshold: 10,
      labelFont:
        "'Inter Tight', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
      labelSize: 12,
      labelWeight: '500',
      labelColor: { color: '#d8e3f0' },
      enableEdgeEvents: false,
      defaultEdgeColor: '#7a92bd',
      defaultNodeColor: '#7dd3a7',
      minCameraRatio: 0.05,
      maxCameraRatio: 6,
      enableCameraRotation: false,
      // Host + safeRefresh prevent intentional renders while collapsed.
      // This covers Sigma's own already-queued frames during transient layout.
      allowInvalidContainer: true,
      zoomingRatio: 1.45,
      zoomDuration: 180,
      inertiaDuration: 220,
      inertiaRatio: 2.6,
      autoCenter: false,
      autoRescale: false,
      defaultDrawNodeLabel: drawCachedDiscNodeLabel,
      defaultDrawNodeHover: () => {},
      nodeHoverProgramClasses: {
        circle: noopNodeHoverProgram,
      },
      nodeReducer: this.nodeReducer,
      edgeReducer: this.edgeReducer,
    }
  }

  private setNodeDragEdgeRendering(active: boolean) {
    const sigma = this.sigma
    const settings = sigma as
      | {
          getSetting?: (key: 'hideEdgesOnMove') => boolean
          setSetting?: (key: 'hideEdgesOnMove', value: boolean) => void
        }
      | null
    if (!settings?.getSetting || !settings.setSetting) {
      return
    }

    if (active) {
      if (this.hideEdgesOnMoveBeforeDrag === null) {
        this.hideEdgesOnMoveBeforeDrag = settings.getSetting('hideEdgesOnMove')
      }
      if (settings.getSetting('hideEdgesOnMove')) {
        settings.setSetting('hideEdgesOnMove', false)
      }
      return
    }

    const hideEdgesOnMove = this.hideEdgesOnMoveBeforeDrag ?? true
    this.hideEdgesOnMoveBeforeDrag = null
    if (settings.getSetting('hideEdgesOnMove') !== hideEdgesOnMove) {
      settings.setSetting('hideEdgesOnMove', hideEdgesOnMove)
    }
  }

  private configureTouchInteraction(
    sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>,
  ) {
    const touchCaptor = sigma.getTouchCaptor()
    touchCaptor.setSettings({
      dragTimeout: sigma.getSetting('dragTimeout'),
      inertiaDuration: 0,
      inertiaRatio: 0,
      doubleClickTimeout: sigma.getSetting('doubleClickTimeout'),
      doubleClickZoomingRatio: 1.7,
      doubleClickZoomingDuration: 180,
      tapMoveTolerance: Math.max(
        sigma.getSetting('tapMoveTolerance'),
        TOUCH_TAP_MOVE_TOLERANCE_PX,
      ),
    })
    touchCaptor.on('touchmove', this.handleTouchMove)
    touchCaptor.on('touchdown', this.handleTouchGestureStart)
    touchCaptor.on('touchup', this.handleTouchGestureEnd)
    this.installGestureStartCancellation()
  }

  /**
   * Cancel any in-flight camera animation when a new pan/pinch gesture starts.
   * Sigma camera animations keep calling `setState` every rAF tick from their
   * initialState + tween, so if the user starts another gesture while one is
   * still running, each animation tick can overwrite the position the new
   * touchmove just wrote. The result is a one-frame jump before the next
   * touchmove corrects it.
   *
   * Capture-phase listeners on the container fire before Sigma's TouchCaptor
   * runs `handleStart`, so we can null out `camera.nextFrame` *before*
   * `startCameraState` is captured from a still-animating position.
   */
  private installGestureStartCancellation() {
    this.gestureStartListenerCleanup?.()

    const container = this.container
    if (!container) {
      this.gestureStartListenerCleanup = null
      return
    }

    const cancel = () => {
      this.cancelCameraInertiaAnimation()
      this.suspendMouseCaptorForTouchGesture()
    }
    const cancelMouseAnimation = () => {
      this.cancelCameraInertiaAnimation()
    }

    const options: AddEventListenerOptions = { capture: true, passive: true }
    container.addEventListener('touchstart', cancel, options)
    container.addEventListener('mousedown', cancelMouseAnimation, options)

    this.gestureStartListenerCleanup = () => {
      container.removeEventListener('touchstart', cancel, options)
      container.removeEventListener('mousedown', cancelMouseAnimation, options)
    }
  }

  private cancelCameraInertiaAnimation() {
    const sigma = this.sigma
    if (!sigma) return
    const camera = sigma.getCamera() as unknown as {
      nextFrame?: number | null
      animationCallback?: (() => void) | undefined
    }
    if (camera.nextFrame == null) {
      return
    }
    cancelAnimationFrame(camera.nextFrame)
    camera.nextFrame = null
    if (typeof camera.animationCallback === 'function') {
      try {
        camera.animationCallback()
      } catch {
        // Swallow: animation callbacks are user-supplied (e.g. for tap-to-zoom)
        // and a throw here must not block the new gesture.
      }
      camera.animationCallback = undefined
    }
  }

  private readonly handleTouchGestureStart = () => {
    if (this.touchGestureActive) return
    this.touchGestureActive = true
    // Chrome (real touch devices and DevTools "mobile mode") fires both touch*
    // events and synthetic mouse* compatibility events for the same gesture.
    // Without this guard, Sigma's MouseCaptor would also process mousedown/
    // mousemove and write `camera.setState` from its own `lastMouseX/Y` math
    // while the TouchCaptor writes from `startTouchesPositions`. The two
    // captors fight each frame and the camera visibly jumps between their
    // computed positions.
    this.suspendMouseCaptorForTouchGesture()
    this.callbacks?.onCanvasGestureStart?.()
  }

  private readonly handleTouchGestureEnd = () => {
    if (!this.touchGestureActive) return
    this.touchGestureActive = false
    this.scheduleMouseCaptorResumeAfterTouchGesture()
    this.flushDeferredCameraInteractionRefreshes()
    this.callbacks?.onCanvasGestureEnd?.()
  }

  private suspendMouseCaptorForTouchGesture() {
    this.clearTouchMouseResumeTimer()
    const sigma = this.sigma
    if (!sigma) return
    const mouseCaptor = sigma.getMouseCaptor()
    mouseCaptor.enabled = false
    // A synthetic mousedown may have arrived before the touchdown; clear any
    // residual drag state so the captor doesn't resume a phantom pan when we
    // re-enable it.
    mouseCaptor.isMouseDown = false
    mouseCaptor.isMoving = false
    mouseCaptor.lastMouseX = null
    mouseCaptor.lastMouseY = null
    mouseCaptor.startCameraState = null
  }

  private scheduleMouseCaptorResumeAfterTouchGesture() {
    this.clearTouchMouseResumeTimer()
    this.touchMouseResumeTimer = setTimeout(
      this.resumeMouseCaptorAfterTouchGesture,
      TOUCH_MOUSE_COMPATIBILITY_SUPPRESSION_MS,
    )
  }

  private readonly resumeMouseCaptorAfterTouchGesture = () => {
    this.touchMouseResumeTimer = null
    const sigma = this.sigma
    if (!sigma) return
    const mouseCaptor = sigma.getMouseCaptor()
    mouseCaptor.isMouseDown = false
    mouseCaptor.isMoving = false
    mouseCaptor.lastMouseX = null
    mouseCaptor.lastMouseY = null
    mouseCaptor.startCameraState = null
    mouseCaptor.enabled = true
  }

  private clearTouchMouseResumeTimer() {
    if (this.touchMouseResumeTimer === null) return
    clearTimeout(this.touchMouseResumeTimer)
    this.touchMouseResumeTimer = null
  }

  private readonly handleTouchMove = (event: TouchCoords) => {
    this.markTouchCameraMovement()
    this.handleNaturalTouchZoom(event)
  }

  private readonly handleNaturalTouchZoom = (event: TouchCoords) => {
    const sigma = this.sigma
    if (
      !sigma ||
      event.touches.length !== 2 ||
      event.previousTouches.length !== 2
    ) {
      return
    }

    const previousDistance = getDistance(
      event.previousTouches[0],
      event.previousTouches[1],
    )
    const currentDistance = getDistance(event.touches[0], event.touches[1])
    if (previousDistance <= 0 || currentDistance <= 0) {
      return
    }

    event.preventSigmaDefault()

    const previousMidpoint = getMidpoint(
      event.previousTouches[0],
      event.previousTouches[1],
    )
    const currentMidpoint = getMidpoint(event.touches[0], event.touches[1])
    const camera = sigma.getCamera()
    const cameraState = camera.getState()
    const nextRatio = camera.getBoundedRatio(
      cameraState.ratio * (previousDistance / currentDistance),
    )
    const graphPointBeforeZoom = sigma.viewportToFramedGraph(
      previousMidpoint,
      {
        cameraState,
      },
    )
    const zoomedState = sigma.getViewportZoomedState(
      previousMidpoint,
      nextRatio,
    )
    const graphPointAtCurrentMidpoint = sigma.viewportToFramedGraph(
      currentMidpoint,
      {
        cameraState: zoomedState,
      },
    )

    camera.setState({
      ...zoomedState,
      x: zoomedState.x + graphPointBeforeZoom.x - graphPointAtCurrentMidpoint.x,
      y: zoomedState.y + graphPointBeforeZoom.y - graphPointAtCurrentMidpoint.y,
      angle: cameraState.angle,
    })
  }

  public mount(
    container: HTMLElement,
    initialScene: GraphSceneSnapshot,
    callbacks: GraphInteractionCallbacks,
  ) {
    this.callbacks = callbacks
    this.scene = initialScene
    this.container = container
    this.positionLedger = new NodePositionLedger()
    this.renderStore = new RenderGraphStore(this.positionLedger)
    this.physicsStore = new PhysicsGraphStore(this.positionLedger)
    this.renderStore.applyScene(this.buildRenderSnapshot(initialScene.render))
    this.syncSelectedSceneFocus()
    this.physicsStore.applyScene(initialScene.physics)
    this.forceRuntime = new ForceAtlasRuntime(this.physicsStore.getGraph())
    // Instalamos el cap de DPR ANTES de construir Sigma. Sigma lee
    // window.devicePixelRatio en el constructor y en cada resize() vía un
    // helper interno no expuesto, por lo que el override debe persistir
    // durante todo el ciclo de vida del adapter.
    this.pixelRatioCapDispose = installSigmaPixelRatioCap(container)
    this.sigma = new Sigma(
      this.renderStore.getGraph(),
      container,
      this.createSigmaSettings(),
    )
    this.applyDefaultCameraZoom()

    const sigma = this.sigma
    this.configureTouchInteraction(sigma)
    this.observeContainer(container)
    this.nodeHitTester = installStrictNodeHitTesting(
      sigma,
      this.renderStore.getGraph(),
    )
    this.initAvatarPipeline(sigma)
    this.bindEvents()
    // P4: keep viewport bbox in sync with camera so edge culling stays accurate
    sigma.getCamera().on('updated', this.updateViewportBBox)
    this.updateViewportBBox()
    this.forceRuntime.sync(initialScene.physics)
    this.ensurePhysicsPositionBridge()
  }

  public update(scene: GraphSceneSnapshot) {
    if (
      !this.sigma ||
      !this.renderStore ||
      !this.physicsStore ||
      !this.forceRuntime
    ) {
      return
    }
    const draggedNodePubkey = this.draggedNodePubkey
    const draggedNodePosition =
      draggedNodePubkey !== null ? this.resolveCurrentDragGraphPosition() : null
    this.scene = scene
    this.renderStore.applyScene(this.buildRenderSnapshot(scene.render))
    this.invalidateRendererFocusEdgeIds()
    this.syncSelectedSceneFocus()
    const physicsApplyResult = this.physicsStore.applyScene(scene.physics)
    this.nodeHitTester?.markDirty()

    if (draggedNodePubkey && draggedNodePosition) {
      this.renderStore.setNodePosition(
        draggedNodePubkey,
        draggedNodePosition.x,
        draggedNodePosition.y,
      )
      this.physicsStore.setNodePosition(
        draggedNodePubkey,
        draggedNodePosition.x,
        draggedNodePosition.y,
        true,
      )
      this.nodeHitTester?.markDirty()
    }

    this.applyManualDragFixedNodes()

    if (draggedNodePubkey) {
      this.dragHopDistances = buildDragHopDistances(
        this.physicsStore.getGraph(),
        draggedNodePubkey,
        DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
      )
      this.dragInfluenceState = createDragNeighborhoodInfluenceState(
        this.physicsStore,
        draggedNodePubkey,
        this.dragHopDistances,
        this.dragInfluenceConfig,
        this.dragInfluenceState,
      )
      // Keep drag focus in sync with the current render graph so that
      // neighbors match what selection would produce for the same node.
      this.draggedNodeFocus = this.createFocusSnapshot(draggedNodePubkey, {
        requireNode: true,
      })
      this.refreshDraggedNodeEdgeIds(draggedNodePubkey)
    } else {
      this.dragHopDistances = new Map()
      this.dragInfluenceState = null
      this.draggedNodeEdgeIds = null
    }

    this.forceRuntime.sync(this.createPhysicsSceneWithManualDragFixes(scene.physics), {
      topologyChanged: physicsApplyResult.topologyChanged,
    })
    this.ensurePhysicsPositionBridge()

    this.safeRefresh()
  }

  public dispose() {
    this.handleTouchGestureEnd()
    this.clearTouchMouseResumeTimer()
    this.releaseDrag()
    this.cancelPendingDragFrame()
    this.cancelPendingGraphBoundsUnlock()
    this.cancelPhysicsPositionBridge()
    if (this.pendingHighlightTransitionFrame !== null) {
      cancelAnimationFrame(this.pendingHighlightTransitionFrame)
      this.pendingHighlightTransitionFrame = null
    }
    this.cancelPendingFitCameraAfterPhysics()
    this.cancelPendingHoverFocus()
    this.clearTouchCameraMovement()
    if (this.pendingContainerRefreshFrame !== null) {
      cancelAnimationFrame(this.pendingContainerRefreshFrame)
      this.pendingContainerRefreshFrame = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.pendingContainerRefresh = false
    this.pendingAvatarSettledRefresh = false
    this.gestureStartListenerCleanup?.()
    this.gestureStartListenerCleanup = null
    window.removeEventListener('keydown', this.handleKeyDown)
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.sigma?.getCamera().off('updated', this.updateViewportBBox)
    this.cachedViewportBBox = null
    this.colorWithOpacityCache.clear()
    this.forceRuntime?.dispose()
    this.forceRuntime = null
    this.nodeHitTester?.dispose()
    this.nodeHitTester = null
    this.disposeAvatarPipeline()
    this.sigma?.kill()
    this.sigma = null
    this.pixelRatioCapDispose?.()
    this.pixelRatioCapDispose = null
    this.positionLedger = null
    this.renderStore = null
    this.physicsStore = null
    this.callbacks = null
    this.scene = null
    this.container = null
    this.resetRendererFocusState()
  }

  private initAvatarPipeline(
    sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>,
  ) {
    if (typeof window === 'undefined') {
      return
    }
    if (typeof document === 'undefined') {
      return
    }
    const tier = detectDeviceTier()
    const baseBudget = DEFAULT_BUDGETS[tier]
    if (!baseBudget.drawAvatars) {
      return
    }
    try {
      this.avatarCache = new AvatarBitmapCache(baseBudget.lruCap)
      this.avatarLoader = new AvatarLoader()
      this.avatarScheduler = new AvatarScheduler({
        cache: this.avatarCache,
        loader: this.avatarLoader,
        onSettled: () => {
          this.scheduleAvatarSettledRefresh()
        },
      })
      this.avatarBudget = new PerfBudget(tier)
      if (!this.avatarImagesEnabled) {
        this.avatarBudget.disable()
      }
      this.avatarOverlay = new AvatarOverlayRenderer({
        sigma,
        cache: this.avatarCache,
        scheduler: this.avatarScheduler,
        budget: this.avatarBudget,
        isMoving: () => this.hideAvatarsOnMove && this.cameraMotionActive,
        isCameraMoving: () => this.cameraMotionActive || this.touchGestureActive,
        getBlockedAvatar: (urlKey) => this.avatarLoader?.getBlockedEntry(urlKey) ?? null,
        getHoveredNodePubkey: () => this.resolveRendererFocus().pubkey,
        getForcedAvatarPubkey: () =>
          this.draggedNodePubkey ?? this.resolveRendererFocus().pubkey,
        getHoveredNeighborPubkeys: () => this.resolveRendererFocus().neighbors,
        getRuntimeOptions: () => this.avatarRuntimeOptions,
      })
      this.avatarOverlay.setDebugDetailsEnabled(this.avatarDebugDetailsEnabled)

      sigma.getCamera().on('updated', () => {
        this.markMotion()
        this.markCameraMotion()
      })
    } catch (err) {
      console.warn('[graph-v2] avatar pipeline init failed', err)
      this.disposeAvatarPipeline()
    }
  }

  private disposeAvatarPipeline() {
    if (this.motionClearTimer !== null) {
      clearTimeout(this.motionClearTimer)
      this.motionClearTimer = null
    }
    this.motionClearDeadlineMs = 0
    if (this.cameraMotionClearTimer !== null) {
      clearTimeout(this.cameraMotionClearTimer)
      this.cameraMotionClearTimer = null
    }
    this.cameraMotionClearDeadlineMs = 0
    this.motionActive = false
    this.cameraMotionActive = false
    this.avatarOverlay?.dispose()
    this.avatarOverlay = null
    this.avatarScheduler?.dispose()
    this.avatarScheduler = null
    this.avatarCache?.clear()
    this.avatarCache = null
    this.avatarLoader = null
    this.avatarBudget = null
  }

  private markMotion() {
    if (!this.avatarOverlay) {
      return
    }
    this.motionClearDeadlineMs = performance.now() + this.MOTION_RESUME_MS
    if (this.motionClearTimer !== null) {
      return
    }
    this.motionActive = true
    this.motionClearTimer = setTimeout(
      this.flushMotionClear,
      this.MOTION_RESUME_MS,
    )
  }

  private markCameraMotion() {
    if (!this.avatarOverlay) {
      return
    }
    this.cameraMotionClearDeadlineMs =
      performance.now() + this.MOTION_RESUME_MS
    if (this.cameraMotionClearTimer !== null) {
      return
    }
    this.cameraMotionActive = true
    this.cameraMotionClearTimer = setTimeout(
      this.flushCameraMotionClear,
      this.MOTION_RESUME_MS,
    )
  }

  private markTouchCameraMovement() {
    const sigma = this.sigma
    if (!sigma) {
      return
    }

    this.touchCameraMotionClearDeadlineMs =
      performance.now() + this.MOTION_RESUME_MS
    if (this.touchCameraMotionClearTimer !== null) {
      // Gesture already in flight; extending the deadline is enough — skip
      // the captor lookup/assignment that ran on every touchmove before.
      return
    }

    // Sigma 3's render-time `hideEdgesOnMove` check only reads the mouse
    // captor, even for touch gestures. Bridge touch motion into that signal
    // so mobile pan/pinch gets the same edge-hiding path as desktop.
    const mouseCaptor =
      sigma.getMouseCaptor() as unknown as SigmaMovementCaptorShim
    mouseCaptor.isMoving = true

    this.touchCameraMotionClearTimer = setTimeout(
      this.flushTouchCameraMovementClear,
      this.MOTION_RESUME_MS,
    )
  }

  private clearTouchCameraMovement() {
    if (this.touchCameraMotionClearTimer !== null) {
      clearTimeout(this.touchCameraMotionClearTimer)
      this.touchCameraMotionClearTimer = null
    }
    this.touchCameraMotionClearDeadlineMs = 0

    const sigma = this.sigma
    if (!sigma) {
      return
    }

    const mouseCaptor =
      sigma.getMouseCaptor() as unknown as SigmaMovementCaptorShim
    mouseCaptor.isMoving = false
  }

  private readonly flushMotionClear = () => {
    const remainingMs = this.motionClearDeadlineMs - performance.now()
    if (remainingMs > 0) {
      this.motionClearTimer = setTimeout(this.flushMotionClear, remainingMs)
      return
    }

    this.motionClearTimer = null
    this.motionClearDeadlineMs = 0
    if (!this.motionActive) {
      return
    }
    this.motionActive = false
    this.safeRender()
  }

  private readonly flushCameraMotionClear = () => {
    const remainingMs = this.cameraMotionClearDeadlineMs - performance.now()
    if (remainingMs > 0) {
      this.cameraMotionClearTimer = setTimeout(
        this.flushCameraMotionClear,
        remainingMs,
      )
      return
    }

    this.cameraMotionClearTimer = null
    this.cameraMotionClearDeadlineMs = 0
    if (!this.cameraMotionActive) {
      return
    }
    this.cameraMotionActive = false
    this.safeRender()
    this.flushDeferredCameraInteractionRefreshes()
  }

  private readonly flushTouchCameraMovementClear = () => {
    const remainingMs =
      this.touchCameraMotionClearDeadlineMs - performance.now()
    if (remainingMs > 0) {
      this.touchCameraMotionClearTimer = setTimeout(
        this.flushTouchCameraMovementClear,
        remainingMs,
      )
      return
    }

    this.touchCameraMotionClearTimer = null
    this.touchCameraMotionClearDeadlineMs = 0

    const sigma = this.sigma
    if (!sigma) {
      return
    }

    const mouseCaptor =
      sigma.getMouseCaptor() as unknown as SigmaMovementCaptorShim
    mouseCaptor.isMoving = false
    this.safeRender()
    this.flushDeferredCameraInteractionRefreshes()
  }

  private scheduleAvatarSettledRefresh() {
    if (!this.sigma) {
      return
    }
    if (!hasRenderableSigmaContainer(this.container)) {
      this.pendingAvatarSettledRefresh = true
      return
    }
    if (this.isCameraInteractionActive()) {
      this.pendingAvatarSettledRefresh = true
      return
    }

    this.pendingAvatarSettledRefresh = false
    this.sigma.scheduleRefresh()
  }

  private createEmptyFocusSnapshot(): HoverFocusSnapshot {
    return {
      pubkey: null,
      neighbors: EMPTY_HOVER_NEIGHBORS,
    }
  }

  private applyHoverFocusSnapshot(
    pubkey: string | null,
    focus: HoverFocusSnapshot,
  ) {
    this.hoveredNodePubkey = pubkey
    this.hoveredNeighbors = focus.neighbors
    this.currentHoverFocus = focus
  }

  private clearSelectedRendererFocus() {
    this.selectedSceneFocus = this.createEmptyFocusSnapshot()
  }

  private setSelectedRendererFocus(pubkey: string | null) {
    this.selectedSceneFocus = this.createFocusSnapshot(pubkey, {
      requireNode: true,
    })
  }

  private clearInteractiveRendererFocus(options?: {
    notifySelection?: boolean
  }) {
    this.clearHoveredNodeFocus()
    this.clearSelectedRendererFocus()
    if (options?.notifySelection) {
      this.callbacks?.onClearSelection()
    }
  }

  private resetRendererFocusState() {
    this.cancelPendingHoverFocus()
    this.cancelHighlightTransition()
    this.hoveredNodePubkey = null
    this.hoveredNeighbors = new Set()
    this.currentHoverFocus = {
      pubkey: null,
      neighbors: this.hoveredNeighbors,
    }
    this.clearSelectedRendererFocus()
    this.draggedNodeFocus = this.createEmptyFocusSnapshot()
    this.draggedNodeEdgeIds = null
    this.invalidateRendererFocusEdgeIds()
  }

  private syncSelectedSceneFocus() {
    const selectedPubkey = this.scene?.render.selection.selectedNodePubkey ?? null
    this.setSelectedRendererFocus(selectedPubkey)
  }

  private createFocusSnapshot(
    pubkey: string | null,
    options: { requireNode?: boolean } = {},
  ): HoverFocusSnapshot {
    if (!pubkey) {
      return this.createEmptyFocusSnapshot()
    }

    const graph = this.renderStore?.getGraph()
    if (!graph || !graph.hasNode(pubkey)) {
      return options.requireNode
        ? this.createEmptyFocusSnapshot()
        : {
            pubkey,
            neighbors: EMPTY_HOVER_NEIGHBORS,
          }
    }

    const neighbors = new Set<string>()
    graph.forEachNeighbor(pubkey, (neighborPubkey) => {
      neighbors.add(neighborPubkey)
    })

    return {
      pubkey,
      neighbors,
    }
  }

  private refreshDraggedNodeEdgeIds(pubkey: string) {
    const graph = this.renderStore?.getGraph()
    if (!graph || !graph.hasNode(pubkey)) {
      this.draggedNodeEdgeIds = null
      return
    }

    this.draggedNodeEdgeIds = new Set(graph.edges(pubkey))
  }

  private invalidateRendererFocusEdgeIds() {
    this.rendererFocusEdgeIdsByPubkey.clear()
  }

  private retainRendererFocusEdgeIds(pubkeys: Array<string | null>) {
    const retained = new Set(
      pubkeys.filter((pubkey): pubkey is string => Boolean(pubkey)),
    )
    for (const pubkey of this.rendererFocusEdgeIdsByPubkey.keys()) {
      if (!retained.has(pubkey)) {
        this.rendererFocusEdgeIdsByPubkey.delete(pubkey)
      }
    }
  }

  private getRendererFocusEdgeIds(focus: HoverFocusSnapshot): Set<string> | null {
    const pubkey = focus.pubkey
    if (!pubkey) {
      return null
    }

    const cached = this.rendererFocusEdgeIdsByPubkey.get(pubkey)
    if (cached) {
      return cached
    }

    const graph = this.renderStore?.getGraph()
    if (!graph || !graph.hasNode(pubkey)) {
      return null
    }

    const edgeIds = new Set(graph.edges(pubkey))
    this.rendererFocusEdgeIdsByPubkey.set(pubkey, edgeIds)
    return edgeIds
  }

  private resolveDragFocus(): HoverFocusSnapshot | null {
    if (!this.draggedNodePubkey) {
      return null
    }

    if (this.draggedNodeFocus.pubkey === this.draggedNodePubkey) {
      return this.draggedNodeFocus
    }

    return this.createFocusSnapshot(this.draggedNodePubkey, {
      requireNode: true,
    })
  }

  private resolveRendererFocus(): HoverFocusSnapshot {
    return (
      this.resolveDragFocus() ??
      (this.currentHoverFocus.pubkey
        ? this.currentHoverFocus
        : this.selectedSceneFocus)
    )
  }

  private getTransitionAmount(
    transition: { startedAt: number; durationMs: number },
    now = performance.now(),
  ) {
    return easeInOut((now - transition.startedAt) / transition.durationMs)
  }

  private shouldSkipRendererFocusTransition() {
    const graph = this.renderStore?.getGraph()
    if (!graph) {
      return false
    }

    return graph.order + graph.size >= FOCUS_TRANSITION_RENDER_ITEM_LIMIT
  }

  private scheduleHighlightTransitionFrame() {
    if (this.pendingHighlightTransitionFrame !== null) {
      return
    }

    this.pendingHighlightTransitionFrame = requestAnimationFrame(
      this.flushHighlightTransitionFrame,
    )
  }

  private cancelHighlightTransition() {
    this.highlightTransition = null
    if (this.pendingHighlightTransitionFrame !== null) {
      cancelAnimationFrame(this.pendingHighlightTransitionFrame)
      this.pendingHighlightTransitionFrame = null
    }
  }

  private readonly flushHighlightTransitionFrame = () => {
    this.pendingHighlightTransitionFrame = null

    if (this.draggedNodePubkey) {
      this.highlightTransition = null
      return
    }

    const now = performance.now()
    if (
      this.highlightTransition &&
      now - this.highlightTransition.startedAt >=
        this.highlightTransition.durationMs
    ) {
      this.highlightTransition = null
    }

    this.safeRender()

    if (this.highlightTransition) {
      this.scheduleHighlightTransitionFrame()
    } else {
      this.retainRendererFocusEdgeIds([this.resolveRendererFocus().pubkey])
    }
  }

  private startHighlightTransition(
    from: HoverFocusSnapshot,
    to: HoverFocusSnapshot,
  ) {
    if (this.draggedNodePubkey) {
      this.cancelHighlightTransition()
      return
    }

    this.highlightTransition = {
      from,
      to,
      startedAt: performance.now(),
      durationMs: HIGHLIGHT_TRANSITION_MS,
    }
    this.scheduleHighlightTransitionFrame()
  }

  private startRendererFocusTransition(
    from: HoverFocusSnapshot,
    to: HoverFocusSnapshot,
  ) {
    if (from.pubkey === to.pubkey && from.neighbors.size === to.neighbors.size) {
      let equalNeighbors = true
      for (const neighbor of from.neighbors) {
        if (!to.neighbors.has(neighbor)) {
          equalNeighbors = false
          break
        }
      }
      if (equalNeighbors) {
        this.cancelHighlightTransition()
        return
      }
    }

    this.retainRendererFocusEdgeIds([from.pubkey, to.pubkey])
    if (this.shouldSkipRendererFocusTransition()) {
      this.cancelHighlightTransition()
      return
    }

    this.startHighlightTransition(from, to)
  }

  private bindEvents() {
    if (!this.sigma || !this.renderStore || !this.physicsStore || !this.callbacks) {
      return
    }

    const sigma = this.sigma
    const callbacks = this.callbacks
    const shouldIgnoreNodeInteraction = (node: string) => {
      if (shouldSuppressNodeClick(this.suppressedClick, node)) {
        this.suppressedClick = null
        return true
      }

      if (this.suppressedClick && Date.now() > this.suppressedClick.expiresAt) {
        this.suppressedClick = null
      }

      return false
    }

    sigma.on('clickNode', ({ node }) => {
      if (shouldIgnoreNodeInteraction(node)) {
        return
      }

      callbacks.onNodeClick(node)
    })

    sigma.on('doubleClickNode', (event) => {
      if (shouldIgnoreNodeInteraction(event.node)) {
        return
      }

      event.preventSigmaDefault?.()
      callbacks.onNodeDoubleClick(event.node)
    })

    sigma.on('clickStage', () => {
      if (Date.now() < this.suppressedStageClickUntil) {
        return
      }

      this.clearOutsideNodeFocus('click')
    })

    sigma.on('downStage', () => {
      this.clearOutsideNodeFocus('pointer-down')
    })

    sigma.on('clickEdge', () => {
      this.clearOutsideNodeFocus('click')
    })

    sigma.on('downEdge', () => {
      this.clearOutsideNodeFocus('pointer-down')
    })

    sigma.on('enterNode', ({ node }) => {
      this.scheduleHoveredNodeFocus(node)
    })

    sigma.on('leaveNode', () => {
      this.clearHoveredNodeFocus()
    })

    sigma.on('leaveStage', () => {
      this.clearHoveredNodeFocus()
    })

    sigma.on('downNode', ({ node, event }) => {
      const graphBoundsBBox = cloneSigmaGraphExtent(sigma.getBBox())
      this.setCameraLocked(true)
      const nodePosition =
        this.renderStore?.getNodePosition(node) ??
        this.physicsStore?.getNodePosition(node) ??
        null
      const originGraph = sigma.viewportToGraph({
        x: event.x,
        y: event.y,
      })
      const anchorOffset = nodePosition
        ? {
            dx: nodePosition.x - originGraph.x,
            dy: nodePosition.y - originGraph.y,
          }
        : { dx: 0, dy: 0 }
      this.pendingDragGesture = createPendingNodeDragGesture(
        node,
        {
          x: event.x,
          y: event.y,
        },
        anchorOffset,
        graphBoundsBBox,
      )
      this.recordDragTimelineEvent('down', {
        pubkey: node,
        pointerViewport: { x: event.x, y: event.y },
        pointerGraph: originGraph,
        details: { anchorOffset, graphBoundsBBox },
      })
    })

    sigma.on('moveBody', ({ event, preventSigmaDefault }) => {
      this.moveBodyCount += 1
      this.lastMoveBodyPointer = {
        x: event.x,
        y: event.y,
      }
      this.shouldPinDraggedNodeOnRelease = isControlModifierPressed(event)
      const pendingDragGesture = this.pendingDragGesture

      if (!this.draggedNodePubkey && !pendingDragGesture) {
        return
      }

      if (!this.draggedNodePubkey) {
        if (
          !pendingDragGesture ||
          !shouldStartNodeDrag(pendingDragGesture, {
            x: event.x,
            y: event.y,
          })
        ) {
          return
        }

        preventSigmaDefault()
        const promotedGraphPosition = sigma.viewportToGraph({
          x: event.x,
          y: event.y,
        })
        this.startDrag(
          pendingDragGesture.pubkey,
          pendingDragGesture.anchorOffset,
          pendingDragGesture.origin,
          pendingDragGesture.graphBoundsBBox,
        )
        this.pendingDragGesture = null
        this.scheduleDragFrame(promotedGraphPosition)
        return
      } else {
        preventSigmaDefault()
      }

      const draggedNodePubkey = this.draggedNodePubkey

      if (!draggedNodePubkey) {
        return
      }
      this.scheduleDragFrame(
        sigma.viewportToGraph({
          x: event.x,
          y: event.y,
        }),
      )
    })

    sigma.on('upNode', ({ event }) => {
      this.releaseDrag({ pinOnRelease: isControlModifierPressed(event) })
    })

    sigma.on('upStage', ({ event }) => {
      this.releaseDrag({ pinOnRelease: isControlModifierPressed(event) })
    })

    sigma.getCamera().on('updated', (viewport) => {
      callbacks.onViewportChange(viewport)
    })

    window.addEventListener('keydown', this.handleKeyDown)
  }

  private resolveNodeHoverAttributes(
    node: string,
    data: RenderNodeAttributes,
    focus: HoverFocusSnapshot,
  ): RenderNodeAttributes {
    const cameraRatio = this.sigma?.getCamera().ratio ?? 1
    const zoomScaledSize = data.size * resolveZoomOutNodeScale(cameraRatio)
    const shouldKeepLabel = data.forceLabel === true

    if (!focus.pubkey) {
      // Hot path during pan/zoom with no hover: merge size + label visibility
      // in a single spread instead of double-allocating via the helper.
      const sizeChanged = zoomScaledSize !== data.size
      if (shouldKeepLabel) {
        if (!sizeChanged && data.forceLabel) return data
        return { ...data, size: zoomScaledSize, forceLabel: true }
      }
      if (!sizeChanged && data.label === '' && !data.forceLabel) return data
      return { ...data, size: zoomScaledSize, label: '', forceLabel: false }
    }

    if (node === focus.pubkey) {
      return {
        ...data,
        size: zoomScaledSize,
        color: HOVER_SELECTED_NODE_COLOR,
        forceLabel: true,
        highlighted: true,
        zIndex: Math.max(data.zIndex, 10),
      }
    }

    // Single spread (vs. helper) avoids per-node-per-frame double allocation.
    if (focus.neighbors.has(node)) {
      return shouldKeepLabel
        ? {
            ...data,
            size: zoomScaledSize,
            highlighted: true,
            zIndex: Math.max(data.zIndex, 8),
            forceLabel: true,
          }
        : {
            ...data,
            size: zoomScaledSize,
            highlighted: true,
            zIndex: Math.max(data.zIndex, 8),
            label: '',
            forceLabel: false,
          }
    }

    return shouldKeepLabel
      ? {
          ...data,
          size: zoomScaledSize,
          color: HOVER_DIM_NODE_COLOR,
          highlighted: false,
          zIndex: Math.min(data.zIndex, -3),
          forceLabel: true,
        }
      : {
          ...data,
          size: zoomScaledSize,
          color: HOVER_DIM_NODE_COLOR,
          highlighted: false,
          zIndex: Math.min(data.zIndex, -3),
          label: '',
          forceLabel: false,
        }
  }

  private resolveEdgeHoverAttributes(
    edge: string,
    data: RenderEdgeAttributes,
    focus: HoverFocusSnapshot,
  ): RenderEdgeAttributes {
    const baseData = this.resolveBaseEdgeAttributes(data)
    if (!focus.pubkey) {
      return baseData
    }

    const touchesFocus = this.edgeTouchesFocus(edge, focus)
    if (touchesFocus === null) {
      return baseData
    }

    const focusPreset =
      EDGE_FOCUS_VISUAL_PRESETS[this.connectionVisualConfig.focusStyle]

    if (!touchesFocus) {
      return {
        ...baseData,
        color: focusPreset.dimColor,
        size: focusPreset.dimSize,
        zIndex: Math.min(baseData.zIndex, -3),
      }
    }

    return {
      ...baseData,
      color: focusPreset.brightColor,
      hidden: false,
      size: Math.max(
        baseData.size + focusPreset.focusSizeBonus,
        focusPreset.focusMinSize,
      ),
      zIndex: Math.max(baseData.zIndex, 9),
    }
  }

  private resolveBaseEdgeAttributes(
    data: RenderEdgeAttributes,
  ): RenderEdgeAttributes {
    return {
      ...data,
      color: resolveConnectionBaseColor(data.color, this.connectionVisualConfig),
      size: resolveConnectionBaseSize(data.size, this.connectionVisualConfig),
    }
  }

  private getEdgeEndpoints(edge: string): { source: string; target: string } | null {
    if (!this.sigma) {
      return null
    }

    const graph = this.sigma.getGraph()
    if (!graph.hasEdge(edge)) {
      return null
    }

    return {
      source: graph.source(edge),
      target: graph.target(edge),
    }
  }

  private edgeEndpointsTouchFocus(
    endpoints: { source: string; target: string },
    focus: HoverFocusSnapshot,
  ) {
    return (
      Boolean(focus.pubkey) &&
      (endpoints.source === focus.pubkey || endpoints.target === focus.pubkey)
    )
  }

  private edgeTouchesFocus(
    edge: string,
    focus: HoverFocusSnapshot,
  ): boolean | null {
    if (!focus.pubkey) {
      return false
    }

    const edgeIds = this.getRendererFocusEdgeIds(focus)
    if (edgeIds) {
      return edgeIds.has(edge)
    }

    const endpoints = this.getEdgeEndpoints(edge)
    if (!endpoints) {
      return null
    }

    return this.edgeEndpointsTouchFocus(endpoints, focus)
  }

  private resolveEdgeLodAttributes(
    edge: string,
    data: RenderEdgeAttributes,
    focus: HoverFocusSnapshot,
  ): RenderEdgeAttributes {
    if (!this.sigma) {
      return data
    }

    if (focus.pubkey) {
      const touchesFocus = this.edgeTouchesFocus(edge, focus)
      if (touchesFocus === null) {
        return data
      }
      if (touchesFocus) {
        return this.resolveEdgeHoverAttributes(edge, data, focus)
      }
    }

    if (data.hidden) {
      return data
    }

    return { ...data, hidden: true }
  }

  private resolveDragEdgeAttributes(
    edge: string,
    data: RenderEdgeAttributes,
  ): RenderEdgeAttributes {
    const draggedNodePubkey = this.draggedNodePubkey
    if (!draggedNodePubkey) {
      return data
    }

    if (this.draggedNodeEdgeIds !== null) {
      if (this.draggedNodeEdgeIds.has(edge) || data.hidden) {
        return data
      }
      return { ...data, hidden: true }
    }

    const endpoints = this.getEdgeEndpoints(edge)
    if (!endpoints) {
      return data
    }

    if (
      endpoints.source !== draggedNodePubkey &&
      endpoints.target !== draggedNodePubkey
    ) {
      return data.hidden ? data : { ...data, hidden: true }
    }

    return data
  }

  private readonly nodeReducer = (
    node: string,
    data: RenderNodeAttributes,
  ) => {
    if (this.draggedNodePubkey) {
      // Drag owns the frame while it is active. Keep hover/focus styling out
      // of this reducer so node movement and focus transitions cannot mix.
      return this.resolveNodeHoverAttributes(node, data, EMPTY_RENDERER_FOCUS)
    }

    const focus = this.resolveRendererFocus()
    if (this.highlightTransition) {
      const amount = this.getTransitionAmount(this.highlightTransition)
      const from = this.resolveNodeHoverAttributes(
        node,
        data,
        this.highlightTransition.from,
      )
      const to = this.resolveNodeHoverAttributes(
        node,
        data,
        this.highlightTransition.to,
      )

      return mixNodeVisualAttributes(from, to, amount)
    }

    const target = this.resolveNodeHoverAttributes(
      node,
      data,
      focus,
    )
    return target
  }

  private readonly edgeReducer = (
    edge: string,
    data: RenderEdgeAttributes,
  ) => {
    if (this.draggedNodePubkey) {
      return this.resolveDragEdgeAttributes(edge, data)
    }

    const focus = this.resolveRendererFocus()
    if (this.hideConnectionsForLowPerformance) {
      return this.resolveEdgeLodAttributes(edge, data, focus)
    }

    // P2: Zoom-based LOD — hide low-weight edges when camera is zoomed far out.
    if (
      this.edgeZoomLodEnabled &&
      !data.hidden &&
      !focus.pubkey &&
      data.weight < EDGE_ZOOM_LOD_MIN_WEIGHT
    ) {
      const ratio = this.sigma?.getCamera().getState().ratio ?? 1
      if (ratio > EDGE_ZOOM_LOD_CAMERA_RATIO_THRESHOLD) {
        return { ...data, hidden: true }
      }
    }

    // P4: Viewport culling — skip edges whose both endpoints are off-screen.
    if (
      this.edgeViewportCullingEnabled &&
      !data.hidden &&
      !focus.pubkey &&
      this.cachedViewportBBox
    ) {
      const graph = this.sigma?.getGraph()
      if (graph) {
        const src = graph.source(edge)
        const tgt = graph.target(edge)
        if (graph.hasNode(src) && graph.hasNode(tgt)) {
          const sa = graph.getNodeAttributes(src)
          const ta = graph.getNodeAttributes(tgt)
          const bbox = this.cachedViewportBBox
          const bothLeft = sa.x < bbox.minX && ta.x < bbox.minX
          const bothRight = sa.x > bbox.maxX && ta.x > bbox.maxX
          const bothTop = sa.y < bbox.minY && ta.y < bbox.minY
          const bothBottom = sa.y > bbox.maxY && ta.y > bbox.maxY
          if (bothLeft || bothRight || bothTop || bothBottom) {
            return { ...data, hidden: true }
          }
        }
      }
    }

    if (this.highlightTransition) {
      const amount = this.getTransitionAmount(this.highlightTransition)
      const from = this.resolveEdgeHoverAttributes(
        edge,
        data,
        this.highlightTransition.from,
      )
      const to = this.resolveEdgeHoverAttributes(
        edge,
        data,
        this.highlightTransition.to,
      )

      return mixEdgeVisualAttributes(from, to, amount)
    }

    const target = this.resolveEdgeHoverAttributes(edge, data, focus)
    if (focus.pubkey) {
      return target
    }

    if (target.hidden) {
      return target
    }

    // P1: Use cached rgba conversion to avoid hex-parse on every edge every frame.
    return {
      ...target,
      color: this.resolveColorWithOpacity(target.color, target.opacityScale),
    }
  }

  private readonly setHoveredNode = (
    pubkey: string | null,
    force = false,
  ) => {
    if (force || pubkey === null) {
      this.cancelPendingHoverFocus()
    }

    // While dragging, external enterNode/leaveNode events must not change
    // the highlight — the dragged node stays highlighted until release.
    if (!force && this.draggedNodePubkey) {
      return
    }

    if (!force && this.hoveredNodePubkey === pubkey) {
      return
    }

    const previousFocus = this.resolveRendererFocus()
    const nextFocus = this.createFocusSnapshot(pubkey)
    this.applyHoverFocusSnapshot(pubkey, nextFocus)
    const nextRendererFocus = this.resolveRendererFocus()
    this.startRendererFocusTransition(previousFocus, nextRendererFocus)
    this.safeRender()
  }

  private cancelPendingHoverFocus() {
    if (this.hoverFocusDwellTimer !== null) {
      clearTimeout(this.hoverFocusDwellTimer)
      this.hoverFocusDwellTimer = null
    }
    this.pendingHoverFocusPubkey = null
  }

  private readonly scheduleHoveredNodeFocus = (pubkey: string) => {
    if (this.draggedNodePubkey || this.hoveredNodePubkey === pubkey) {
      return
    }

    if (this.pendingHoverFocusPubkey === pubkey) {
      return
    }

    this.cancelPendingHoverFocus()
    this.pendingHoverFocusPubkey = pubkey
    this.hoverFocusDwellTimer = setTimeout(() => {
      const nextPubkey = this.pendingHoverFocusPubkey
      this.pendingHoverFocusPubkey = null
      this.hoverFocusDwellTimer = null
      if (nextPubkey === null || this.draggedNodePubkey) {
        return
      }

      const previousPubkey = this.hoveredNodePubkey
      this.setHoveredNode(nextPubkey)
      if (previousPubkey !== nextPubkey && this.hoveredNodePubkey === nextPubkey) {
        this.callbacks?.onNodeHover(nextPubkey)
      }
    }, HOVER_FOCUS_DWELL_MS)
  }

  private readonly clearHoveredNodeFocus = () => {
    this.cancelPendingHoverFocus()
    const previousPubkey = this.hoveredNodePubkey
    this.setHoveredNode(null)
    if (previousPubkey !== null && this.hoveredNodePubkey === null) {
      this.callbacks?.onNodeHover(null)
    }
  }

  private readonly clearOutsideNodeFocus = (
    source: 'pointer-down' | 'click' = 'click',
  ) => {
    const now = Date.now()
    if (
      source === 'click' &&
      now - this.lastOutsideNodeFocusClearAt < OUTSIDE_NODE_CLICK_DEDUP_MS
    ) {
      return
    }

    this.lastOutsideNodeFocusClearAt = now
    this.clearInteractiveRendererFocus({ notifySelection: true })
  }

  // After releasing a drag, check what node (if any) sits under the last
  // known pointer and restore the hover highlight accordingly.
  private readonly recalculateHoverAfterDrag = () => {
    if (!this.sigma || !this.lastMoveBodyPointer) {
      this.setHoveredNode(null, true)
      return
    }

    // getNodeAtPosition is marked private in Sigma's types but is a stable
    // public method at runtime used by Sigma's own event handlers.
    const nodeUnderPointer = (
      this.sigma as unknown as {
        getNodeAtPosition(pos: { x: number; y: number }): string | null
      }
    ).getNodeAtPosition(this.lastMoveBodyPointer)
    this.setHoveredNode(nodeUnderPointer ?? null, true)
  }

  private readonly setCameraLocked = (locked: boolean) => {
    if (!this.sigma || this.isCameraLocked === locked) {
      return
    }

    if (locked) {
      this.sigma.getCamera().disable()
      this.isCameraLocked = true
      return
    }

    this.sigma.getCamera().enable()
    this.isCameraLocked = false
  }

  private captureRenderGraphBBox(): SigmaGraphExtent | null {
    const graph = this.renderStore?.getGraph()
    if (!graph || graph.order === 0) {
      return null
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    graph.forEachNode((_pubkey, attributes) => {
      if (!Number.isFinite(attributes.x) || !Number.isFinite(attributes.y)) {
        return
      }

      minX = Math.min(minX, attributes.x)
      minY = Math.min(minY, attributes.y)
      maxX = Math.max(maxX, attributes.x)
      maxY = Math.max(maxY, attributes.y)
    })

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      return null
    }

    if (minX === maxX) {
      minX -= 0.5
      maxX += 0.5
    }
    if (minY === maxY) {
      minY -= 0.5
      maxY += 0.5
    }

    return {
      x: [minX, maxX],
      y: [minY, maxY],
    }
  }

  private readonly setGraphBoundsLocked = (
    locked: boolean,
    graphBoundsBBox?: SigmaGraphExtent | null,
  ) => {
    if (!this.sigma || this.isGraphBoundsLocked === locked) {
      return
    }

    if (locked) {
      const explicitBBox = isUsableSigmaGraphExtent(graphBoundsBBox)
        ? cloneSigmaGraphExtent(graphBoundsBBox)
        : null
      const renderBBox = explicitBBox ? null : this.captureRenderGraphBBox()
      const bbox = explicitBBox ?? renderBBox ?? this.sigma.getBBox()
      this.sigma.setCustomBBox(cloneSigmaGraphExtent(bbox))
      this.isGraphBoundsLocked = true
      this.traceRendererEvent('setGraphBoundsLocked', {
        locked: true,
        bbox,
        source: explicitBBox
          ? 'pending-drag'
          : renderBBox
            ? 'render-store'
            : 'sigma',
        mode: 'freeze-current-bbox',
      })
      return
    }

    this.sigma.setCustomBBox(null)
    this.isGraphBoundsLocked = false
    this.traceRendererEvent('setGraphBoundsLocked', {
      locked: false,
    })
  }

  private readonly syncPhysicsPositionsToRender = () => {
    if (!this.positionLedger || !this.renderStore || !this.physicsStore) {
      return false
    }

    const positionLedger = this.positionLedger
    const renderStore = this.renderStore
    let changed = false

    this.physicsStore.getGraph().forEachNode((pubkey, attributes) => {
      if (renderStore.hasNode(pubkey)) {
        changed =
          renderStore.setNodePosition(pubkey, attributes.x, attributes.y) ||
          changed
      } else {
        changed =
          positionLedger.set(pubkey, attributes.x, attributes.y) || changed
      }
    })

    if (changed) {
      this.nodeHitTester?.markDirty()
    }

    return changed
  }

  private readonly syncPhysicsPositionsToRenderForPubkeys = (
    pubkeys: Iterable<string>,
  ) => {
    if (!this.positionLedger || !this.renderStore || !this.physicsStore) {
      return false
    }

    const physicsStore = this.physicsStore
    const positionLedger = this.positionLedger
    const renderStore = this.renderStore
    let changed = false
    const seenPubkeys = new Set<string>()

    for (const pubkey of pubkeys) {
      if (seenPubkeys.has(pubkey)) {
        continue
      }
      seenPubkeys.add(pubkey)
      const position = physicsStore.getNodePosition(pubkey)

      if (!position) {
        continue
      }

      if (renderStore.hasNode(pubkey)) {
        changed =
          renderStore.setNodePosition(pubkey, position.x, position.y) ||
          changed
      } else {
        changed =
          positionLedger.set(pubkey, position.x, position.y) || changed
      }
    }

    return changed
  }

  private collectViewportRenderPubkeys(
    addPubkey: (pubkey: string | null | undefined) => boolean,
  ) {
    const sigma = this.sigma
    const renderStore = this.renderStore
    const physicsStore = this.physicsStore
    if (
      !sigma ||
      !renderStore ||
      typeof sigma.getDimensions !== 'function' ||
      typeof sigma.viewportToGraph !== 'function'
    ) {
      return { visibleNodeCount: 0, addedNodeCount: 0 }
    }

    const viewport = this.getMinimapViewport()
    if (!viewport) {
      return { visibleNodeCount: 0, addedNodeCount: 0 }
    }

    const viewportWidth = viewport.maxX - viewport.minX
    const viewportHeight = viewport.maxY - viewport.minY
    const padding =
      Math.max(viewportWidth, viewportHeight) *
      PHYSICS_BRIDGE_VIEWPORT_PADDING_RATIO
    const minX = viewport.minX - padding
    const minY = viewport.minY - padding
    const maxX = viewport.maxX + padding
    const maxY = viewport.maxY + padding
    const nodeIds = renderStore.getGraph().nodes()
    const nodeCount = nodeIds.length
    let visibleNodeCount = 0
    let addedNodeCount = 0
    const isInsideViewport = (x: number, y: number) =>
      x >= minX && x <= maxX && y >= minY && y <= maxY

    if (nodeCount === 0) {
      return { visibleNodeCount, addedNodeCount }
    }

    const start = this.physicsBridgeViewportCursor % nodeCount
    for (let offset = 0; offset < nodeCount; offset += 1) {
      const index = (start + offset) % nodeCount
      const pubkey = nodeIds[index]
      if (!pubkey) {
        continue
      }
      const attrs = renderStore.getGraph().getNodeAttributes(pubkey)
      if (attrs.hidden) {
        continue
      }

      const renderVisible = isInsideViewport(attrs.x, attrs.y)
      const physicsPosition =
        renderVisible || !physicsStore?.hasNode(pubkey)
          ? null
          : physicsStore.getGraph().getNodeAttributes(pubkey)
      const physicsVisible = physicsPosition
        ? isInsideViewport(physicsPosition.x, physicsPosition.y)
        : false
      if (!renderVisible && !physicsVisible) {
        continue
      }

      visibleNodeCount += 1
      if (addPubkey(pubkey)) {
        addedNodeCount += 1
      }
      this.physicsBridgeViewportCursor = (index + 1) % nodeCount
    }

    return { visibleNodeCount, addedNodeCount }
  }

  private collectBackgroundPhysicsBridgePubkeys(
    addPubkey: (pubkey: string | null | undefined) => boolean,
  ) {
    const physicsStore = this.physicsStore
    if (!physicsStore) {
      return 0
    }

    const nodeIds = physicsStore.getGraph().nodes()
    const nodeCount = nodeIds.length
    if (nodeCount === 0) {
      return 0
    }

    const start = this.physicsBridgeBackgroundCursor % nodeCount
    let addedNodeCount = 0
    for (
      let offset = 0;
      offset < nodeCount &&
      addedNodeCount < PHYSICS_BRIDGE_BACKGROUND_SYNC_CAP;
      offset += 1
    ) {
      const index = (start + offset) % nodeCount
      if (addPubkey(nodeIds[index])) {
        addedNodeCount += 1
      }
      this.physicsBridgeBackgroundCursor = (index + 1) % nodeCount
    }

    return addedNodeCount
  }

  private readonly collectPhysicsBridgePubkeys = () => {
    if (!this.physicsStore) {
      return {
        pubkeys: [],
        visibleRenderNodeCount: 0,
        visibleRenderSyncedNodeCount: 0,
        avatarVisibleNodeCount: 0,
        backgroundSyncedNodeCount: 0,
      }
    }

    const physicsStore = this.physicsStore
    const pubkeys: string[] = []
    const seen = new Set<string>()
    const addPubkey = (pubkey: string | null | undefined) => {
      if (
        !pubkey ||
        seen.has(pubkey) ||
        !physicsStore.hasNode(pubkey)
      ) {
        return false
      }

      seen.add(pubkey)
      pubkeys.push(pubkey)
      return true
    }

    addPubkey(this.scene?.render.cameraHint.rootPubkey)
    addPubkey(this.scene?.render.selection.selectedNodePubkey)
    addPubkey(this.hoveredNodePubkey)
    addPubkey(this.draggedNodePubkey)

    for (const pubkey of this.scene?.render.pins.pubkeys ?? []) {
      addPubkey(pubkey)
    }
    const avatarVisibleNodeCount =
      this.avatarOverlay?.forEachVisibleNodePubkey((pubkey) => {
        addPubkey(pubkey)
      }) ?? 0
    const rendererFocus = this.resolveRendererFocus()
    for (const pubkey of rendererFocus.neighbors) {
      addPubkey(pubkey)
    }
    const dragHopDistances = this.dragHopDistances
    if (dragHopDistances.size > 0) {
      for (const [pubkey] of Array.from(dragHopDistances.entries()).sort(
        (left, right) => left[1] - right[1] || left[0].localeCompare(right[0]),
      )) {
        addPubkey(pubkey)
      }
    }
    const viewportSync = this.collectViewportRenderPubkeys(addPubkey)
    const backgroundSyncedNodeCount =
      seen.size < physicsStore.getGraph().order
        ? this.collectBackgroundPhysicsBridgePubkeys(addPubkey)
        : 0

    return {
      pubkeys,
      visibleRenderNodeCount: viewportSync.visibleNodeCount,
      visibleRenderSyncedNodeCount: viewportSync.addedNodeCount,
      avatarVisibleNodeCount,
      backgroundSyncedNodeCount,
    }
  }

  private readonly flushPhysicsPositionBridge = () => {
    this.pendingPhysicsBridgeFrame = null

    if (!this.forceRuntime?.isRunning()) {
      this.physicsBridgeFrameSkipCount = 0
      if (this.forceRuntime?.isSuspended() || this.draggedNodePubkey) {
        return
      }

      const startedAtMs = isGraphPerfTraceEnabled() ? nowGraphPerfMs() : 0
      const changed = this.syncPhysicsPositionsToRender()
      if (startedAtMs > 0) {
        traceGraphPerfDuration(
          'renderer.flushPhysicsPositionBridge',
          startedAtMs,
          () => ({
            syncMode: 'full_settle',
            changed,
            renderNodeCount: this.renderStore?.getGraph().order ?? 0,
            renderEdgeCount: this.renderStore?.getGraph().size ?? 0,
            physicsNodeCount: this.physicsStore?.getGraph().order ?? 0,
            physicsEdgeCount: this.physicsStore?.getGraph().size ?? 0,
            visibleNodeCount:
              this.avatarOverlay?.getVisibleNodePubkeyCount() ?? 0,
            hasDraggedNode: Boolean(this.draggedNodePubkey),
            hasHoveredNode: Boolean(this.hoveredNodePubkey),
          }),
          { thresholdMs: 8 },
        )
      }
      if (changed) {
        this.markMotion()
        this.safeRender()
      }
      this.traceRendererEvent('flushPhysicsPositionBridge', {
        syncMode: 'full_settle',
        changed,
        renderNodeCount: this.renderStore?.getGraph().order ?? 0,
        physicsNodeCount: this.physicsStore?.getGraph().order ?? 0,
      })
      return
    }

    const isDegraded = this.avatarBudget?.snapshot()?.isDegraded ?? false
    if (isDegraded && this.physicsBridgeFrameSkipCount < 3) {
      this.physicsBridgeFrameSkipCount += 1
      this.pendingPhysicsBridgeFrame = requestAnimationFrame(
        this.flushPhysicsPositionBridge,
      )
      return
    }
    this.physicsBridgeFrameSkipCount = 0

    const startedAtMs = isGraphPerfTraceEnabled() ? nowGraphPerfMs() : 0
    const priority = this.collectPhysicsBridgePubkeys()
    const priorityPubkeys = priority.pubkeys
    const physicsNodeCount = this.physicsStore?.getGraph().order ?? 0
    const shouldUsePrioritySync =
      priorityPubkeys.length > 0 && priorityPubkeys.length < physicsNodeCount
    const syncMode = shouldUsePrioritySync ? 'progressive' : 'full'
    const changed = shouldUsePrioritySync
      ? this.syncPhysicsPositionsToRenderForPubkeys(priorityPubkeys)
      : this.syncPhysicsPositionsToRender()
    if (startedAtMs > 0) {
      traceGraphPerfDuration(
        'renderer.flushPhysicsPositionBridge',
        startedAtMs,
        () => ({
          syncMode,
          changed,
          renderNodeCount: this.renderStore?.getGraph().order ?? 0,
          renderEdgeCount: this.renderStore?.getGraph().size ?? 0,
          physicsNodeCount,
          physicsEdgeCount: this.physicsStore?.getGraph().size ?? 0,
          priorityNodeCount: priorityPubkeys.length,
          visibleRenderNodeCount: priority.visibleRenderNodeCount,
          visibleRenderSyncedNodeCount:
            priority.visibleRenderSyncedNodeCount,
          avatarVisibleNodeCount: priority.avatarVisibleNodeCount,
          backgroundSyncedNodeCount: priority.backgroundSyncedNodeCount,
          hasDraggedNode: Boolean(this.draggedNodePubkey),
          hasHoveredNode: Boolean(this.hoveredNodePubkey),
        }),
        { thresholdMs: 8 },
      )
    }
    if (changed) {
      if (shouldUsePrioritySync) {
        this.nodeHitTester?.markDirty()
      }
      this.markMotion()
      this.safeRender()
    }
    this.traceRendererEvent('flushPhysicsPositionBridge', {
      syncMode,
      changed,
      priorityNodeCount: priorityPubkeys.length,
      visibleRenderNodeCount: priority.visibleRenderNodeCount,
      visibleRenderSyncedNodeCount: priority.visibleRenderSyncedNodeCount,
      avatarVisibleNodeCount: priority.avatarVisibleNodeCount,
      backgroundSyncedNodeCount: priority.backgroundSyncedNodeCount,
      physicsNodeCount,
    })

    this.pendingPhysicsBridgeFrame = requestAnimationFrame(
      this.flushPhysicsPositionBridge,
    )
  }

  private ensurePhysicsPositionBridge() {
    if (
      !this.forceRuntime?.isRunning() ||
      this.pendingPhysicsBridgeFrame !== null
    ) {
      return
    }

    this.recordDragTimelineEvent('physics-bridge', {
      pubkey: this.draggedNodePubkey ?? this.lastReleasedNodePubkey,
      details: { action: 'schedule' },
    })
    this.pendingPhysicsBridgeFrame = requestAnimationFrame(
      this.flushPhysicsPositionBridge,
    )
  }

  private readonly flushFitCameraAfterPhysicsSettles = (timestampMs: number) => {
    this.pendingFitCameraAfterPhysicsFrame = null

    if (this.forceRuntime?.isSuspended() || this.draggedNodePubkey) {
      this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(
        this.flushFitCameraAfterPhysicsSettles,
      )
      return
    }

    if (this.forceRuntime?.isRunning()) {
      const shouldRunIntermediateFit =
        this.shouldRepeatFitCameraUntilPhysicsSettles &&
        (this.lastPhysicsAutoFitAtMs === null ||
          timestampMs - this.lastPhysicsAutoFitAtMs >=
            PHYSICS_AUTO_FIT_INTERVAL_MS)
      if (shouldRunIntermediateFit) {
        this.lastPhysicsAutoFitAtMs = timestampMs
        this.fitCameraToGraph()
      }
      this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(
        this.flushFitCameraAfterPhysicsSettles,
      )
      return
    }

    this.cancelPhysicsPositionBridge()
    this.flushPhysicsPositionBridge()
    this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(() => {
      this.pendingFitCameraAfterPhysicsFrame = requestAnimationFrame(() => {
        this.pendingFitCameraAfterPhysicsFrame = null
        this.shouldRepeatFitCameraUntilPhysicsSettles = false
        this.lastPhysicsAutoFitAtMs = null
        this.fitCameraToGraph()
      })
    })
  }

  private cancelPendingFitCameraAfterPhysics() {
    if (this.pendingFitCameraAfterPhysicsFrame === null) {
      return
    }

    cancelAnimationFrame(this.pendingFitCameraAfterPhysicsFrame)
    this.pendingFitCameraAfterPhysicsFrame = null
    this.shouldRepeatFitCameraUntilPhysicsSettles = false
    this.lastPhysicsAutoFitAtMs = null
  }

  private cancelPhysicsPositionBridge() {
    if (this.pendingPhysicsBridgeFrame === null) {
      return
    }

    cancelAnimationFrame(this.pendingPhysicsBridgeFrame)
    this.pendingPhysicsBridgeFrame = null
  }

  public isNodeFixed(pubkey: string) {
    if (this.physicsStore?.hasNode(pubkey)) {
      return this.physicsStore.isNodeFixed(pubkey)
    }

    if (this.renderStore?.hasNode(pubkey)) {
      return this.renderStore.getGraph().getNodeAttribute(pubkey, 'fixed')
    }

    return false
  }
}
