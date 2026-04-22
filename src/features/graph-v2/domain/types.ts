import type {
  ConnectionsSourceLayer,
  GraphLinkRelation,
  GraphNodeSource,
  NodeExpansionState,
  ProfileDataSource,
  RelayHealthStatus,
  RelayOverrideStatus,
  RootLoadState,
} from '@/features/graph-runtime/app/store/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

export interface CanonicalNode {
  pubkey: string
  label: string | null
  picture: string | null
  about: string | null
  nip05: string | null
  lud16: string | null
  source: GraphNodeSource
  discoveredAt: number | null
  keywordHits: number
  profileEventId: string | null
  profileFetchedAt: number | null
  profileSource: ProfileDataSource | null
  profileState: 'idle' | 'loading' | 'ready' | 'missing'
  isExpanded: boolean
  nodeExpansionState: NodeExpansionState | null
}

export interface CanonicalEdge {
  id: string
  source: string
  target: string
  relation: GraphLinkRelation
  origin: 'graph' | 'inbound' | 'connections'
  weight: number
}

export interface CanonicalRelayEndpoint {
  url: string
  status: RelayHealthStatus
  lastCheckedAt: number | null
  lastNotice: string | null
}

export interface CanonicalRelayState {
  urls: string[]
  endpoints: Record<string, CanonicalRelayEndpoint>
  overrideStatus: RelayOverrideStatus
  isGraphStale: boolean
}

export interface CanonicalSceneDiscoveryState {
  expandedNodePubkeys: ReadonlySet<string>
  graphRevision: number
  inboundGraphRevision: number
  connectionsLinksRevision: number
}

export interface CanonicalGraphUiState {
  rootLoad: RootLoadState
  relayState: CanonicalRelayState
}

export interface CanonicalGraphSceneState {
  nodesByPubkey: Record<string, CanonicalNode>
  edgesById: Record<string, CanonicalEdge>
  sceneSignature: string
  topologySignature: string
  nodeVisualRevision: number
  nodeDetailRevision: number
  rootPubkey: string | null
  activeLayer: GraphV2Layer
  connectionsSourceLayer: ConnectionsSourceLayer
  selectedNodePubkey: string | null
  pinnedNodePubkeys: ReadonlySet<string>
  discoveryState: CanonicalSceneDiscoveryState
}

export interface CanonicalDiscoveryState extends CanonicalSceneDiscoveryState {
  rootLoad: RootLoadState
}

export interface CanonicalGraphState
  extends Omit<CanonicalGraphSceneState, 'discoveryState'>,
    CanonicalGraphUiState {
  discoveryState: CanonicalDiscoveryState
}
