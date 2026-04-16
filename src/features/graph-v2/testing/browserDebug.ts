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
  outside: string[]
}

export interface DebugDragCandidate {
  pubkey: string
  degree: number
}

export interface DebugSelectionState {
  selectedNodePubkey: string | null
  pinnedNodePubkeys: string[]
}

export interface DebugDragRuntimeState {
  draggedNodePubkey: string | null
  settlingDraggedNodePubkey: string | null
  pendingDragGesturePubkey: string | null
  settlingSpeed: number | null
  forceAtlasRunning: boolean
  forceAtlasSuspended: boolean
  moveBodyCount: number
  flushCount: number
  lastMoveBodyPointer: DebugNodePosition | null
  lastScheduledGraphPosition: DebugNodePosition | null
  lastFlushedGraphPosition: DebugNodePosition | null
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
}

declare global {
  interface Window {
    __sigmaLabDebug?: SigmaLabDebugApi
  }
}
