import Sigma from 'sigma'
import type { Coordinates, TouchCoords } from 'sigma/types'

import { hasRenderableSigmaContainer } from '@/features/graph-v2/renderer/containerDimensions'
import type {
  GraphInteractionCallbacks,
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
  DebugNodePosition,
  DebugPhysicsDiagnostics,
} from '@/features/graph-v2/testing/browserDebug'
import {
  isGraphPerfTraceEnabled,
  nowGraphPerfMs,
  traceGraphPerfDuration,
} from '@/features/graph-runtime/debug/perfTrace'

const HOVER_SELECTED_NODE_COLOR = '#f4fbff'
const HOVER_DIM_NODE_COLOR = '#121a22'
const HOVER_EDGE_BRIGHT_COLOR = '#f4fbff'
const HOVER_DIM_EDGE_COLOR = '#10171f'
const HIGHLIGHT_TRANSITION_MS = 180
const HOVER_FOCUS_DWELL_MS = 500
const SCENE_FOCUS_TRANSITION_MS = 180
const STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS = 160
const PHYSICS_BRIDGE_BACKGROUND_SYNC_CAP = 96
const PHYSICS_BRIDGE_VIEWPORT_PADDING_RATIO = 0.12
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

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

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

type HighlightTransition = {
  from: HoverFocusSnapshot
  to: HoverFocusSnapshot
  startedAt: number
  durationMs: number
}

type NodeVisualStyle = Pick<
  RenderNodeAttributes,
  'color' | 'size' | 'zIndex' | 'highlighted' | 'forceLabel' | 'label'
>

type EdgeVisualStyle = Pick<
  RenderEdgeAttributes,
  'color' | 'size' | 'zIndex' | 'hidden'
>

type SceneFocusTransition = {
  nodes: Map<string, NodeVisualStyle>
  edges: Map<string, EdgeVisualStyle>
  startedAt: number
  durationMs: number
}

const pickNodeVisualStyle = (
  attributes: RenderNodeAttributes,
): NodeVisualStyle => ({
  color: attributes.color,
  size: attributes.size,
  zIndex: attributes.zIndex,
  highlighted: attributes.highlighted,
  forceLabel: attributes.forceLabel,
  label: attributes.label,
})

const pickEdgeVisualStyle = (
  attributes: RenderEdgeAttributes,
): EdgeVisualStyle => ({
  color: attributes.color,
  size: attributes.size,
  zIndex: attributes.zIndex,
  hidden: attributes.hidden,
})

const hasNodeVisualStyleChange = (
  from: NodeVisualStyle,
  to: NodeVisualStyle,
) =>
  from.color !== to.color ||
  from.size !== to.size ||
  from.zIndex !== to.zIndex ||
  from.highlighted !== to.highlighted ||
  from.forceLabel !== to.forceLabel ||
  from.label !== to.label

const hasEdgeVisualStyleChange = (
  from: EdgeVisualStyle,
  to: EdgeVisualStyle,
) =>
  from.color !== to.color ||
  from.size !== to.size ||
  from.zIndex !== to.zIndex ||
  from.hidden !== to.hidden

const mixNodeVisualAttributes = (
  from: RenderNodeAttributes | NodeVisualStyle,
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
  from: RenderEdgeAttributes | EdgeVisualStyle,
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

  private pendingContainerRefresh = false

  private pendingContainerRefreshFrame: number | null = null

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

  private draggedNodePubkey: string | null = null

  private shouldPinDraggedNodeOnRelease = false

  private resumePhysicsAfterDrag = true

  private pendingDragFrame: number | null = null

  private pendingPhysicsBridgeFrame: number | null = null

  private physicsBridgeViewportCursor = 0

  private physicsBridgeBackgroundCursor = 0

  private pendingGraphPosition: { x: number; y: number } | null = null

  private dragHopDistances: Map<string, number> = new Map()

  private dragInfluenceState: DragNeighborhoodInfluenceState | null = null

  private dragInfluenceConfig: DragNeighborhoodInfluenceConfig =
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG

  private lastDragGraphPosition: { x: number; y: number } | null = null

  private lastDragFlushTimestamp: number | null = null

  private moveBodyCount = 0

  private flushCount = 0

  private lastMoveBodyPointer: { x: number; y: number } | null = null

  private avatarRevealPointer: { x: number; y: number } | null = null

  private pendingAvatarRevealRenderFrame: number | null = null

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

  private highlightTransition: HighlightTransition | null = null

  private sceneFocusTransition: SceneFocusTransition | null = null

  private pendingHighlightTransitionFrame: number | null = null

  private hasMountedCamera = false

  private isCameraLocked = false

  private isGraphBoundsLocked = false

  private avatarCache: AvatarBitmapCache | null = null

  private avatarLoader: AvatarLoader | null = null

  private avatarScheduler: AvatarScheduler | null = null

  private avatarOverlay: AvatarOverlayRenderer | null = null

  private avatarDebugDetailsEnabled = false

  private avatarBudget: PerfBudget | null = null

  private motionActive = false

  private motionClearTimer: ReturnType<typeof setTimeout> | null = null

  private cameraMotionActive = false

  private cameraMotionClearTimer: ReturnType<typeof setTimeout> | null = null

  private readonly MOTION_RESUME_MS = 140

  private hideAvatarsOnMove = false

  private avatarImagesEnabled = true

  private hideConnectionsForLowPerformance = false

  private avatarRuntimeOptions: AvatarRuntimeOptions =
    DEFAULT_AVATAR_RUNTIME_OPTIONS

  private readonly flushContainerRefresh = () => {
    this.pendingContainerRefreshFrame = null

    if (!this.sigma || !hasRenderableSigmaContainer(this.container)) {
      return
    }

    this.pendingContainerRefresh = false
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

    if (!hasRenderableSigmaContainer(this.container)) {
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

    if (!hasRenderableSigmaContainer(this.container)) {
      this.pendingContainerRefresh = true
      return
    }

    this.sigma.scheduleRender()
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

  public recenterCamera() {
    this.sigma?.getCamera().animatedReset({ duration: 250 }).catch(() => {})
  }

  public fitCameraToGraph() {
    const sigma = this.sigma
    const renderStore = this.renderStore
    if (!sigma || !renderStore) {
      return
    }

    const graph = renderStore.getGraph()
    if (graph.order === 0) {
      return
    }

    const dimensions = sigma.getDimensions()
    if (dimensions.width <= 0 || dimensions.height <= 0) {
      return
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
      this.recenterCamera()
      return
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
      this.recenterCamera()
      return
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
    const graphPosition = this.pendingGraphPosition ?? this.lastDragGraphPosition
    const shouldEmitDragMove = this.pendingGraphPosition !== null
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

  private readonly startDrag = (pubkey: string) => {
    if (!this.renderStore || !this.physicsStore || !this.callbacks) {
      return
    }

    this.resumePhysicsAfterDrag = !(this.forceRuntime?.isSuspended() ?? false)
    this.draggedNodePubkey = pubkey
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
      this.renderStore.getNodePosition(pubkey) ??
      this.physicsStore.getNodePosition(pubkey)
    this.lastDragFlushTimestamp = null
    this.cancelPendingDragFrame()
    this.physicsStore.setNodeFixed(pubkey, true)
    this.setGraphBoundsLocked(true)
    this.forceRuntime?.suspend()
    // Force-lock highlight on the dragged node regardless of pointer position.
    this.setHoveredNode(pubkey, true)
    this.callbacks.onNodeDragStart(pubkey)
  }

  private readonly releaseDrag = (options?: { pinOnRelease?: boolean }) => {
    this.pendingDragGesture = null

    if (!this.draggedNodePubkey || !this.renderStore || !this.physicsStore || !this.callbacks) {
      this.setCameraLocked(false)
      this.setGraphBoundsLocked(false)
      this.cancelPendingDragFrame()
      this.dragHopDistances = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      this.shouldPinDraggedNodeOnRelease = false
      return
    }

    this.flushPendingDragFrame()

    const draggedNodePubkey = this.draggedNodePubkey
    const position = this.renderStore.getNodePosition(draggedNodePubkey)
    const shouldPinOnRelease =
      options?.pinOnRelease ?? this.shouldPinDraggedNodeOnRelease

    // Drain residual spring velocities before resuming FA2 so small clusters
    // don't get kicked out by leftover momentum from the influence engine.
    if (this.dragInfluenceState) {
      dampInfluenceVelocities(this.dragInfluenceState, 0.2)
    }

    releaseDraggedNode(
      this.physicsStore,
      draggedNodePubkey,
      shouldPinOnRelease
        ? [draggedNodePubkey]
        : (this.scene?.render.pins.pubkeys ?? []),
    )
    this.dragHopDistances = new Map()
    this.dragInfluenceState = null
    this.lastDragGraphPosition = null

    this.draggedNodePubkey = null
    this.shouldPinDraggedNodeOnRelease = false
    this.lastDragFlushTimestamp = null
    this.cancelPendingDragFrame()
    this.suppressedClick = createSuppressedNodeClick(draggedNodePubkey)
    this.suppressedStageClickUntil =
      Date.now() + STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS

    // Dragging edits graph coordinates while FA2 is suspended, so the last
    // convergence signal is no longer valid even if topology/settings stayed
    // the same. Resume from the current coordinates and let FA2 settle again.
    if (this.resumePhysicsAfterDrag) {
      this.forceRuntime?.resume({ invalidateConvergence: true })
      this.ensurePhysicsPositionBridge()
    } else {
      this.cancelPhysicsPositionBridge()
    }
    this.resumePhysicsAfterDrag = true
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.safeRender()

    // Recalculate hover based on actual pointer position after release.
    this.recalculateHoverAfterDrag()

    if (position) {
      this.callbacks.onNodeDragEnd(draggedNodePubkey, position, {
        pinNode: shouldPinOnRelease,
      })
    }
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
      tapMoveTolerance: sigma.getSetting('tapMoveTolerance'),
    })
    touchCaptor.on('touchmove', this.handleNaturalTouchZoom)
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
    this.renderStore.applyScene(initialScene.render)
    this.physicsStore.applyScene(initialScene.physics)
    this.forceRuntime = new ForceAtlasRuntime(this.physicsStore.getGraph())
    this.sigma = new Sigma(
      this.renderStore.getGraph(),
      container,
      this.createSigmaSettings(),
    )

    const sigma = this.sigma
    this.configureTouchInteraction(sigma)
    this.observeContainer(container)
    this.nodeHitTester = installStrictNodeHitTesting(
      sigma,
      this.renderStore.getGraph(),
    )
    this.initAvatarPipeline(sigma)
    this.bindEvents()
    this.forceRuntime.sync(initialScene.physics)
    this.ensurePhysicsPositionBridge()
    if (initialScene.render.nodes.length > 0) {
      this.fitCameraToGraph()
      this.hasMountedCamera = true
    }
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

    const previousScene = this.scene
    const shouldAnimateSceneFocus =
      (previousScene?.render.selection.selectedNodePubkey ?? null) !==
      (scene.render.selection.selectedNodePubkey ?? null)
    const previousVisualStyles = shouldAnimateSceneFocus
      ? this.captureRenderVisualStyles()
      : null
    const draggedNodePubkey = this.draggedNodePubkey
    const draggedNodePosition =
      draggedNodePubkey !== null ? this.lastDragGraphPosition : null
    this.scene = scene
    this.renderStore.applyScene(scene.render)
    this.startSceneFocusTransition(previousVisualStyles)
    const physicsApplyResult = this.physicsStore.applyScene(scene.physics)
    this.nodeHitTester?.markDirty()

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
    } else {
      this.dragHopDistances = new Map()
      this.dragInfluenceState = null
    }

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

    this.forceRuntime.sync(scene.physics, {
      topologyChanged: physicsApplyResult.topologyChanged,
    })
    this.ensurePhysicsPositionBridge()

    const previousRoot = previousScene?.render.cameraHint.rootPubkey ?? null
    const nextRoot = scene.render.cameraHint.rootPubkey
    const rootChangedToSomething =
      previousRoot !== nextRoot && nextRoot !== null
    if (!this.hasMountedCamera && scene.render.nodes.length > 0) {
      this.fitCameraToGraph()
      this.hasMountedCamera = true
    } else if (rootChangedToSomething && previousRoot === null) {
      // Initial root load: frame the graph once. Subsequent root changes
      // should not steal the camera from the user.
      this.fitCameraToGraph()
    }

    this.safeRefresh()
  }

  public dispose() {
    this.releaseDrag()
    this.cancelPendingDragFrame()
    this.cancelPhysicsPositionBridge()
    if (this.pendingAvatarRevealRenderFrame !== null) {
      cancelAnimationFrame(this.pendingAvatarRevealRenderFrame)
      this.pendingAvatarRevealRenderFrame = null
    }
    if (this.pendingHighlightTransitionFrame !== null) {
      cancelAnimationFrame(this.pendingHighlightTransitionFrame)
      this.pendingHighlightTransitionFrame = null
    }
    this.cancelPendingHoverFocus()
    if (this.pendingContainerRefreshFrame !== null) {
      cancelAnimationFrame(this.pendingContainerRefreshFrame)
      this.pendingContainerRefreshFrame = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.pendingContainerRefresh = false
    window.removeEventListener('keydown', this.handleKeyDown)
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.forceRuntime?.dispose()
    this.forceRuntime = null
    this.nodeHitTester?.dispose()
    this.nodeHitTester = null
    this.disposeAvatarPipeline()
    this.sigma?.kill()
    this.sigma = null
    this.positionLedger = null
    this.renderStore = null
    this.physicsStore = null
    this.callbacks = null
    this.scene = null
    this.container = null
    this.highlightTransition = null
    this.sceneFocusTransition = null
    this.hoveredNodePubkey = null
    this.hoveredNeighbors = new Set()
    this.currentHoverFocus = {
      pubkey: null,
      neighbors: this.hoveredNeighbors,
    }
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
        getBlockedAvatar: (urlKey) => this.avatarLoader?.getBlockedEntry(urlKey) ?? null,
        getSelectedNodePubkey: () =>
          this.scene?.render.selection.selectedNodePubkey ?? null,
        getHoveredNodePubkey: () => this.currentHoverFocus.pubkey,
        getForcedAvatarPubkey: () =>
          this.draggedNodePubkey ?? this.hoveredNodePubkey,
        getDraggedAvatarPubkey: () => this.draggedNodePubkey,
        getHoveredNeighborPubkeys: () => this.currentHoverFocus.neighbors,
        getAvatarRevealPointer: () => this.avatarRevealPointer,
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
    if (this.cameraMotionClearTimer !== null) {
      clearTimeout(this.cameraMotionClearTimer)
      this.cameraMotionClearTimer = null
    }
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
    this.motionActive = true
    if (this.motionClearTimer !== null) {
      clearTimeout(this.motionClearTimer)
    }
    this.motionClearTimer = setTimeout(() => {
      this.motionActive = false
      this.motionClearTimer = null
      this.safeRender()
    }, this.MOTION_RESUME_MS)
  }

  private markCameraMotion() {
    if (!this.avatarOverlay) {
      return
    }
    this.cameraMotionActive = true
    if (this.cameraMotionClearTimer !== null) {
      clearTimeout(this.cameraMotionClearTimer)
    }
    this.cameraMotionClearTimer = setTimeout(() => {
      this.cameraMotionActive = false
      this.cameraMotionClearTimer = null
      this.safeRender()
    }, this.MOTION_RESUME_MS)
  }

  private scheduleAvatarRevealRender() {
    if (this.pendingAvatarRevealRenderFrame !== null) {
      return
    }

    this.pendingAvatarRevealRenderFrame = requestAnimationFrame(() => {
      this.pendingAvatarRevealRenderFrame = null
      this.sigma?.scheduleRender()
    })
  }

  private scheduleAvatarSettledRefresh() {
    if (!this.sigma) {
      return
    }
    if (!hasRenderableSigmaContainer(this.container)) {
      this.pendingContainerRefresh = true
      return
    }

    this.pendingContainerRefresh = false
    this.sigma.scheduleRefresh()
  }

  private copyHoverFocusSnapshot(): HoverFocusSnapshot {
    // The neighbors Set is treated as read-only: setHoveredNode reassigns
    // currentHoverFocus to a fresh object+Set on every transition rather than
    // mutating, so sharing the reference here is safe and avoids cloning a
    // potentially large Set each hover event.
    return {
      pubkey: this.currentHoverFocus.pubkey,
      neighbors: this.currentHoverFocus.neighbors,
    }
  }

  private getTransitionAmount(
    transition: { startedAt: number; durationMs: number },
    now = performance.now(),
  ) {
    return easeInOut((now - transition.startedAt) / transition.durationMs)
  }

  private scheduleHighlightTransitionFrame() {
    if (this.pendingHighlightTransitionFrame !== null) {
      return
    }

    this.pendingHighlightTransitionFrame = requestAnimationFrame(
      this.flushHighlightTransitionFrame,
    )
  }

  private readonly flushHighlightTransitionFrame = () => {
    this.pendingHighlightTransitionFrame = null

    const now = performance.now()
    if (
      this.highlightTransition &&
      now - this.highlightTransition.startedAt >=
        this.highlightTransition.durationMs
    ) {
      this.highlightTransition = null
    }

    if (
      this.sceneFocusTransition &&
      now - this.sceneFocusTransition.startedAt >=
        this.sceneFocusTransition.durationMs
    ) {
      this.sceneFocusTransition = null
    }

    this.safeRender()

    if (this.highlightTransition || this.sceneFocusTransition) {
      this.scheduleHighlightTransitionFrame()
    }
  }

  private startHighlightTransition(
    from: HoverFocusSnapshot,
    to: HoverFocusSnapshot,
  ) {
    this.highlightTransition = {
      from,
      to,
      startedAt: performance.now(),
      durationMs: HIGHLIGHT_TRANSITION_MS,
    }
    this.scheduleHighlightTransitionFrame()
  }

  private captureRenderVisualStyles(): SceneFocusTransition | null {
    if (!this.renderStore) {
      return null
    }

    const graph = this.renderStore.getGraph()
    const nodes = new Map<string, NodeVisualStyle>()
    const edges = new Map<string, EdgeVisualStyle>()

    graph.forEachNode((pubkey, attributes) => {
      nodes.set(pubkey, pickNodeVisualStyle(attributes))
    })

    graph.forEachEdge((edgeId, attributes) => {
      edges.set(edgeId, pickEdgeVisualStyle(attributes))
    })

    return {
      nodes,
      edges,
      startedAt: performance.now(),
      durationMs: SCENE_FOCUS_TRANSITION_MS,
    }
  }

  private startSceneFocusTransition(
    previousStyles: SceneFocusTransition | null,
  ) {
    if (!previousStyles || !this.renderStore) {
      return
    }

    const graph = this.renderStore.getGraph()
    const changedNodes = new Map<string, NodeVisualStyle>()
    const changedEdges = new Map<string, EdgeVisualStyle>()

    for (const [pubkey, previousStyle] of previousStyles.nodes) {
      if (!graph.hasNode(pubkey)) {
        continue
      }

      const currentStyle = pickNodeVisualStyle(graph.getNodeAttributes(pubkey))
      if (hasNodeVisualStyleChange(previousStyle, currentStyle)) {
        changedNodes.set(pubkey, previousStyle)
      }
    }

    for (const [edgeId, previousStyle] of previousStyles.edges) {
      if (!graph.hasEdge(edgeId)) {
        continue
      }

      const currentStyle = pickEdgeVisualStyle(graph.getEdgeAttributes(edgeId))
      if (hasEdgeVisualStyleChange(previousStyle, currentStyle)) {
        changedEdges.set(edgeId, previousStyle)
      }
    }

    if (changedNodes.size === 0 && changedEdges.size === 0) {
      return
    }

    this.sceneFocusTransition = {
      nodes: changedNodes,
      edges: changedEdges,
      startedAt: performance.now(),
      durationMs: SCENE_FOCUS_TRANSITION_MS,
    }
    this.scheduleHighlightTransitionFrame()
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

      callbacks.onClearSelection()
    })

    sigma.on('enterNode', ({ node }) => {
      this.scheduleHoveredNodeFocus(node)
    })

    sigma.on('leaveNode', () => {
      this.clearHoveredNodeFocus()
    })

    sigma.on('leaveStage', () => {
      this.clearHoveredNodeFocus()
      this.avatarRevealPointer = null
      this.scheduleAvatarRevealRender()
    })

    sigma.on('downNode', ({ node, event }) => {
      this.setCameraLocked(true)
      this.avatarRevealPointer = { x: event.x, y: event.y }
      this.scheduleAvatarRevealRender()
      this.pendingDragGesture = createPendingNodeDragGesture(node, {
        x: event.x,
        y: event.y,
      })
    })

    sigma.on('moveBody', ({ event, preventSigmaDefault }) => {
      this.moveBodyCount += 1
      this.lastMoveBodyPointer = {
        x: event.x,
        y: event.y,
      }
      this.avatarRevealPointer = this.lastMoveBodyPointer
      this.scheduleAvatarRevealRender()
      this.shouldPinDraggedNodeOnRelease = isControlModifierPressed(event)
      const pendingDragGesture = this.pendingDragGesture

      if (!this.draggedNodePubkey && !pendingDragGesture) {
        return
      }

      preventSigmaDefault()

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

        this.startDrag(pendingDragGesture.pubkey)
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

    if (!focus.pubkey) {
      // Hot path during pan/zoom with no hover: merge size + label visibility
      // in a single spread instead of double-allocating via the helper.
      const sizeChanged = zoomScaledSize !== data.size
      if (data.isSelected) {
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
      return data.isSelected
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

    return data.isSelected
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
    if (!focus.pubkey || !this.sigma) {
      return data
    }

    const graph = this.sigma.getGraph()
    if (!graph.hasEdge(edge)) {
      return data
    }

    const source = graph.source(edge)
    const target = graph.target(edge)
    if (source !== focus.pubkey && target !== focus.pubkey) {
      return {
        ...data,
        color: HOVER_DIM_EDGE_COLOR,
        size: 0.2,
        zIndex: Math.min(data.zIndex, -3),
      }
    }

    return {
      ...data,
      color: HOVER_EDGE_BRIGHT_COLOR,
      hidden: false,
      size: Math.max(data.size + 1.6, 2.8),
      zIndex: Math.max(data.zIndex, 9),
    }
  }

  private resolveDragEdgeLodAttributes(
    edge: string,
    data: RenderEdgeAttributes,
  ): RenderEdgeAttributes | null {
    const draggedNodePubkey = this.draggedNodePubkey
    if (!draggedNodePubkey || !this.sigma) {
      return null
    }

    const graph = this.sigma.getGraph()
    if (!graph.hasEdge(edge)) {
      return data
    }

    const source = graph.source(edge)
    const target = graph.target(edge)
    if (source !== draggedNodePubkey && target !== draggedNodePubkey) {
      return data.hidden ? data : { ...data, hidden: true }
    }

    return this.resolveEdgeHoverAttributes(edge, data, {
      pubkey: draggedNodePubkey,
      neighbors: this.currentHoverFocus.neighbors,
    })
  }

  private resolveLowPerformanceEdgeLodAttributes(
    edge: string,
    data: RenderEdgeAttributes,
  ): RenderEdgeAttributes {
    if (data.hidden || data.touchesFocus || !this.sigma) {
      return data
    }

    const hoverFocus = this.currentHoverFocus
    if (hoverFocus.pubkey) {
      const graph = this.sigma.getGraph()
      if (!graph.hasEdge(edge)) {
        return data
      }

      const source = graph.source(edge)
      const target = graph.target(edge)
      if (source === hoverFocus.pubkey || target === hoverFocus.pubkey) {
        return this.resolveEdgeHoverAttributes(edge, data, hoverFocus)
      }
    }

    return { ...data, hidden: true }
  }

  private applyNodeSceneFocusTransition(
    node: string,
    target: RenderNodeAttributes,
  ) {
    if (!this.sceneFocusTransition) {
      return target
    }

    const previousStyle = this.sceneFocusTransition.nodes.get(node)
    if (!previousStyle) {
      return target
    }

    return mixNodeVisualAttributes(
      previousStyle,
      target,
      this.getTransitionAmount(this.sceneFocusTransition),
    )
  }

  private applyEdgeSceneFocusTransition(
    edge: string,
    target: RenderEdgeAttributes,
  ) {
    if (!this.sceneFocusTransition) {
      return target
    }

    const previousStyle = this.sceneFocusTransition.edges.get(edge)
    if (!previousStyle) {
      return target
    }

    return mixEdgeVisualAttributes(
      previousStyle,
      target,
      this.getTransitionAmount(this.sceneFocusTransition),
    )
  }

  private readonly nodeReducer = (
    node: string,
    data: RenderNodeAttributes,
  ) => {
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
      this.currentHoverFocus,
    )
    return this.applyNodeSceneFocusTransition(node, target)
  }

  private readonly edgeReducer = (
    edge: string,
    data: RenderEdgeAttributes,
  ) => {
    const dragEdgeLod = this.resolveDragEdgeLodAttributes(edge, data)
    if (dragEdgeLod) {
      return dragEdgeLod
    }

    if (this.hideConnectionsForLowPerformance) {
      return this.resolveLowPerformanceEdgeLodAttributes(edge, data)
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

    const target = this.resolveEdgeHoverAttributes(
      edge,
      data,
      this.currentHoverFocus,
    )
    return this.applyEdgeSceneFocusTransition(edge, target)
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

    if (this.hoveredNodePubkey === pubkey) {
      return
    }

    const previousFocus = this.copyHoverFocusSnapshot()
    this.hoveredNodePubkey = pubkey
    const nextNeighbors = new Set<string>()

    if (pubkey && this.renderStore) {
      const graph = this.renderStore.getGraph()
      if (graph.hasNode(pubkey)) {
        graph.forEachNeighbor(pubkey, (neighborPubkey) => {
          nextNeighbors.add(neighborPubkey)
        })
      }
    }

    this.hoveredNeighbors = nextNeighbors
    this.currentHoverFocus = {
      pubkey,
      neighbors: nextNeighbors,
    }
    // Share the same Set reference with the transition: currentHoverFocus is
    // reassigned (not mutated) on the next hover, so the transition's `to`
    // snapshot stays stable without a defensive clone.
    this.startHighlightTransition(previousFocus, this.currentHoverFocus)
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

  private readonly setGraphBoundsLocked = (locked: boolean) => {
    if (!this.sigma || this.isGraphBoundsLocked === locked) {
      return
    }

    if (locked) {
      const bbox = this.sigma.getBBox()
      this.sigma.setCustomBBox({
        x: [...bbox.x] as [number, number],
        y: [...bbox.y] as [number, number],
      })
      this.isGraphBoundsLocked = true
      return
    }

    this.sigma.setCustomBBox(null)
    this.isGraphBoundsLocked = false
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
    for (const pubkey of this.hoveredNeighbors) {
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
      return
    }

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

    this.pendingPhysicsBridgeFrame = requestAnimationFrame(
      this.flushPhysicsPositionBridge,
    )
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
