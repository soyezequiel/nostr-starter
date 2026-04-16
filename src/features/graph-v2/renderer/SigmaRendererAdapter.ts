import Sigma from 'sigma'

import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
  RendererAdapter,
} from '@/features/graph-v2/renderer/contracts'
import { ForceAtlasRuntime } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import {
  buildDragNeighborhoodWeights,
  DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
} from '@/features/graph-v2/renderer/dragNeighborhood'
import {
  createDragNeighborhoodInfluenceState,
  DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  releaseDraggedNode,
  stepDragNeighborhoodInfluence,
  type DragNeighborhoodInfluenceState,
} from '@/features/graph-v2/renderer/dragInfluence'
import {
  createDragReleaseSettlingState,
  DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
  getSettlingSpeedMagnitude,
  stepDragReleaseSettling,
  type DragReleaseSettlingState,
} from '@/features/graph-v2/renderer/dragReleaseSettling'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'
import {
  createSuppressedNodeClick,
  createPendingNodeDragGesture,
  shouldSuppressNodeClick,
  shouldStartNodeDrag,
  type PendingNodeDragGesture,
  type SuppressedNodeClick,
} from '@/features/graph-v2/renderer/nodeDragGesture'
import type {
  DebugDragCandidate,
  DebugNeighborGroups,
  DebugDragRuntimeState,
  DebugNodePosition,
} from '@/features/graph-v2/testing/browserDebug'

const DRAG_VELOCITY_EMA_ALPHA = 0.45
const HOVER_LABEL_BOOST = 1.25
const HOVER_EDGE_BRIGHT_COLOR = '#e2ebff'

export class SigmaRendererAdapter implements RendererAdapter {
  private sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null

  private projectionStore: GraphologyProjectionStore | null = null

  private forceRuntime: ForceAtlasRuntime | null = null

  private callbacks: GraphInteractionCallbacks | null = null

  private scene: GraphSceneSnapshot | null = null

  private pendingDragGesture: PendingNodeDragGesture | null = null

  private suppressedClick: SuppressedNodeClick | null = null

  private draggedNodePubkey: string | null = null

  private settlingDraggedNodePubkey: string | null = null

  private pendingDragFrame: number | null = null

  private pendingSettlingFrame: number | null = null

  private pendingGraphPosition: { x: number; y: number } | null = null

  private dragNeighborhoodWeights = new Map<string, number>()

  private dragInfluenceState: DragNeighborhoodInfluenceState | null = null

  private lastDragGraphPosition: { x: number; y: number } | null = null

  private lastDragFlushTimestamp: number | null = null

  private dragReleaseVelocity: { x: number; y: number } | null = null

  private settlingState: DragReleaseSettlingState | null = null

  private lastSettlingTimestamp: number | null = null

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

    const outside = graph
      .nodes()
      .filter(
        (nodePubkey) =>
          nodePubkey !== pubkey &&
          !depth1.has(nodePubkey) &&
          !depth2.has(nodePubkey),
      )
      .sort((left, right) => left.localeCompare(right))

    return {
      sourcePubkey: pubkey,
      depth0: [pubkey],
      depth1: Array.from(depth1).sort((left, right) => left.localeCompare(right)),
      depth2: Array.from(depth2).sort((left, right) => left.localeCompare(right)),
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
    return {
      draggedNodePubkey: this.draggedNodePubkey,
      settlingDraggedNodePubkey: this.settlingDraggedNodePubkey,
      pendingDragGesturePubkey: this.pendingDragGesture?.pubkey ?? null,
      settlingSpeed:
        this.settlingState !== null
          ? getSettlingSpeedMagnitude(this.settlingState)
          : null,
      forceAtlasRunning: this.forceRuntime?.isRunning() ?? false,
      forceAtlasSuspended: this.forceRuntime?.isSuspended() ?? false,
      moveBodyCount: this.moveBodyCount,
      flushCount: this.flushCount,
      lastMoveBodyPointer: this.lastMoveBodyPointer,
      lastScheduledGraphPosition: this.lastScheduledGraphPosition,
      lastFlushedGraphPosition: this.lastFlushedGraphPosition,
    }
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

    this.flushCount += 1
    const draggedNodePubkey = this.draggedNodePubkey
    const graphPosition = this.pendingGraphPosition
    this.pendingGraphPosition = null
    const previousPosition =
      this.lastDragGraphPosition ??
      this.projectionStore.getNodePosition(draggedNodePubkey)
    const now = performance.now()
    const previousTimestamp = this.lastDragFlushTimestamp
    const deltaMs =
      previousTimestamp === null ? 16 : Math.max(now - previousTimestamp, 1)

    if (previousPosition) {
      const dx = graphPosition.x - previousPosition.x
      const dy = graphPosition.y - previousPosition.y

      if (dx !== 0 || dy !== 0) {
        const nextVelocityX = dx / deltaMs
        const nextVelocityY = dy / deltaMs
        const previousVelocity = this.dragReleaseVelocity

        this.dragReleaseVelocity = previousVelocity
          ? {
              x:
                previousVelocity.x * (1 - DRAG_VELOCITY_EMA_ALPHA) +
                nextVelocityX * DRAG_VELOCITY_EMA_ALPHA,
              y:
                previousVelocity.y * (1 - DRAG_VELOCITY_EMA_ALPHA) +
                nextVelocityY * DRAG_VELOCITY_EMA_ALPHA,
            }
          : {
              x: nextVelocityX,
              y: nextVelocityY,
            }
      }
    }

    this.projectionStore.setNodePosition(
      draggedNodePubkey,
      graphPosition.x,
      graphPosition.y,
      true,
    )
    this.lastDragGraphPosition = graphPosition
    this.lastFlushedGraphPosition = graphPosition
    if (this.dragInfluenceState) {
      stepDragNeighborhoodInfluence(
        this.projectionStore,
        draggedNodePubkey,
        this.dragInfluenceState,
        deltaMs,
        DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
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

  private readonly clearReleaseSettling = (releaseNode: boolean) => {
    if (this.pendingSettlingFrame !== null) {
      cancelAnimationFrame(this.pendingSettlingFrame)
      this.pendingSettlingFrame = null
    }

    this.settlingState = null
    this.lastSettlingTimestamp = null

    if (!releaseNode || !this.settlingDraggedNodePubkey || !this.projectionStore) {
      this.settlingDraggedNodePubkey = null
      return
    }

    releaseDraggedNode(
      this.projectionStore,
      this.settlingDraggedNodePubkey,
      this.scene?.pins.pubkeys ?? [],
    )
    this.settlingDraggedNodePubkey = null
  }

  private readonly finishReleaseSettling = (pubkey: string) => {
    if (!this.projectionStore) {
      this.clearReleaseSettling(false)
      this.dragNeighborhoodWeights = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      this.dragReleaseVelocity = null
      return
    }

    releaseDraggedNode(
      this.projectionStore,
      pubkey,
      this.scene?.pins.pubkeys ?? [],
    )
    this.clearReleaseSettling(false)
    this.dragNeighborhoodWeights = new Map()
    this.dragInfluenceState = null
    this.lastDragGraphPosition = null
    this.dragReleaseVelocity = null
    this.forceRuntime?.resume()
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.sigma?.refresh()
  }

  private readonly flushReleaseSettlingFrame = (timestamp: number) => {
    this.pendingSettlingFrame = null

    if (
      !this.projectionStore ||
      !this.sigma ||
      !this.settlingDraggedNodePubkey ||
      !this.settlingState
    ) {
      return
    }

    const pubkey = this.settlingDraggedNodePubkey
    const lastTimestamp = this.lastSettlingTimestamp ?? timestamp
    const deltaMs = Math.max(timestamp - lastTimestamp, 1)
    const result = stepDragReleaseSettling(
      this.settlingState,
      deltaMs,
      DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    )
    const position = this.projectionStore.getNodePosition(pubkey)
    let translatedSomething = false

    this.lastSettlingTimestamp = timestamp
    this.settlingState = result.nextState

    if (position && (result.translationX !== 0 || result.translationY !== 0)) {
      const nextPosition = {
        x: position.x + result.translationX,
        y: position.y + result.translationY,
      }

      this.projectionStore.setNodePosition(pubkey, nextPosition.x, nextPosition.y, true)
      this.lastDragGraphPosition = nextPosition
      this.lastFlushedGraphPosition = nextPosition
      this.callbacks?.onNodeDragMove(pubkey, nextPosition)
      translatedSomething = true
    }

    const influenceResult = this.dragInfluenceState
      ? stepDragNeighborhoodInfluence(
          this.projectionStore,
          pubkey,
          this.dragInfluenceState,
          deltaMs,
          DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
        )
      : { active: false, translated: false }

    translatedSomething ||= influenceResult.translated

    if (translatedSomething) {
      this.sigma.refresh()
    }

    if (result.done && !influenceResult.active) {
      this.finishReleaseSettling(pubkey)
      return
    }

    this.pendingSettlingFrame = requestAnimationFrame(this.flushReleaseSettlingFrame)
  }

  private readonly scheduleSettledNodeRelease = (pubkey: string) => {
    this.clearReleaseSettling(false)
    this.settlingDraggedNodePubkey = pubkey
    const velocity = this.dragReleaseVelocity ?? { x: 0, y: 0 }

    this.settlingState = createDragReleaseSettlingState(
      velocity.x,
      velocity.y,
      DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    )
    this.lastSettlingTimestamp = null

    if (
      getSettlingSpeedMagnitude(this.settlingState) <=
        DEFAULT_DRAG_RELEASE_SETTLING_CONFIG.stopSpeedThreshold &&
      !this.dragInfluenceState
    ) {
      this.finishReleaseSettling(pubkey)
      return
    }

    this.pendingSettlingFrame = requestAnimationFrame(this.flushReleaseSettlingFrame)
  }

  private readonly startDrag = (pubkey: string) => {
    if (!this.projectionStore || !this.callbacks) {
      return
    }

    this.clearReleaseSettling(true)
    this.draggedNodePubkey = pubkey
    this.dragNeighborhoodWeights = buildDragNeighborhoodWeights(
      this.projectionStore.getGraph(),
      pubkey,
      DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
    )
    this.dragInfluenceState = createDragNeighborhoodInfluenceState(
      this.projectionStore,
      pubkey,
      this.dragNeighborhoodWeights,
    )
    this.lastDragGraphPosition = this.projectionStore.getNodePosition(pubkey)
    this.lastDragFlushTimestamp = null
    this.dragReleaseVelocity = null
    this.cancelPendingDragFrame()
    this.projectionStore.setNodeFixed(pubkey, true)
    this.setGraphBoundsLocked(true)
    this.forceRuntime?.suspend()
    this.callbacks.onNodeDragStart(pubkey)
  }

  private readonly releaseDrag = () => {
    this.pendingDragGesture = null

    if (!this.draggedNodePubkey || !this.projectionStore || !this.callbacks) {
      this.setCameraLocked(false)
      this.setGraphBoundsLocked(false)
      this.cancelPendingDragFrame()
      this.dragNeighborhoodWeights = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      return
    }

    this.flushPendingDragFrame()

    const draggedNodePubkey = this.draggedNodePubkey
    const position = this.projectionStore.getNodePosition(draggedNodePubkey)
    if (this.scene?.pins.pubkeys.includes(draggedNodePubkey)) {
      releaseDraggedNode(
        this.projectionStore,
        draggedNodePubkey,
        this.scene.pins.pubkeys,
      )
      this.dragNeighborhoodWeights = new Map()
      this.dragInfluenceState = null
      this.lastDragGraphPosition = null
      this.dragReleaseVelocity = null
      this.forceRuntime?.resume()
      this.setCameraLocked(false)
      this.setGraphBoundsLocked(false)
      this.sigma?.refresh()
    } else {
      this.scheduleSettledNodeRelease(draggedNodePubkey)
    }
    this.draggedNodePubkey = null
    this.lastDragFlushTimestamp = null
    this.dragReleaseVelocity ??= { x: 0, y: 0 }
    this.suppressedClick = createSuppressedNodeClick(draggedNodePubkey)

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
      nodeReducer: this.nodeReducer,
      edgeReducer: this.edgeReducer,
    })

    const sigma = this.sigma
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
    const activeSettlingPubkey = this.settlingDraggedNodePubkey
    const activeInteractionPubkey = draggedNodePubkey ?? activeSettlingPubkey
    const draggedNodePosition =
      draggedNodePubkey !== null ? this.lastDragGraphPosition : null
    const settlingDraggedNodePosition =
      activeSettlingPubkey !== null
        ? this.projectionStore.getNodePosition(activeSettlingPubkey)
        : null
    this.scene = scene
    this.projectionStore.applyScene(scene)

    if (activeInteractionPubkey) {
      this.dragNeighborhoodWeights = buildDragNeighborhoodWeights(
        this.projectionStore.getGraph(),
        activeInteractionPubkey,
        DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
      )
      this.dragInfluenceState = createDragNeighborhoodInfluenceState(
        this.projectionStore,
        activeInteractionPubkey,
        this.dragNeighborhoodWeights,
        this.dragInfluenceState,
      )
    } else {
      this.dragNeighborhoodWeights = new Map()
      this.dragInfluenceState = null
    }

    if (draggedNodePubkey && draggedNodePosition) {
      this.projectionStore.setNodePosition(
        draggedNodePubkey,
        draggedNodePosition.x,
        draggedNodePosition.y,
        true,
      )
    }

    if (activeSettlingPubkey && settlingDraggedNodePosition) {
      this.projectionStore.setNodePosition(
        activeSettlingPubkey,
        settlingDraggedNodePosition.x,
        settlingDraggedNodePosition.y,
        true,
      )
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
    this.clearReleaseSettling(false)
    this.setCameraLocked(false)
    this.setGraphBoundsLocked(false)
    this.forceRuntime?.dispose()
    this.forceRuntime = null
    this.sigma?.kill()
    this.sigma = null
    this.projectionStore = null
    this.callbacks = null
    this.scene = null
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
  }

  private readonly nodeReducer = (
    node: string,
    data: SigmaNodeAttributes,
  ) => {
    if (node === this.hoveredNodePubkey) {
      return {
        ...data,
        forceLabel: true,
        highlighted: true,
        size: data.size * HOVER_LABEL_BOOST,
        zIndex: 5,
      }
    }

    if (this.hoveredNodePubkey && this.hoveredNeighbors.has(node)) {
      return {
        ...data,
        forceLabel: true,
        zIndex: Math.max(data.zIndex, 2),
      }
    }

    return data
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
      return data
    }

    return {
      ...data,
      color: HOVER_EDGE_BRIGHT_COLOR,
      size: Math.max(data.size + 0.4, 1.2),
      zIndex: 3,
    }
  }

  private readonly setHoveredNode = (pubkey: string | null) => {
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
