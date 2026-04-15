import type { AppStore } from '@/features/graph/app/store/types'
import {
  createCanonicalEdgeId,
  DEFAULT_GRAPH_V2_LAYER,
  isGraphV2Layer,
} from '@/features/graph-v2/domain/invariants'
import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'

const createCanonicalEdge = (
  edge: AppStore['links'][number],
  origin: CanonicalEdge['origin'],
): CanonicalEdge => ({
  id: createCanonicalEdgeId(edge.source, edge.target, edge.relation),
  source: edge.source,
  target: edge.target,
  relation: edge.relation,
  origin,
  weight: edge.weight ?? 1,
})

export const adaptLegacyStoreSnapshot = (
  state: AppStore,
): CanonicalGraphState => {
  const edgesById: Record<string, CanonicalEdge> = {}

  for (const edge of state.links) {
    const canonicalEdge = createCanonicalEdge(edge, 'graph')
    edgesById[canonicalEdge.id] = canonicalEdge
  }

  for (const edge of state.inboundLinks) {
    const canonicalEdge = createCanonicalEdge(edge, 'inbound')
    edgesById[canonicalEdge.id] = canonicalEdge
  }

  for (const edge of state.connectionsLinks) {
    const canonicalEdge = createCanonicalEdge(edge, 'connections')
    if (!edgesById[canonicalEdge.id]) {
      edgesById[canonicalEdge.id] = canonicalEdge
    }
  }

  const nodesByPubkey = Object.fromEntries(
    Object.values(state.nodes).map((node) => [
      node.pubkey,
      {
        pubkey: node.pubkey,
        label: node.label ?? null,
        picture: node.picture ?? null,
        about: node.about ?? null,
        nip05: node.nip05 ?? null,
        lud16: node.lud16 ?? null,
        source: node.source,
        discoveredAt: node.discoveredAt,
        keywordHits: node.keywordHits,
        profileEventId: node.profileEventId ?? null,
        profileFetchedAt: node.profileFetchedAt ?? null,
        profileSource: node.profileSource ?? null,
        profileState: node.profileState ?? 'idle',
        isExpanded: state.expandedNodePubkeys.has(node.pubkey),
        nodeExpansionState: state.nodeExpansionStates[node.pubkey] ?? null,
      },
    ]),
  )

  const relayEndpoints = Object.fromEntries(
    state.relayUrls.map((relayUrl) => [
      relayUrl,
      {
        url: relayUrl,
        status: state.relayHealth[relayUrl]?.status ?? 'unknown',
        lastCheckedAt: state.relayHealth[relayUrl]?.lastCheckedAt ?? null,
        lastNotice: state.relayHealth[relayUrl]?.lastNotice ?? null,
      },
    ]),
  )

  return {
    nodesByPubkey,
    edgesById,
    rootPubkey: state.rootNodePubkey,
    activeLayer: isGraphV2Layer(state.activeLayer)
      ? state.activeLayer
      : DEFAULT_GRAPH_V2_LAYER,
    connectionsSourceLayer: state.connectionsSourceLayer,
    selectedNodePubkey: state.selectedNodePubkey,
    pinnedNodePubkeys: new Set(state.pinnedNodePubkeys),
    relayState: {
      urls: [...state.relayUrls],
      endpoints: relayEndpoints,
      overrideStatus: state.relayOverrideStatus,
      isGraphStale: state.isGraphStale,
    },
    discoveryState: {
      rootLoad: state.rootLoad,
      expandedNodePubkeys: new Set(state.expandedNodePubkeys),
      graphRevision: state.graphRevision,
      inboundGraphRevision: state.inboundGraphRevision,
      connectionsLinksRevision: state.connectionsLinksRevision,
    },
  }
}

