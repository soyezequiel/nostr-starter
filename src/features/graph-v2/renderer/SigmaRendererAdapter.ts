import Sigma from 'sigma'

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
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
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
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'
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

export class SigmaRendererAdapter implements RendererAdapter {
  private sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null

  private projectionStore: GraphologyProjectionStore | null = null

  private nodeHitTester: SpatialNodeHitTester | null = null

  private forceRuntime: ForceAtlasRuntime | null = null

  private callbacks: GraphInteractionCallbacks | null = null

  private scene: GraphSceneSnapshot | null = null

  private pendingDragGesture: PendingNodeDragGesture | null = null

  private suppressedClick: SuppressedNodeClick | null = null

  private suppressedStageClickUntil = 0

  private draggedNodePubkey: string | null = null

  private pendingDragFrame: number | null = null

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

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return
    }

    this.callbacks?.onClearSelection()
  }

  public getNodePosition(pubkey: string): DebugNodePosition | null {
    return this.projectionStore?.getNodePosition(pubkey) ?? null
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
    if (!this.projectionStore) {
      return null
    }

    const graph = this.projectionStore.getGraph()

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
    if (!this.projectionStore) {
      return null
    }

    const graph = this.projectionStore.getGraph()
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
  }

  public setHideAvatarsOnMove(enabled: boolean) {
    if (this.hideAvatarsOnMove === enabled) {
      return
    }

    this.hideAvatarsOnMove = enabled
    this.sigma?.refresh()
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
      this.avatarRuntimeOptions.hideImagesOnFastNodes ===
        nextOptions.hideImagesOnFastNodes &&
      this.avatarRuntimeOptions.fastNodeVelocityThreshold ===
        nextOptions.fastNodeVelocityThreshold
    ) {
      return
    }

    this.avatarRuntimeOptions = nextOptions
    this.sigma?.refresh()
  }

  public getAvatarPerfSnapshot(): PerfBudgetSnapshot | null {
    return this.avatarBudget?.snapshot() ?? null
  }

  public setDragInfluenceTuning(
    tuning: Partial<DragNeighborhoodInfluenceTuning>,
  ) {
    this.dragInfluenceConfig = createDragNeighborhoodInfluenceConfig(tuning)

    if (!this.projectionStore || !this.draggedNodePubkey) {
      return
    }

    this.dragInfluenceState = createDragNeighborhoodInfluenceState(
      this.projectionStore,
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
      !this.projectionStore ||
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

    this.projectionStore.setNodePosition(
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
        this.projectionStore,
        draggedNodePubkey,
        this.dragInfluenceState,
        deltaMs,
        this.dragInfluenceConfig,
      )
    }
    this.lastDragFlushTimestamp = now
    this.sigma.refresh()
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
    if (!this.projectionStore || !this.callbacks) {
      return
    }

    this.draggedNodePubkey = pubkey
    this.markMotion()
    this.dragHopDistances = buildDragHopDistances(
      this.projectionStore.getGraph(),
      pubkey,
      DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
    )
    this.dragInfluenceState = createDragNeighborhoodInfluenceState(
      this.projectionStore,
      pubkey,
      this.dragHopDistances,
      this.dragInfluenceConfig,
    )
    this.lastDragGraphPosition = this.projectionStore.getNodePosition(pubkey)
    this.lastDragFlushTimestamp = null
    this.cancelPendingDragFrame()
    this.projectionStore.setNodeFixed(pubkey, true)
    this.setGraphBoundsLocked(true)
    this.forceRuntime?.suspend()
    // Force-lock highlight on the dragged node regardless of pointer position.
    this.setHoveredNode(pubkey, true)
    this.callbacks.onNodeDragStart(pubkey)
  }

  private readonly releaseDrag = () => {
    this.pendingDragGesture = null

    if (!this.draggedNodePubkey || !this.projectionStore || !this.callbacks) {
      this.setCameraLocked(false)
      this.setGraphBoundsLocked(false)
      this.cancelPendingDragFrame()
      this.dragHopDistances = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      return
    }

    this.flushPendingDragFrame()

    const draggedNodePubkey = this.draggedNodePubkey
    const position = this.projectionStore.getNodePosition(draggedNodePubkey)

    // Drain residual spring velocities before resuming FA2 so small clusters
    // don't get kicked out by leftover momentum from the influence engine.
    if (this.dragInfluenceState) {
      dampInfluenceVelocities(this.dragInfluenceState, 0.2)
    }

    releaseDraggedNode(
      this.projectionStore,
      draggedNodePubkey,
      this.scene?.pins.pubkeys ?? [],
    )
    this.dragHopDistances = new Map()
    this.dragInfluenceState = null
    this.lastDragGraphPosition = null

    this.draggedNodePubkey = null
    this.lastDragFlushTimestamp = null
    this.suppressedClick = createSuppressedNodeClick(draggedNodePubkey)
    this.suppressedStageClickUntil =
      Date.now() + STAGE_CLICK_SUPPRESS_AFTER_DRAG_MS

    // Resume FA2 from current positions without reheat so the layout
    // continues smoothly rather than restarting and kicking clusters.
    this.forceRuntime?.resume()
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.sigma?.refresh()

    // Recalculate hover based on actual pointer position after release.
    this.recalculateHoverAfterDrag()

    if (position) {
      this.callbacks.onNodeDragEnd(draggedNodePubkey, position)
    }
  }

  public mount(
    container: HTMLElement,
    initialScene: GraphSceneSnapshot,
    callbacks: GraphInteractionCallbacks,
  ) {
    this.callbacks = callbacks
    this.scene = initialScene
    this.projectionStore = new GraphologyProjectionStore()
    this.projectionStore.applyScene(initialScene)
    this.forceRuntime = new ForceAtlasRuntime(this.projectionStore.getGraph())
    this.sigma = new Sigma(this.projectionStore.getGraph(), container, {
      renderEdgeLabels: false,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      labelDensity: 0.18,
      labelRenderedSizeThreshold: 10,
      enableEdgeEvents: false,
      defaultEdgeColor: '#7a92bd',
      defaultNodeColor: '#7dd3a7',
      minCameraRatio: 0.05,
      maxCameraRatio: 6,
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
    this.nodeHitTester = installStrictNodeHitTesting(
      sigma,
      this.projectionStore.getGraph(),
    )
    this.initAvatarPipeline(sigma)
    this.bindEvents()
    this.forceRuntime.sync(initialScene)
    if (initialScene.nodes.length > 0) {
      sigma
        .getCamera()
        .animatedReset({ duration: 250 })
        .catch(() => {})
      this.hasMountedCamera = true
    }
  }

  public update(scene: GraphSceneSnapshot) {
    if (!this.sigma || !this.projectionStore || !this.forceRuntime) {
      return
    }

    const sigma = this.sigma
    const previousScene = this.scene
    const draggedNodePubkey = this.draggedNodePubkey
    const draggedNodePosition =
      draggedNodePubkey !== null ? this.lastDragGraphPosition : null
    this.scene = scene
    this.projectionStore.applyScene(scene)
    this.nodeHitTester?.markDirty()

    if (draggedNodePubkey) {
      this.dragHopDistances = buildDragHopDistances(
        this.projectionStore.getGraph(),
        draggedNodePubkey,
        DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
      )
      this.dragInfluenceState = createDragNeighborhoodInfluenceState(
        this.projectionStore,
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
      this.projectionStore.setNodePosition(
        draggedNodePubkey,
        draggedNodePosition.x,
        draggedNodePosition.y,
        true,
      )
      this.nodeHitTester?.markDirty()
    }

    this.forceRuntime.sync(scene)

    const previousRoot = previousScene?.cameraHint.rootPubkey ?? null
    const nextRoot = scene.cameraHint.rootPubkey
    const rootChangedToSomething =
      previousRoot !== nextRoot && nextRoot !== null
    if (!this.hasMountedCamera && scene.nodes.length > 0) {
      sigma.getCamera().animatedReset({ duration: 250 }).catch(() => {})
      this.hasMountedCamera = true
    } else if (rootChangedToSomething && previousRoot === null) {
      // Initial root load: frame the graph once. Subsequent root changes
      // should not steal the camera from the user.
      sigma.getCamera().animatedReset({ duration: 320 }).catch(() => {})
    }

    sigma.refresh()
  }

  public dispose() {
    this.releaseDrag()
    this.cancelPendingDragFrame()
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
    this.projectionStore = null
    this.callbacks = null
    this.scene = null
  }

  private initAvatarPipeline(
    sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
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
          this.sigma?.refresh()
        },
      })
      this.avatarBudget = new PerfBudget(tier)
      this.avatarOverlay = new AvatarOverlayRenderer({
        sigma,
        cache: this.avatarCache,
        scheduler: this.avatarScheduler,
        budget: this.avatarBudget,
        isMoving: () => this.hideAvatarsOnMove && this.motionActive,
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
      this.sigma?.refresh()
    }, this.MOTION_RESUME_MS)
  }

  private bindEvents() {
    if (!this.sigma || !this.projectionStore || !this.callbacks) {
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

    sigma.on('upNode', () => {
      this.releaseDrag()
    })

    sigma.on('upStage', () => {
      this.releaseDrag()
    })

    sigma.getCamera().on('updated', (viewport) => {
      callbacks.onViewportChange(viewport)
    })

    window.addEventListener('keydown', this.handleKeyDown)
  }

  private readonly nodeReducer = (
    node: string,
    data: SigmaNodeAttributes,
  ) => {
    const cameraRatio = this.sigma?.getCamera().getState().ratio ?? 1
    const zoomScaledSize = data.size * resolveZoomOutNodeScale(cameraRatio)

    if (!this.hoveredNodePubkey) {
      return zoomScaledSize === data.size
        ? data
        : {
            ...data,
            size: zoomScaledSize,
          }
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
      return {
        ...data,
        size: zoomScaledSize,
        color: HOVER_NEIGHBOR_NODE_COLOR,
        forceLabel: true,
        highlighted: true,
        zIndex: Math.max(data.zIndex, 8),
      }
    }

    return {
      ...data,
      size: zoomScaledSize,
      color: HOVER_DIM_NODE_COLOR,
      forceLabel: false,
      highlighted: false,
      zIndex: Math.min(data.zIndex, -3),
    }
  }

  private readonly edgeReducer = (
    edge: string,
    data: SigmaEdgeAttributes,
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

    if (pubkey && this.projectionStore) {
      const graph = this.projectionStore.getGraph()
      if (graph.hasNode(pubkey)) {
        graph.forEachNeighbor(pubkey, (neighborPubkey) => {
          this.hoveredNeighbors.add(neighborPubkey)
        })
      }
    }

    this.sigma?.refresh()
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

  public isNodeFixed(pubkey: string) {
    return this.projectionStore?.isNodeFixed(pubkey) ?? false
  }
}
