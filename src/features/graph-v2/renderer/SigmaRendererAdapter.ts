import Sigma from 'sigma'

import { hasRenderableSigmaContainer } from '@/features/graph-v2/renderer/containerDimensions'
import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
  RendererAdapter,
} from '@/features/graph-v2/renderer/contracts'
import {
  drawCachedDiscNodeHover,
  drawCachedDiscNodeLabel,
} from '@/features/graph-v2/renderer/cachedNodeLabels'
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
import type {
  DebugDragCandidate,
  DebugNeighborGroups,
  DebugDragRuntimeState,
  DebugNodePosition,
  DebugPhysicsDiagnostics,
} from '@/features/graph-v2/testing/browserDebug'

const HOVER_SELECTED_NODE_COLOR = '#ffb25b'
const HOVER_NEIGHBOR_NODE_COLOR = '#f8f2a2'
const HOVER_DIM_NODE_COLOR = '#121a22'
const HOVER_EDGE_BRIGHT_COLOR = '#f4fbff'
const HOVER_DIM_EDGE_COLOR = '#10171f'
const STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS = 160
const NODE_ZOOM_OUT_MIN_SCALE = 0.42
const NODE_ZOOM_OUT_SCALE_EXPONENT = 0.55
const AVATAR_MIN_SIZE_THRESHOLD = 4
const AVATAR_MAX_SIZE_THRESHOLD = 48
const AVATAR_MIN_ZOOM_THRESHOLD = 0.5
const AVATAR_MAX_ZOOM_THRESHOLD = 6
const AVATAR_MIN_FAST_NODE_VELOCITY = 40
const AVATAR_MAX_FAST_NODE_VELOCITY = 2000

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const resolveZoomOutNodeScale = (cameraRatio: number) =>
  clampNumber(
    1 / Math.pow(Math.max(cameraRatio, 1), NODE_ZOOM_OUT_SCALE_EXPONENT),
    NODE_ZOOM_OUT_MIN_SCALE,
    1,
  )

const applySelectedLabelVisibility = (
  data: RenderNodeAttributes,
): RenderNodeAttributes =>
  data.isSelected
    ? {
        ...data,
        forceLabel: true,
      }
    : {
        ...data,
        label: '',
        forceLabel: false,
      }

const isControlModifierPressed = (
  event: { original?: MouseEvent | TouchEvent } | null | undefined,
) =>
  Boolean(
    event?.original &&
      'ctrlKey' in event.original &&
      event.original.ctrlKey,
  )

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

  private pendingDragFrame: number | null = null

  private pendingPhysicsBridgeFrame: number | null = null

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

  private lastScheduledGraphPosition: { x: number; y: number } | null = null

  private lastFlushedGraphPosition: { x: number; y: number } | null = null

  private hoveredNodePubkey: string | null = null

  private hoveredNeighbors: Set<string> = new Set()

  private hasMountedCamera = false

  private isCameraLocked = false

  private isGraphBoundsLocked = false

  private avatarCache: AvatarBitmapCache | null = null

  private avatarLoader: AvatarLoader | null = null

  private avatarScheduler: AvatarScheduler | null = null

  private avatarOverlay: AvatarOverlayRenderer | null = null

  private avatarBudget: PerfBudget | null = null

  private motionActive = false

  private motionClearTimer: ReturnType<typeof setTimeout> | null = null

  private readonly MOTION_RESUME_MS = 140

  private hideAvatarsOnMove = false

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
    this.sigma.refresh()
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

  public setPhysicsSuspended(suspended: boolean) {
    if (!this.forceRuntime) return
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
      showZoomedOutMonograms:
        options.showZoomedOutMonograms ??
        DEFAULT_AVATAR_RUNTIME_OPTIONS.showZoomedOutMonograms,
      hideImagesOnFastNodes: options.hideImagesOnFastNodes,
      fastNodeVelocityThreshold: clampNumber(
        options.fastNodeVelocityThreshold,
        AVATAR_MIN_FAST_NODE_VELOCITY,
        AVATAR_MAX_FAST_NODE_VELOCITY,
      ),
    }

    if (
      this.avatarRuntimeOptions.sizeThreshold === nextOptions.sizeThreshold &&
      this.avatarRuntimeOptions.zoomThreshold === nextOptions.zoomThreshold &&
      this.avatarRuntimeOptions.showZoomedOutMonograms ===
        nextOptions.showZoomedOutMonograms &&
      this.avatarRuntimeOptions.hideImagesOnFastNodes ===
        nextOptions.hideImagesOnFastNodes &&
      this.avatarRuntimeOptions.fastNodeVelocityThreshold ===
        nextOptions.fastNodeVelocityThreshold
    ) {
      return
    }

    this.avatarRuntimeOptions = nextOptions
    this.safeRefresh()
  }

  public getAvatarPerfSnapshot(): PerfBudgetSnapshot | null {
    return this.avatarBudget?.snapshot() ?? null
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
      !this.draggedNodePubkey ||
      !this.pendingGraphPosition
    ) {
      return
    }

    this.markMotion()
    this.flushCount += 1
    const draggedNodePubkey = this.draggedNodePubkey
    const graphPosition = this.pendingGraphPosition
    this.pendingGraphPosition = null
    const now = performance.now()
    const previousTimestamp = this.lastDragFlushTimestamp
    const deltaMs =
      previousTimestamp === null ? 16 : Math.max(now - previousTimestamp, 1)

    this.renderStore.setNodePosition(
      draggedNodePubkey,
      graphPosition.x,
      graphPosition.y,
    )
    this.physicsStore.setNodePosition(
      draggedNodePubkey,
      graphPosition.x,
      graphPosition.y,
      true,
    )
    this.nodeHitTester?.markDirty()
    this.lastDragGraphPosition = graphPosition
    this.lastFlushedGraphPosition = graphPosition
    if (this.dragInfluenceState) {
      stepDragNeighborhoodInfluence(
        this.physicsStore,
        draggedNodePubkey,
        this.dragInfluenceState,
        deltaMs,
        this.dragInfluenceConfig,
      )
    }
    this.syncPhysicsPositionsToRender()
    this.lastDragFlushTimestamp = now
    this.safeRefresh()
    this.callbacks.onNodeDragMove(draggedNodePubkey, graphPosition)
  }

  private readonly scheduleDragFrame = (graphPosition: { x: number; y: number }) => {
    this.pendingGraphPosition = graphPosition
    this.lastScheduledGraphPosition = graphPosition

    if (this.pendingDragFrame !== null) {
      return
    }

    this.pendingDragFrame = requestAnimationFrame(this.flushPendingDragFrame)
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
    this.suppressedClick = createSuppressedNodeClick(draggedNodePubkey)
    this.suppressedStageClickUntil =
      Date.now() + STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS

    // Resume FA2 from current positions without reheat so the layout
    // continues smoothly rather than restarting and kicking clusters.
    this.forceRuntime?.resume()
    this.ensurePhysicsPositionBridge()
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.safeRefresh()

    // Recalculate hover based on actual pointer position after release.
    this.recalculateHoverAfterDrag()

    if (position) {
      this.callbacks.onNodeDragEnd(draggedNodePubkey, position, {
        pinNode: shouldPinOnRelease,
      })
    }
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
    this.sigma = new Sigma(this.renderStore.getGraph(), container, {
      renderEdgeLabels: false,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
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
      defaultDrawNodeHover: drawCachedDiscNodeHover,
      nodeReducer: this.nodeReducer,
      edgeReducer: this.edgeReducer,
    })

    const sigma = this.sigma
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
      sigma
        .getCamera()
        .animatedReset({ duration: 250 })
        .catch(() => {})
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

    const sigma = this.sigma
    const previousScene = this.scene
    const draggedNodePubkey = this.draggedNodePubkey
    const draggedNodePosition =
      draggedNodePubkey !== null ? this.lastDragGraphPosition : null
    this.scene = scene
    this.renderStore.applyScene(scene.render)
    this.physicsStore.applyScene(scene.physics)
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

    this.forceRuntime.sync(scene.physics)
    this.ensurePhysicsPositionBridge()

    const previousRoot = previousScene?.render.cameraHint.rootPubkey ?? null
    const nextRoot = scene.render.cameraHint.rootPubkey
    const rootChangedToSomething =
      previousRoot !== nextRoot && nextRoot !== null
    if (!this.hasMountedCamera && scene.render.nodes.length > 0) {
      sigma.getCamera().animatedReset({ duration: 250 }).catch(() => {})
      this.hasMountedCamera = true
    } else if (rootChangedToSomething && previousRoot === null) {
      // Initial root load: frame the graph once. Subsequent root changes
      // should not steal the camera from the user.
      sigma.getCamera().animatedReset({ duration: 320 }).catch(() => {})
    }

    this.safeRefresh()
  }

  public dispose() {
    this.releaseDrag()
    this.cancelPendingDragFrame()
    this.cancelPhysicsPositionBridge()
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
          this.safeRefresh()
        },
      })
      this.avatarBudget = new PerfBudget(tier)
      this.avatarOverlay = new AvatarOverlayRenderer({
        sigma,
        cache: this.avatarCache,
        scheduler: this.avatarScheduler,
        budget: this.avatarBudget,
        isMoving: () => this.hideAvatarsOnMove && this.motionActive,
        getForcedAvatarPubkey: () => this.draggedNodePubkey,
        getRuntimeOptions: () => this.avatarRuntimeOptions,
      })

      sigma.getCamera().on('updated', () => {
        this.markMotion()
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
    this.motionActive = false
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
      this.safeRefresh()
    }, this.MOTION_RESUME_MS)
  }

  private bindEvents() {
    if (!this.sigma || !this.renderStore || !this.physicsStore || !this.callbacks) {
      return
    }

    const sigma = this.sigma
    const callbacks = this.callbacks

    sigma.on('clickNode', ({ node }) => {
      if (shouldSuppressNodeClick(this.suppressedClick, node)) {
        this.suppressedClick = null
        return
      }

      if (this.suppressedClick && Date.now() > this.suppressedClick.expiresAt) {
        this.suppressedClick = null
      }

      callbacks.onNodeClick(node)
    })

    sigma.on('clickStage', () => {
      if (Date.now() < this.suppressedStageClickUntil) {
        return
      }

      callbacks.onClearSelection()
    })

    sigma.on('enterNode', ({ node }) => {
      this.setHoveredNode(node)
      callbacks.onNodeHover(node)
    })

    sigma.on('leaveNode', () => {
      this.setHoveredNode(null)
      callbacks.onNodeHover(null)
    })

    sigma.on('downNode', ({ node, event }) => {
      this.setCameraLocked(true)
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

  private readonly nodeReducer = (
    node: string,
    data: RenderNodeAttributes,
  ) => {
    const cameraRatio = this.sigma?.getCamera().getState().ratio ?? 1
    const zoomScaledSize = data.size * resolveZoomOutNodeScale(cameraRatio)

    if (!this.hoveredNodePubkey) {
      return applySelectedLabelVisibility(
        zoomScaledSize === data.size
          ? data
          : {
              ...data,
              size: zoomScaledSize,
            },
      )
    }

    if (node === this.hoveredNodePubkey) {
      return {
        ...data,
        size: zoomScaledSize,
        color: HOVER_SELECTED_NODE_COLOR,
        forceLabel: true,
        highlighted: true,
        zIndex: Math.max(data.zIndex, 10),
      }
    }

    if (this.hoveredNeighbors.has(node)) {
      return applySelectedLabelVisibility(
        {
          ...data,
          size: zoomScaledSize,
          color: HOVER_NEIGHBOR_NODE_COLOR,
          highlighted: true,
          zIndex: Math.max(data.zIndex, 8),
        },
      )
    }

    return applySelectedLabelVisibility(
      {
        ...data,
        size: zoomScaledSize,
        color: HOVER_DIM_NODE_COLOR,
        highlighted: false,
        zIndex: Math.min(data.zIndex, -3),
      },
    )
  }

  private readonly edgeReducer = (
    edge: string,
    data: RenderEdgeAttributes,
  ) => {
    if (!this.hoveredNodePubkey || !this.sigma) {
      return data
    }

    const graph = this.sigma.getGraph()
    if (!graph.hasEdge(edge)) {
      return data
    }

    const source = graph.source(edge)
    const target = graph.target(edge)
    if (source !== this.hoveredNodePubkey && target !== this.hoveredNodePubkey) {
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

  private readonly setHoveredNode = (
    pubkey: string | null,
    force = false,
  ) => {
    // While dragging, external enterNode/leaveNode events must not change
    // the highlight — the dragged node stays highlighted until release.
    if (!force && this.draggedNodePubkey) {
      return
    }

    if (this.hoveredNodePubkey === pubkey) {
      return
    }

    this.hoveredNodePubkey = pubkey
    this.hoveredNeighbors = new Set()

    if (pubkey && this.renderStore) {
      const graph = this.renderStore.getGraph()
      if (graph.hasNode(pubkey)) {
        graph.forEachNeighbor(pubkey, (neighborPubkey) => {
          this.hoveredNeighbors.add(neighborPubkey)
        })
      }
    }

    this.safeRefresh()
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

    let changed = false

    this.physicsStore.getGraph().forEachNode((pubkey, attributes) => {
      if (this.renderStore.hasNode(pubkey)) {
        changed =
          this.renderStore.setNodePosition(pubkey, attributes.x, attributes.y) ||
          changed
      } else {
        changed =
          this.positionLedger.set(pubkey, attributes.x, attributes.y) || changed
      }
    })

    if (changed) {
      this.nodeHitTester?.markDirty()
    }

    return changed
  }

  private readonly flushPhysicsPositionBridge = () => {
    this.pendingPhysicsBridgeFrame = null

    if (!this.forceRuntime?.isRunning()) {
      return
    }

    const changed = this.syncPhysicsPositionsToRender()
    if (changed) {
      this.markMotion()
      this.safeRefresh()
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
