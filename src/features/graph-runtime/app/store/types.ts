import type { StateCreator, StoreApi } from 'zustand'
import type {
  DiscoveredGraphAnalysisResult,
  DiscoveredGraphAnalysisState,
  DiscoveredGraphAnalysisStatus,
} from '@/features/graph-runtime/analysis/types'
import type {
  RootIdentityEvidence,
  RootIdentitySource,
} from '@/features/graph-runtime/kernel/rootIdentity'
import type {
  GraphEventFeedMode,
  GraphEventKind,
  GraphEventToggleState,
} from '@/features/graph-v2/events/types'

export type GraphNodeSource = 'root' | 'follow' | 'inbound' | 'zap' | 'keyword'
export type ProfileDataSource = 'relay' | 'primal-cache'
export type GraphLinkRelation = 'follow' | 'inbound' | 'zap'
export type ZapLayerStatus =
  | 'disabled'
  | 'loading'
  | 'enabled'
  | 'unavailable'
export type KeywordLayerStatus =
  | 'disabled'
  | 'loading'
  | 'enabled'
  | 'unavailable'
export type RelayHealthStatus =
  | 'unknown'
  | 'connected'
  | 'partial'
  | 'degraded'
  | 'offline'
export type RelayOverrideStatus =
  | 'idle'
  | 'editing'
  | 'validating'
  | 'applying'
  | 'applied'
  | 'revertible'
  | 'invalid'
export type UiLayer =
  | 'graph'
  | 'connections'
  | 'following'
  | 'following-non-followers'
  | 'mutuals'
  | 'followers'
  | 'nonreciprocal-followers'
  | 'zaps'
  | 'pathfinding'
export type ConnectionsSourceLayer = Exclude<UiLayer, 'connections'>
export type UiPanel =
  | 'none'
  | 'overview'
  | 'node-detail'
  | 'relay-config'
  | 'render-config'
  | 'pathfinding'
  | 'export'
export type RootLoadStatus =
  | 'idle'
  | 'loading'
  | 'partial'
  | 'ready'
  | 'empty'
  | 'error'
export type ExportJobStatus =
  | 'idle'
  | 'freezing-snapshot'
  | 'running-authored'
  | 'running-inbound'
  | 'packaging'
  | 'partial'
  | 'completed'
  | 'failed'
export type PathfindingStatus =
  | 'idle'
  | 'computing'
  | 'found'
  | 'not-found'
  | 'error'
export type PathfindingSelectionMode = 'idle' | 'source' | 'target'
export type DevicePerformanceProfile =
  | 'desktop'
  | 'mobile'
  | 'low-end-mobile'

export interface GraphNode {
  pubkey: string
  label?: string
  picture?: string | null
  about?: string | null
  nip05?: string | null
  lud16?: string | null
  profileEventId?: string | null
  profileFetchedAt?: number | null
  profileSource?: ProfileDataSource | null
  profileState?: 'idle' | 'loading' | 'ready' | 'missing'
  keywordHits: number
  discoveredAt: number | null
  source: GraphNodeSource
}

export interface GraphNodeProfile {
  eventId: string
  fetchedAt: number
  profileSource?: ProfileDataSource | null
  name: string | null
  about: string | null
  picture: string | null
  nip05: string | null
  lud16: string | null
}

export interface GraphLink {
  source: string
  target: string
  relation: GraphLinkRelation
  weight?: number
}

export interface ZapLayerEdge {
  source: string
  target: string
  relation: 'zap'
  weight: number
  receiptCount: number
}

export interface ZapLayerState {
  status: ZapLayerStatus
  edges: ZapLayerEdge[]
  revision: number
  skippedReceipts: number
  loadedFrom: 'none' | 'cache' | 'live'
  targetPubkeys: string[]
  message: string | null
  lastUpdatedAt: number | null
}

export interface KeywordMatch {
  noteId: string
  excerpt: string
  matchedTokens: string[]
  score: number
}

export interface KeywordLayerState {
  status: KeywordLayerStatus
  loadedFrom: 'none' | 'cache' | 'live'
  isPartial: boolean
  message: string | null
  corpusNodeCount: number
  extractCount: number
  matchCount: number
  matchNodeCount: number
  matchesByPubkey: Record<string, KeywordMatch[]>
  lastUpdatedAt: number | null
}

export interface GraphCaps {
  maxNodes: number
  capReached: boolean
}

export interface EffectiveGraphCaps {
  maxNodes: number
  coldStartLayoutTicks: number
  warmStartLayoutTicks: number
}

export interface EffectiveImageBudget {
  vramBytes: number
  decodedBytes: number
  compressedBytes: number
  baseFetchConcurrency: number
  boostedFetchConcurrency: number
  allowHdTiers: boolean
  allowParallelDirectFallback: boolean
}

export type NodeExpansionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'partial'
  | 'empty'
  | 'error'

export type NodeExpansionPhase =
  | 'idle'
  | 'preparing'
  | 'fetching-structure'
  | 'correlating-followers'
  | 'merging'
  | 'enriching'

export interface NodeExpansionState {
  status: NodeExpansionStatus
  message: string | null
  phase: NodeExpansionPhase
  step: number | null
  totalSteps: number | null
  startedAt: number | null
  updatedAt: number | null
}

export interface NodeStructurePreviewState {
  status: NodeExpansionStatus
  message: string | null
  discoveredFollowCount: number | null
}

export interface RelayHealth {
  status: RelayHealthStatus
  lastCheckedAt: number | null
  lastNotice: string | null
}

export interface ExportJobProgress {
  phase: ExportJobStatus
  percent: number
  currentPubkey: string | null
  errorMessage: string | null
}

export type RootCollectionProgressStatus =
  | 'idle'
  | 'loading'
  | 'partial'
  | 'complete'

export interface RootCollectionProgress {
  status: RootCollectionProgressStatus
  loadedCount: number
  totalCount: number | null
  isTotalKnown: boolean
}

export interface RootInboundDiscoveryRelayMetrics {
  discoveredRelayCount: number
  usedRelayCount: number
  droppedByCapCount: number
  contributingRelayCount: number
}

export interface RootVisibleLinkProgress {
  visibleLinkCount: number | null
  contactListEventCount: number
  inboundCandidateEventCount: number
  lastRelayUrl: string | null
  updatedAt: number | null
  following: RootCollectionProgress
  followers: RootCollectionProgress
  inboundDiscovery?: RootInboundDiscoveryRelayMetrics | null
}

export interface RootLoadState {
  status: RootLoadStatus
  message: string | null
  loadedFrom: 'none' | 'cache' | 'live'
  visibleLinkProgress: RootVisibleLinkProgress | null
}

export interface UpsertGraphNodesResult {
  acceptedPubkeys: string[]
  rejectedPubkeys: string[]
}

export interface ReplaceGraphSnapshotInput {
  rootNodePubkey: string
  nodes: GraphNode[]
  links: GraphLink[]
  inboundLinks: GraphLink[]
}

export type GraphNodePatch = { pubkey: string } & Partial<GraphNode>

export interface ToggleDeepUserSelectionResult {
  selectedDeepUserPubkeys: string[]
  slotsRemaining: number
  reason: 'job-active' | 'max-selected' | 'root-required' | null
}

export interface GraphSlice {
  nodes: Record<string, GraphNode>
  links: GraphLink[]
  adjacency: Record<string, string[]>
  inboundLinks: GraphLink[]
  inboundAdjacency: Record<string, string[]>
  /** Derived cross-edges used exclusively by the connections layer. Computed from
   *  locally-cached contact lists when the connections layer is activated. */
  connectionsLinks: GraphLink[]
  connectionsLinksRevision: number
  graphRevision: number
  inboundGraphRevision: number
  nodeVisualRevision: number
  nodeDetailRevision: number
  rootNodePubkey: string | null
  graphCaps: GraphCaps
  expandedNodePubkeys: Set<string>
  nodeExpansionStates: Record<string, NodeExpansionState>
  nodeStructurePreviewStates: Record<string, NodeStructurePreviewState>
  setRootNodePubkey: (pubkey: string | null) => void
  upsertNodes: (nodes: GraphNode[]) => UpsertGraphNodesResult
  upsertNodePatches: (patches: GraphNodePatch[]) => UpsertGraphNodesResult
  replaceGraphSnapshot: (
    snapshot: ReplaceGraphSnapshotInput,
  ) => UpsertGraphNodesResult
  removeNodes: (pubkeys: readonly string[]) => void
  upsertLinks: (links: GraphLink[]) => void
  upsertInboundLinks: (links: GraphLink[]) => void
  setConnectionsLinks: (links: GraphLink[]) => void
  markNodeExpanded: (pubkey: string) => void
  setNodeExpansionState: (pubkey: string, state: NodeExpansionState) => void
  setNodeStructurePreviewState: (
    pubkey: string,
    state: NodeStructurePreviewState,
  ) => void
  setGraphMaxNodes: (maxNodes: number) => void
  resetGraph: () => void
}

export interface ZapSlice {
  zapLayer: ZapLayerState
  setZapLayerState: (state: Partial<ZapLayerState>) => void
  replaceZapLayerEdges: (edges: ZapLayerEdge[]) => void
  resetZapLayer: () => void
}

export interface EventToggleSlice {
  eventToggles: GraphEventToggleState
  eventFeedMode: GraphEventFeedMode
  pauseLiveEventsWhenSceneIsLarge: boolean
  setEventToggle: (kind: GraphEventKind, enabled: boolean) => void
  setEventToggles: (toggles: Partial<GraphEventToggleState>) => void
  setEventFeedMode: (mode: GraphEventFeedMode) => void
  setPauseLiveEventsWhenSceneIsLarge: (paused: boolean) => void
}

export interface KeywordSlice {
  keywordLayer: KeywordLayerState
  setKeywordLayerState: (state: Partial<KeywordLayerState>) => void
  setKeywordMatches: (matchesByPubkey: Record<string, KeywordMatch[]>) => void
  resetKeywordLayer: () => void
}

export interface RelaySlice {
  relayUrls: string[]
  relayHealth: Record<string, RelayHealth>
  relayOverrideStatus: RelayOverrideStatus
  isGraphStale: boolean
  setRelayUrls: (relayUrls: string[]) => void
  resetRelayHealth: (relayUrls?: string[]) => void
  setRelayOverrideStatus: (status: RelayOverrideStatus) => void
  updateRelayHealth: (relayUrl: string, health: Partial<RelayHealth>) => void
  updateRelayHealthBatch: (
    relayHealth: Record<string, Partial<RelayHealth>>,
  ) => void
  markGraphStale: (isStale: boolean) => void
}

export type ArrowType = 'none' | 'arrow' | 'triangle'
export type ImageQualityMode =
  | 'performance'
  | 'adaptive'
  | 'quality'
  | 'full-hd'

export interface RenderConfig {
  edgeThickness: number
  edgeOpacity: number
  arrowType: ArrowType
  nodeSpacingFactor: number
  nodeSizeFactor: number
  autoSizeNodes: boolean
  imageQualityMode: ImageQualityMode
  physicsEnabled: boolean
  physicsAutoFreeze: boolean
  avatarHdZoomThreshold?: number
  avatarFullHdZoomThreshold?: number
  showDiscoveryState?: boolean
  showSharedEmphasis: boolean
  showAvatarQualityGuide?: boolean
  showImageResidencyDebug?: boolean
  mobileDegradedMode?: boolean
  edgeColor?: string
  mutualEdgeColor?: string
  colorProfile?: string
}

export interface PathfindingState {
  sourceQuery: string
  targetQuery: string
  sourcePubkey: string | null
  targetPubkey: string | null
  selectionMode: PathfindingSelectionMode
  status: PathfindingStatus
  path: string[] | null
  visitedCount: number
  algorithm: 'bfs' | 'dijkstra'
  message: string | null
  previousLayer: UiLayer | null
}

export interface SavedRootProfileSnapshot {
  displayName: string | null
  name: string | null
  picture: string | null
  about: string | null
  nip05: string | null
  lud16: string | null
}

export interface SavedRootEntry {
  pubkey: string
  npub: string
  addedAt: number
  lastOpenedAt: number
  relayHints?: string[]
  source?: RootIdentitySource
  evidence?: RootIdentityEvidence
  profile: SavedRootProfileSnapshot | null
  profileFetchedAt: number | null
}

export interface ViewportInteractionState {
  isViewportActive: boolean
  lastViewportInteractionAt: number | null
  lastViewportSettledAt: number | null
}

export interface UiSlice {
  selectedNodePubkey: string | null
  comparedNodePubkeys: ReadonlySet<string>
  activeLayer: UiLayer
  connectionsSourceLayer: ConnectionsSourceLayer
  openPanel: UiPanel
  currentKeyword: string
  rootLoad: RootLoadState
  renderConfig: RenderConfig
  devicePerformanceProfile: DevicePerformanceProfile
  effectiveGraphCaps: EffectiveGraphCaps
  effectiveImageBudget: EffectiveImageBudget
  savedRoots: SavedRootEntry[]
  savedRootsHydrated: boolean
  interactionState: ViewportInteractionState
  fixedRootPubkey: string | null
  pinnedNodePubkeys: ReadonlySet<string>
  physicsReheatRevision: number
  setSelectedNodePubkey: (pubkey: string | null) => void
  setComparedNodePubkeys: (pubkeys: ReadonlySet<string>) => void
  clearComparedNodes: () => void
  setActiveLayer: (layer: UiLayer) => void
  setConnectionsSourceLayer: (layer: ConnectionsSourceLayer) => void
  setOpenPanel: (panel: UiPanel) => void
  setCurrentKeyword: (keyword: string) => void
  setRootLoadState: (state: Partial<RootLoadState>) => void
  resetRootLoadState: () => void
  setRenderConfig: (config: Partial<RenderConfig>) => void
  applyDevicePerformanceProfile: (input: {
    profile: DevicePerformanceProfile
    graphCaps: EffectiveGraphCaps
    imageBudget: EffectiveImageBudget
    defaultImageQualityMode: ImageQualityMode
  }) => void
  markViewportInteraction: (at?: number) => void
  markViewportSettled: (at?: number) => void
  upsertSavedRoot: (entry: {
    pubkey: string
    npub: string
    openedAt?: number
    relayHints?: string[]
    source?: RootIdentitySource
    evidence?: RootIdentityEvidence
    profile?: SavedRootProfileSnapshot | null
    profileFetchedAt?: number | null
  }) => void
  removeSavedRoot: (pubkey: string) => void
  setSavedRootProfile: (
    pubkey: string,
    profile: SavedRootProfileSnapshot | null,
    fetchedAt: number | null,
  ) => void
  setSavedRootsHydrated: (hydrated: boolean) => void
  setFixedRootPubkey: (pubkey: string | null) => void
  pinNode: (pubkey: string) => void
  unpinNode: (pubkey: string) => void
  togglePinnedNode: (pubkey: string) => void
  clearPinnedNodes: () => void
  prunePinnedNodePubkeys: (availablePubkeys: ReadonlySet<string>) => void
  requestPhysicsReheat: () => void
}

export interface ExportSlice {
  selectedDeepUserPubkeys: string[]
  maxSelectedDeepUsers: number
  exportJob: ExportJobProgress
  toggleDeepUserSelection: (
    pubkey: string,
    selected: boolean,
  ) => ToggleDeepUserSelectionResult
  setExportJobProgress: (progress: Partial<ExportJobProgress>) => void
  resetExportJob: () => void
  resetExportState: () => void
}

export interface AnalysisSlice {
  graphAnalysis: DiscoveredGraphAnalysisState
  setGraphAnalysisLoading: (analysisKey: string, message: string | null) => void
  setGraphAnalysisResult: (
    result: DiscoveredGraphAnalysisResult,
    status: Extract<DiscoveredGraphAnalysisStatus, 'ready' | 'partial'>,
    message: string | null,
  ) => void
  setGraphAnalysisError: (
    analysisKey: string | null,
    message: string | null,
  ) => void
  resetGraphAnalysis: () => void
}

export interface PathfindingSlice {
  pathfinding: PathfindingState
  setPathfindingInput: (
    role: 'source' | 'target',
    query: string,
  ) => void
  setPathfindingEndpoint: (
    role: 'source' | 'target',
    endpoint: {
      pubkey: string | null
      query?: string | null
    },
  ) => void
  setPathfindingSelectionMode: (mode: PathfindingSelectionMode) => void
  setPathfindingPending: (algorithm?: 'bfs' | 'dijkstra') => void
  setPathfindingResult: (result: {
    path: string[] | null
    visitedCount: number
    algorithm: 'bfs' | 'dijkstra'
    message: string | null
    previousLayer?: UiLayer | null
  }) => void
  setPathfindingError: (
    message: string,
    options?: {
      algorithm?: 'bfs' | 'dijkstra'
      previousLayer?: UiLayer | null
    },
  ) => void
  clearPathfindingResult: () => void
  resetPathfinding: () => void
}

export type AppStore = GraphSlice &
  ZapSlice &
  EventToggleSlice &
  KeywordSlice &
  RelaySlice &
  UiSlice &
  ExportSlice &
  AnalysisSlice &
  PathfindingSlice
export type AppStoreApi = StoreApi<AppStore>
export type AppStateCreator<T> = StateCreator<AppStore, [], [], T>
