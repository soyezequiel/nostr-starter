import type {
  DiscoveredGraphAnalysisConfidence,
  DiscoveredGraphAnalysisMode,
  DiscoveredGraphAnalysisState,
  DiscoveredGraphAnalysisStatus,
} from '@/features/graph/analysis/types'
import type {
  GraphLink,
  GraphLinkRelation,
  GraphNode,
  GraphNodeSource,
  RootLoadStatus,
  UiLayer,
  ZapLayerEdge,
  RenderConfig,
} from '@/features/graph/app/store/types'

export type GraphRenderStatus =
  | 'empty'
  | 'rendering'
  | 'interactive'
  | 'degraded'

export type GraphRenderDegradedReason =
  | 'cap-reached'
  | 'edge-thinning'
  | 'labels-suppressed'
  | 'worker-error'

export type GraphRenderModelPhase = 'idle' | 'building' | 'ready' | 'error'

export type GraphLabelPolicy = 'hover-selected-only' | 'hover-selected-or-zoom'

export interface GraphRenderNode {
  id: string
  pubkey: string
  displayLabel: string
  pictureUrl: string | null
  position: [number, number]
  radius: number
  isRoot: boolean
  isExpanded: boolean
  isSelected: boolean
  isCommonFollow: boolean
  source: GraphNodeSource
  discoveredAt: number | null
  sharedByExpandedCount: number
  fillColor?: [number, number, number, number]
  lineColor?: [number, number, number, number]
  bridgeHaloColor?: [number, number, number, number] | null
  analysisCommunityId?: string | null
  nearestNeighborWorldDist?: number
  isPathNode?: boolean
  isPathEndpoint?: boolean
  pathOrder?: number | null
}

export interface GraphRenderEdge {
  id: string
  source: string
  target: string
  relation: GraphLinkRelation
  weight: number
  sourcePosition: [number, number]
  targetPosition: [number, number]
  sourceRadius: number
  targetRadius: number
  isPriority: boolean
  targetSharedByExpandedCount: number
  isPathEdge?: boolean
}

export interface GraphRenderLabel {
  id: string
  pubkey: string
  text: string
  position: [number, number]
  radius: number
  isRoot: boolean
  isSelected: boolean
}

export interface AccessibleNodeSummary {
  id: string
  pubkey: string
  displayLabel: string
  isRoot: boolean
  source: GraphNodeSource
}

export interface GraphBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface GraphRenderLodSummary {
  labelPolicy: GraphLabelPolicy
  labelsSuppressedByBudget: boolean
  edgesThinned: boolean
  thinnedEdgeCount: number
  candidateEdgeCount: number
  visibleEdgeCount: number
  visibleNodeCount: number
  degradedReasons: GraphRenderDegradedReason[]
}

export interface GraphRenderAnalysisLegendItem {
  id: string
  label: string
  nodeCount: number
  color: [number, number, number, number]
  isNeutral: boolean
}

export interface GraphRenderAnalysisOverlay {
  status: DiscoveredGraphAnalysisStatus
  isStale: boolean
  mode: DiscoveredGraphAnalysisMode | null
  confidence: DiscoveredGraphAnalysisConfidence | null
  badgeLabel: string | null
  summary: string | null
  detail: string | null
  legendItems: GraphRenderAnalysisLegendItem[]
}

export interface GraphRenderModel {
  nodes: GraphRenderNode[]
  edges: GraphRenderEdge[]
  labels: GraphRenderLabel[]
  accessibleNodes: AccessibleNodeSummary[]
  bounds: GraphBounds
  topologySignature: string
  layoutKey: string
  lod: GraphRenderLodSummary
  analysisOverlay: GraphRenderAnalysisOverlay
  activeLayer: UiLayer
  renderConfig: RenderConfig
}

export interface BuildGraphRenderModelInput {
  nodes: Record<string, GraphNode>
  links: readonly GraphLink[]
  inboundLinks: readonly GraphLink[]
  zapEdges: readonly ZapLayerEdge[]
  activeLayer: UiLayer
  rootNodePubkey: string | null
  selectedNodePubkey: string | null
  expandedNodePubkeys: ReadonlySet<string>
  comparedNodePubkeys?: ReadonlySet<string>
  pathfinding?: {
    status: 'idle' | 'computing' | 'found' | 'not-found' | 'error'
    path: string[] | null
  }
  graphAnalysis?: DiscoveredGraphAnalysisState
  renderConfig: RenderConfig
  previousPositions?: ReadonlyMap<string, [number, number]>
  previousLayoutKey?: string
}

export interface GraphRenderState {
  status: GraphRenderStatus
  reasons: GraphRenderDegradedReason[]
}

export interface DeriveGraphRenderStateInput {
  model: GraphRenderModel
  hasViewport: boolean
  rootLoadStatus: RootLoadStatus
  capReached: boolean
  modelPhase: GraphRenderModelPhase
}
