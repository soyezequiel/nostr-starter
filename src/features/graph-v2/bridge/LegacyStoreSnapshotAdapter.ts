import type { AppStore } from '@/features/graph/app/store/types'
import {
  createCanonicalEdgeId,
  DEFAULT_GRAPH_V2_LAYER,
  isGraphV2Layer,
} from '@/features/graph-v2/domain/invariants'
import type {
  CanonicalEdge,
  CanonicalGraphState,
  CanonicalNode,
  CanonicalRelayEndpoint,
  CanonicalRelayState,
} from '@/features/graph-v2/domain/types'

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

const createCanonicalNode = (
  state: AppStore,
  node: AppStore['nodes'][string],
): CanonicalNode => ({
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
})

const createCanonicalRelayEndpoint = (
  state: AppStore,
  relayUrl: string,
): CanonicalRelayEndpoint => ({
  url: relayUrl,
  status: state.relayHealth[relayUrl]?.status ?? 'unknown',
  lastCheckedAt: state.relayHealth[relayUrl]?.lastCheckedAt ?? null,
  lastNotice: state.relayHealth[relayUrl]?.lastNotice ?? null,
})

const createSceneNodeVisualSignature = (nodes: AppStore['nodes']) =>
  Object.values(nodes)
    .map((node) =>
      JSON.stringify([
        node.pubkey,
        node.label ?? '',
        node.picture ?? '',
        node.source,
        node.discoveredAt ?? '',
      ]),
    )
    .sort()
    .join('|')

const createSceneSignature = (
  state: AppStore,
  activeLayer: CanonicalGraphState['activeLayer'],
  nodeVisualSignature: string,
  pinnedNodePubkeysSignature: string,
  expandedNodePubkeysSignature: string,
) =>
  [
    state.rootNodePubkey ?? 'no-root',
    activeLayer,
    state.connectionsSourceLayer,
    state.selectedNodePubkey ?? 'no-selection',
    nodeVisualSignature,
    expandedNodePubkeysSignature,
    Object.keys(state.nodes).length,
    state.links.length + state.inboundLinks.length + state.connectionsLinks.length,
    state.graphRevision,
    state.inboundGraphRevision,
    state.connectionsLinksRevision,
    state.relayUrls.join(','),
    state.isGraphStale ? 'stale' : 'fresh',
    pinnedNodePubkeysSignature,
  ].join('|')

export class LegacyStoreSnapshotAdapter {
  private previousLinks: AppStore['links'] | null = null

  private previousInboundLinks: AppStore['inboundLinks'] | null = null

  private previousConnectionsLinks: AppStore['connectionsLinks'] | null = null

  private previousEdgesById: Record<string, CanonicalEdge> = {}

  private previousNodes: AppStore['nodes'] | null = null

  private previousExpandedNodePubkeys: AppStore['expandedNodePubkeys'] | null = null

  private previousNodeExpansionStates: AppStore['nodeExpansionStates'] | null = null

  private previousNodesByPubkey: Record<string, CanonicalNode> = {}

  private previousRelayUrls: AppStore['relayUrls'] | null = null

  private previousRelayHealth: AppStore['relayHealth'] | null = null

  private previousRelayOverrideStatus: AppStore['relayOverrideStatus'] | null = null

  private previousGraphStale: boolean | null = null

  private previousRelayState: CanonicalRelayState | null = null

  private previousRootLoad: AppStore['rootLoad'] | null = null

  private previousDiscoveryExpandedNodePubkeys: AppStore['expandedNodePubkeys'] | null = null

  private previousGraphRevision: number | null = null

  private previousInboundGraphRevision: number | null = null

  private previousConnectionsLinksRevision: number | null = null

  private previousDiscoveryState: CanonicalGraphState['discoveryState'] | null = null

  private previousPinnedNodePubkeys: AppStore['pinnedNodePubkeys'] | null = null

  private previousCanonicalPinnedNodePubkeys: ReadonlySet<string> = new Set<string>()

  private previousSceneSignatureNodes: AppStore['nodes'] | null = null

  private previousSceneNodeVisualSignature = ''

  private previousSceneSignaturePinnedNodePubkeys:
    | AppStore['pinnedNodePubkeys']
    | null = null

  private previousScenePinnedNodePubkeysSignature = ''

  private previousSceneSignatureExpandedNodePubkeys:
    | AppStore['expandedNodePubkeys']
    | null = null

  private previousSceneExpandedNodePubkeysSignature = ''

  private previousSnapshot: CanonicalGraphState | null = null

  public adapt(state: AppStore): CanonicalGraphState {
    const edgesById = this.adaptEdges(state)
    const nodesByPubkey = this.adaptNodes(state)
    const relayState = this.adaptRelayState(state)
    const discoveryState = this.adaptDiscoveryState(state)
    const pinnedNodePubkeys = this.adaptPinnedNodePubkeys(state)
    const activeLayer = isGraphV2Layer(state.activeLayer)
      ? state.activeLayer
      : DEFAULT_GRAPH_V2_LAYER
    const sceneSignature = createSceneSignature(
      state,
      activeLayer,
      this.getSceneNodeVisualSignature(state.nodes),
      this.getScenePinnedNodePubkeysSignature(state.pinnedNodePubkeys),
      this.getSceneExpandedNodePubkeysSignature(state.expandedNodePubkeys),
    )

    if (
      this.previousSnapshot &&
      this.previousSnapshot.edgesById === edgesById &&
      this.previousSnapshot.nodesByPubkey === nodesByPubkey &&
      this.previousSnapshot.sceneSignature === sceneSignature &&
      this.previousSnapshot.rootPubkey === state.rootNodePubkey &&
      this.previousSnapshot.activeLayer === activeLayer &&
      this.previousSnapshot.connectionsSourceLayer === state.connectionsSourceLayer &&
      this.previousSnapshot.selectedNodePubkey === state.selectedNodePubkey &&
      this.previousSnapshot.pinnedNodePubkeys === pinnedNodePubkeys &&
      this.previousSnapshot.relayState === relayState &&
      this.previousSnapshot.discoveryState === discoveryState
    ) {
      return this.previousSnapshot
    }

    const snapshot: CanonicalGraphState = {
      nodesByPubkey,
      edgesById,
      sceneSignature,
      rootPubkey: state.rootNodePubkey,
      activeLayer,
      connectionsSourceLayer: state.connectionsSourceLayer,
      selectedNodePubkey: state.selectedNodePubkey,
      pinnedNodePubkeys,
      relayState,
      discoveryState,
    }

    this.previousSnapshot = snapshot
    return snapshot
  }

  private adaptEdges(state: AppStore) {
    if (
      this.previousLinks === state.links &&
      this.previousInboundLinks === state.inboundLinks &&
      this.previousConnectionsLinks === state.connectionsLinks
    ) {
      return this.previousEdgesById
    }

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

    this.previousLinks = state.links
    this.previousInboundLinks = state.inboundLinks
    this.previousConnectionsLinks = state.connectionsLinks
    this.previousEdgesById = edgesById

    return edgesById
  }

  private adaptNodes(state: AppStore) {
    if (
      this.previousNodes === state.nodes &&
      this.previousExpandedNodePubkeys === state.expandedNodePubkeys &&
      this.previousNodeExpansionStates === state.nodeExpansionStates
    ) {
      return this.previousNodesByPubkey
    }

    const nodesByPubkey = Object.fromEntries(
      Object.values(state.nodes).map((node) => [
        node.pubkey,
        createCanonicalNode(state, node),
      ]),
    )

    this.previousNodes = state.nodes
    this.previousExpandedNodePubkeys = state.expandedNodePubkeys
    this.previousNodeExpansionStates = state.nodeExpansionStates
    this.previousNodesByPubkey = nodesByPubkey

    return nodesByPubkey
  }

  private adaptRelayState(state: AppStore) {
    if (
      this.previousRelayUrls === state.relayUrls &&
      this.previousRelayHealth === state.relayHealth &&
      this.previousRelayOverrideStatus === state.relayOverrideStatus &&
      this.previousGraphStale === state.isGraphStale &&
      this.previousRelayState
    ) {
      return this.previousRelayState
    }

    const relayEndpoints = Object.fromEntries(
      state.relayUrls.map((relayUrl) => [
        relayUrl,
        createCanonicalRelayEndpoint(state, relayUrl),
      ]),
    )

    this.previousRelayUrls = state.relayUrls
    this.previousRelayHealth = state.relayHealth
    this.previousRelayOverrideStatus = state.relayOverrideStatus
    this.previousGraphStale = state.isGraphStale
    this.previousRelayState = {
      urls: [...state.relayUrls],
      endpoints: relayEndpoints,
      overrideStatus: state.relayOverrideStatus,
      isGraphStale: state.isGraphStale,
    }

    return this.previousRelayState
  }

  private adaptDiscoveryState(state: AppStore) {
    if (
      this.previousRootLoad === state.rootLoad &&
      this.previousDiscoveryExpandedNodePubkeys === state.expandedNodePubkeys &&
      this.previousGraphRevision === state.graphRevision &&
      this.previousInboundGraphRevision === state.inboundGraphRevision &&
      this.previousConnectionsLinksRevision === state.connectionsLinksRevision &&
      this.previousDiscoveryState
    ) {
      return this.previousDiscoveryState
    }

    this.previousRootLoad = state.rootLoad
    this.previousDiscoveryExpandedNodePubkeys = state.expandedNodePubkeys
    this.previousGraphRevision = state.graphRevision
    this.previousInboundGraphRevision = state.inboundGraphRevision
    this.previousConnectionsLinksRevision = state.connectionsLinksRevision
    this.previousDiscoveryState = {
      rootLoad: state.rootLoad,
      expandedNodePubkeys: new Set(state.expandedNodePubkeys),
      graphRevision: state.graphRevision,
      inboundGraphRevision: state.inboundGraphRevision,
      connectionsLinksRevision: state.connectionsLinksRevision,
    }

    return this.previousDiscoveryState
  }

  private adaptPinnedNodePubkeys(state: AppStore) {
    if (this.previousPinnedNodePubkeys === state.pinnedNodePubkeys) {
      return this.previousCanonicalPinnedNodePubkeys
    }

    this.previousPinnedNodePubkeys = state.pinnedNodePubkeys
    this.previousCanonicalPinnedNodePubkeys = new Set(state.pinnedNodePubkeys)

    return this.previousCanonicalPinnedNodePubkeys
  }

  private getSceneNodeVisualSignature(nodes: AppStore['nodes']) {
    if (this.previousSceneSignatureNodes === nodes) {
      return this.previousSceneNodeVisualSignature
    }

    this.previousSceneSignatureNodes = nodes
    this.previousSceneNodeVisualSignature = createSceneNodeVisualSignature(nodes)

    return this.previousSceneNodeVisualSignature
  }

  private getScenePinnedNodePubkeysSignature(
    pinnedNodePubkeys: AppStore['pinnedNodePubkeys'],
  ) {
    if (this.previousSceneSignaturePinnedNodePubkeys === pinnedNodePubkeys) {
      return this.previousScenePinnedNodePubkeysSignature
    }

    this.previousSceneSignaturePinnedNodePubkeys = pinnedNodePubkeys
    this.previousScenePinnedNodePubkeysSignature = Array.from(pinnedNodePubkeys)
      .sort()
      .join(',')

    return this.previousScenePinnedNodePubkeysSignature
  }

  private getSceneExpandedNodePubkeysSignature(
    expandedNodePubkeys: AppStore['expandedNodePubkeys'],
  ) {
    if (this.previousSceneSignatureExpandedNodePubkeys === expandedNodePubkeys) {
      return this.previousSceneExpandedNodePubkeysSignature
    }

    this.previousSceneSignatureExpandedNodePubkeys = expandedNodePubkeys
    this.previousSceneExpandedNodePubkeysSignature = Array.from(
      expandedNodePubkeys,
    )
      .sort()
      .join(',')

    return this.previousSceneExpandedNodePubkeysSignature
  }
}

export const adaptLegacyStoreSnapshot = (state: AppStore): CanonicalGraphState =>
  new LegacyStoreSnapshotAdapter().adapt(state)
