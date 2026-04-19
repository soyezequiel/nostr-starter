import type { CanonicalNode } from '@/features/graph-v2/domain/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

export type GraphSceneFocusState =
  | 'idle'
  | 'selected'
  | 'neighbor'
  | 'root'
  | 'pinned'
  | 'dim'

export interface GraphRenderNode {
  pubkey: string
  label: string
  pictureUrl: string | null
  color: string
  size: number
  isRoot: boolean
  isSelected: boolean
  isPinned: boolean
  isNeighbor: boolean
  isDimmed: boolean
  focusState: GraphSceneFocusState
}

export interface GraphRenderEdge {
  id: string
  source: string
  target: string
  color: string
  size: number
  hidden: boolean
  relation: string
  weight: number
  isDimmed: boolean
  touchesFocus: boolean
}

export interface GraphPhysicsNode {
  pubkey: string
  size: number
  fixed: boolean
}

export interface GraphPhysicsEdge {
  id: string
  source: string
  target: string
  weight: number
}

export interface GraphSceneLabel {
  pubkey: string
  text: string
}

export interface GraphSceneSelection {
  selectedNodePubkey: string | null
  hoveredNodePubkey: string | null
}

export interface GraphScenePins {
  pubkeys: readonly string[]
}

export interface GraphViewportState {
  x: number
  y: number
  angle: number
  ratio: number
}

export interface GraphSceneCameraHint {
  focusPubkey: string | null
  rootPubkey: string | null
}

export interface GraphRenderDiagnostics {
  activeLayer: GraphV2Layer
  nodeCount: number
  visibleEdgeCount: number
  relayCount: number
  isGraphStale: boolean
  topologySignature: string
}

export interface GraphPhysicsDiagnostics {
  nodeCount: number
  edgeCount: number
  topologySignature: string
}

export interface GraphRenderSnapshot {
  nodes: GraphRenderNode[]
  visibleEdges: GraphRenderEdge[]
  labels: GraphSceneLabel[]
  selection: GraphSceneSelection
  pins: GraphScenePins
  cameraHint: GraphSceneCameraHint
  diagnostics: GraphRenderDiagnostics
}

export interface GraphPhysicsSnapshot {
  nodes: GraphPhysicsNode[]
  edges: GraphPhysicsEdge[]
  diagnostics: GraphPhysicsDiagnostics
}

export interface GraphSceneSnapshot {
  render: GraphRenderSnapshot
  physics: GraphPhysicsSnapshot
}

export interface NodeDetailProjection {
  node: CanonicalNode | null
  pubkey: string | null
  displayName: string | null
  about: string | null
  pictureUrl: string | null
  nip05: string | null
  lud16: string | null
  followingCount: number
  followerCount: number
  mutualCount: number
  isPinned: boolean
  isExpanded: boolean
}

export interface GraphInteractionCallbacks {
  onNodeClick: (pubkey: string) => void
  onClearSelection: () => void
  onNodeHover: (pubkey: string | null) => void
  onNodeDragStart: (pubkey: string) => void
  onNodeDragMove: (pubkey: string, position: { x: number; y: number }) => void
  onNodeDragEnd: (
    pubkey: string,
    position: { x: number; y: number },
    options?: { pinNode?: boolean },
  ) => void
  onViewportChange: (viewport: GraphViewportState) => void
}

export interface RendererAdapter {
  mount: (
    container: HTMLElement,
    initialScene: GraphSceneSnapshot,
    callbacks: GraphInteractionCallbacks,
  ) => void
  update: (scene: GraphSceneSnapshot) => void
  dispose: () => void
}
