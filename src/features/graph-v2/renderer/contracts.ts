import type { CanonicalNode } from '@/features/graph-v2/domain/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

export interface GraphSceneNode {
  pubkey: string
  label: string
  pictureUrl: string | null
  color: string
  size: number
  isRoot: boolean
  isSelected: boolean
  isPinned: boolean
}

export interface GraphSceneEdge {
  id: string
  source: string
  target: string
  color: string
  size: number
  hidden: boolean
  relation: string
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

export interface GraphSceneDiagnostics {
  activeLayer: GraphV2Layer
  nodeCount: number
  visibleEdgeCount: number
  forceEdgeCount: number
  relayCount: number
  isGraphStale: boolean
  topologySignature: string
}

export interface GraphSceneSnapshot {
  nodes: GraphSceneNode[]
  visibleEdges: GraphSceneEdge[]
  forceEdges: GraphSceneEdge[]
  labels: GraphSceneLabel[]
  selection: GraphSceneSelection
  pins: GraphScenePins
  cameraHint: GraphSceneCameraHint
  diagnostics: GraphSceneDiagnostics
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
  onNodeHover: (pubkey: string | null) => void
  onNodeDragStart: (pubkey: string) => void
  onNodeDragMove: (pubkey: string, position: { x: number; y: number }) => void
  onNodeDragEnd: (pubkey: string, position: { x: number; y: number }) => void
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

