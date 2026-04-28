export interface DragCandidateQuery {
  minDegree?: number
  maxDegree?: number
}

export interface DebugNodePosition {
  x: number
  y: number
}

export interface DebugViewportPosition extends DebugNodePosition {
  clientX: number
  clientY: number
}

export interface DebugNeighborGroups {
  sourcePubkey: string
  depth0: string[]
  depth1: string[]
  depth2: string[]
  depth3: string[]
  outside: string[]
}

export interface DebugDragCandidate {
  pubkey: string
  degree: number
}

export interface DebugInfluenceHopSample {
  pubkey: string
  hopDistance: number
}

export interface DebugSelectionState {
  selectedNodePubkey: string | null
  pinnedNodePubkeys: string[]
}

export interface DebugDragRuntimeState {
  draggedNodePubkey: string | null
  pendingDragGesturePubkey: string | null
  lastReleasedNodePubkey: string | null
  lastReleasedGraphPosition: DebugNodePosition | null
  lastReleasedAtMs: number | null
  manualDragFixedNodeCount: number
  forceAtlasRunning: boolean
  forceAtlasSuspended: boolean
  moveBodyCount: number
  flushCount: number
  lastMoveBodyPointer: DebugNodePosition | null
  lastScheduledGraphPosition: DebugNodePosition | null
  lastFlushedGraphPosition: DebugNodePosition | null
  influencedNodeCount: number
  maxHopDistance: number | null
  influenceHopSample: DebugInfluenceHopSample[]
}

export interface DebugProjectionDiagnostics {
  graphBoundsLocked: boolean
  cameraLocked: boolean
  dimensions: {
    width: number
    height: number
  } | null
  camera: {
    x: number
    y: number
    ratio: number
    angle?: number
  } | null
  bbox: {
    x: [number, number]
    y: [number, number]
  } | null
  customBBox: {
    x: [number, number]
    y: [number, number]
  } | null
  customBBoxKnown: boolean
}

export interface DebugRenderPhysicsPosition {
  render: DebugNodePosition | null
  physics: DebugNodePosition | null
  renderFixed: boolean | null
  physicsFixed: boolean | null
}

export interface DebugRenderInvalidationState {
  pendingContainerRefresh: boolean
  pendingContainerRefreshFrame: boolean
  pendingDragFrame: boolean
  pendingPhysicsBridgeFrame: boolean
  pendingFitCameraAfterPhysicsFrame: boolean
  pendingGraphBoundsUnlockFrame: boolean
  graphBoundsUnlockStartedAtMs: number | null
  graphBoundsUnlockDeferredCount: number
  graphBoundsLocked: boolean
  cameraLocked: boolean
  forceAtlasRunning: boolean
  forceAtlasSuspended: boolean
  lastInvalidation: {
    action: 'render' | 'refresh' | 'container-refresh' | null
    atMs: number | null
  }
}

export type DebugDragTimelineStage =
  | 'down'
  | 'promote'
  | 'flush'
  | 'release'
  | 'unlock-start'
  | 'unlock-defer'
  | 'unlock-done'
  | 'manual-lock-clear'
  | 'physics-resume'
  | 'physics-bridge'

export interface DebugDragTimelineEvent {
  stage: DebugDragTimelineStage
  timestampMs: number
  pubkey: string | null
  pointerViewport: DebugNodePosition | null
  pointerGraph: DebugNodePosition | null
  nodeRenderPosition: DebugNodePosition | null
  nodePhysicsPosition: DebugNodePosition | null
  nodeViewportPosition: DebugNodePosition | null
  camera: DebugProjectionDiagnostics['camera']
  bbox: DebugProjectionDiagnostics['bbox']
  customBBox: DebugProjectionDiagnostics['customBBox']
  graphBoundsLocked: boolean
  pendingGraphBoundsUnlockFrame: boolean
  graphBoundsUnlockDeferredCount: number
  manualDragFixedNodeCount: number
  renderFixed: boolean | null
  physicsFixed: boolean | null
  forceAtlasRunning: boolean
  forceAtlasSuspended: boolean
  details?: Record<string, unknown>
}

export interface DebugPhysicsDiagnostics {
  presetVersion: string
  graphOrder: number
  graphSize: number
  maxDegree: number
  hubRatio: number
  settingsKey: string | null
  layoutEligible: boolean
  running: boolean
  suspended: boolean
  autoFreezeEnabled: boolean
  denseFactor: number
  tuning: {
    centripetalForce: number
    repulsionForce: number
    linkForce: number
    linkDistance: number
    damping: number
  }
  settings: {
    adjustSizes?: boolean
    edgeWeightInfluence?: number
    scalingRatio?: number
    strongGravityMode?: boolean
    gravity?: number
    slowDown?: number
    barnesHutOptimize?: boolean
    barnesHutTheta?: number
  }
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    width: number
    height: number
  } | null
  averageEdgeLength: number | null
  sampledNodeCount: number
  approximateOverlapCount: number
}

export interface SigmaLabDebugApi {
  getNodePosition: (pubkey: string) => DebugNodePosition | null
  getViewportPosition: (pubkey: string) => DebugViewportPosition | null
  getNeighborGroups: (pubkey: string) => DebugNeighborGroups | null
  findDragCandidate: (
    query?: DragCandidateQuery,
  ) => DebugDragCandidate | null
  isNodeFixed: (pubkey: string) => boolean
  getSelectionState: () => DebugSelectionState
  getDragRuntimeState: () => DebugDragRuntimeState
  getProjectionDiagnostics: () => DebugProjectionDiagnostics
  getRenderPhysicsPosition: (pubkey: string) => DebugRenderPhysicsPosition
  getRenderInvalidationState: () => DebugRenderInvalidationState
  getDragTimeline: () => DebugDragTimelineEvent[]
  getPhysicsDiagnostics: () => DebugPhysicsDiagnostics | null
}

declare global {
  interface Window {
    __sigmaLabDebug?: SigmaLabDebugApi
  }
}
