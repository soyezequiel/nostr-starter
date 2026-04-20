import type { AppStore, RootLoadState } from '@/features/graph-runtime/app/store/types'
import {
  createCanonicalEdgeId,
  DEFAULT_GRAPH_V2_LAYER,
  isGraphV2Layer,
} from '@/features/graph-v2/domain/invariants'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import type {
  CanonicalEdge,
  CanonicalGraphSceneState,
  CanonicalGraphState,
  CanonicalGraphUiState,
  CanonicalRelayEndpoint,
  CanonicalRelayState,
} from '@/features/graph-v2/domain/types'

const EMPTY_ROOT_LOAD_STATE: RootLoadState = {
  status: 'idle',
  message: null,
  loadedFrom: 'none',
  visibleLinkProgress: null,
}

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
): CanonicalGraphSceneState['nodesByPubkey'][string] => ({
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

const createSceneSignature = (
  state: AppStore,
  activeLayer: CanonicalGraphSceneState['activeLayer'],
  pinnedNodePubkeysSignature: string,
  expandedNodePubkeysSignature: string,
) =>
  [
    state.rootNodePubkey ?? 'no-root',
    activeLayer,
    state.connectionsSourceLayer,
    state.selectedNodePubkey ?? 'no-selection',
    state.graphRevision,
    state.inboundGraphRevision,
    state.connectionsLinksRevision,
    state.nodeVisualRevision,
    expandedNodePubkeysSignature,
    Object.keys(state.nodes).length,
    state.links.length + state.inboundLinks.length + state.connectionsLinks.length,
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

  private previousNodesByPubkey: Record<string, CanonicalGraphSceneState['nodesByPubkey'][string]> = {}

  private previousRelayUrls: AppStore['relayUrls'] | null = null

  private previousRelayHealth: AppStore['relayHealth'] | null = null

  private previousRelayOverrideStatus: AppStore['relayOverrideStatus'] | null = null

  private previousGraphStale: boolean | null = null

  private previousRelayState: CanonicalRelayState | null = null

  private previousRootLoad: AppStore['rootLoad'] | null = null

  private previousUiState: CanonicalGraphUiState | null = null

  private previousDiscoveryExpandedNodePubkeys: AppStore['expandedNodePubkeys'] | null = null

  private previousGraphRevision: number | null = null

  private previousInboundGraphRevision: number | null = null

  private previousConnectionsLinksRevision: number | null = null

  private previousSceneDiscoveryState: CanonicalGraphSceneState['discoveryState'] | null = null

  private previousPinnedNodePubkeys: AppStore['pinnedNodePubkeys'] | null = null

  private previousFixedRootPubkey: AppStore['fixedRootPubkey'] | null = null

  private previousPinnedRootNodePubkey: AppStore['rootNodePubkey'] | null = null

  private previousCanonicalPinnedNodePubkeys: Set<string> = new Set<string>()

  private previousSceneSignaturePinnedNodePubkeys: ReadonlySet<string> | null = null

  private previousScenePinnedNodePubkeysSignature = ''

  private previousSceneSignatureExpandedNodePubkeys:
    | AppStore['expandedNodePubkeys']
    | null = null

  private previousSceneExpandedNodePubkeysSignature = ''

  private previousSceneSnapshot: CanonicalGraphSceneState | null = null

  private previousCombinedSnapshot: CanonicalGraphState | null = null

  public adapt(state: AppStore): CanonicalGraphState {
    const scene = this.adaptScene(state)
    const ui = this.adaptUi(state)

    if (
      this.previousCombinedSnapshot &&
      this.previousCombinedSnapshot.nodesByPubkey === scene.nodesByPubkey &&
      this.previousCombinedSnapshot.edgesById === scene.edgesById &&
      this.previousCombinedSnapshot.sceneSignature === scene.sceneSignature &&
      this.previousCombinedSnapshot.nodeDetailRevision === scene.nodeDetailRevision &&
      this.previousCombinedSnapshot.rootPubkey === scene.rootPubkey &&
      this.previousCombinedSnapshot.activeLayer === scene.activeLayer &&
      this.previousCombinedSnapshot.connectionsSourceLayer ===
        scene.connectionsSourceLayer &&
      this.previousCombinedSnapshot.selectedNodePubkey === scene.selectedNodePubkey &&
      this.previousCombinedSnapshot.pinnedNodePubkeys === scene.pinnedNodePubkeys &&
      this.previousCombinedSnapshot.discoveryState.expandedNodePubkeys ===
        scene.discoveryState.expandedNodePubkeys &&
      this.previousCombinedSnapshot.discoveryState.graphRevision ===
        scene.discoveryState.graphRevision &&
      this.previousCombinedSnapshot.discoveryState.inboundGraphRevision ===
        scene.discoveryState.inboundGraphRevision &&
      this.previousCombinedSnapshot.discoveryState.connectionsLinksRevision ===
        scene.discoveryState.connectionsLinksRevision &&
      this.previousCombinedSnapshot.discoveryState.rootLoad === ui.rootLoad &&
      this.previousCombinedSnapshot.relayState === ui.relayState
    ) {
      return this.previousCombinedSnapshot
    }

    const snapshot: CanonicalGraphState = {
      ...scene,
      relayState: ui.relayState,
      discoveryState: {
        ...scene.discoveryState,
        rootLoad: ui.rootLoad,
      },
    }

    this.previousCombinedSnapshot = snapshot
    return snapshot
  }

  public adaptScene(state: AppStore): CanonicalGraphSceneState {
    const edgesById = this.adaptEdges(state)
    const nodesByPubkey = this.adaptNodes(state)
    const discoveryState = this.adaptSceneDiscoveryState(state)
    const pinnedNodePubkeys = this.adaptPinnedNodePubkeys(state)
    const activeLayer = isGraphV2Layer(state.activeLayer)
      ? state.activeLayer
      : DEFAULT_GRAPH_V2_LAYER
    const sceneSignature = createSceneSignature(
      state,
      activeLayer,
      this.getScenePinnedNodePubkeysSignature(pinnedNodePubkeys),
      this.getSceneExpandedNodePubkeysSignature(state.expandedNodePubkeys),
    )

    if (
      this.previousSceneSnapshot &&
      this.previousSceneSnapshot.edgesById === edgesById &&
      this.previousSceneSnapshot.nodesByPubkey === nodesByPubkey &&
      this.previousSceneSnapshot.sceneSignature === sceneSignature &&
      this.previousSceneSnapshot.nodeVisualRevision === state.nodeVisualRevision &&
      this.previousSceneSnapshot.nodeDetailRevision === state.nodeDetailRevision &&
      this.previousSceneSnapshot.rootPubkey === state.rootNodePubkey &&
      this.previousSceneSnapshot.activeLayer === activeLayer &&
      this.previousSceneSnapshot.connectionsSourceLayer ===
        state.connectionsSourceLayer &&
      this.previousSceneSnapshot.selectedNodePubkey === state.selectedNodePubkey &&
      this.previousSceneSnapshot.pinnedNodePubkeys === pinnedNodePubkeys &&
      this.previousSceneSnapshot.discoveryState === discoveryState
    ) {
      return this.previousSceneSnapshot
    }

    const snapshot: CanonicalGraphSceneState = {
      nodesByPubkey,
      edgesById,
      sceneSignature,
      nodeVisualRevision: state.nodeVisualRevision,
      nodeDetailRevision: state.nodeDetailRevision,
      rootPubkey: state.rootNodePubkey,
      activeLayer,
      connectionsSourceLayer: state.connectionsSourceLayer,
      selectedNodePubkey: state.selectedNodePubkey,
      pinnedNodePubkeys,
      discoveryState,
    }

    this.previousSceneSnapshot = snapshot
    return snapshot
  }

  public adaptUi(state: AppStore): CanonicalGraphUiState {
    const relayState = this.adaptRelayState(state)
    const rootLoad = this.adaptRootLoad(state)

    if (
      this.previousUiState &&
      this.previousUiState.relayState === relayState &&
      this.previousUiState.rootLoad === rootLoad
    ) {
      return this.previousUiState
    }

    this.previousUiState = {
      relayState,
      rootLoad,
    }

    return this.previousUiState
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

    if (isAccountTraceRoot(state.rootNodePubkey)) {
      const traceConfig = getAccountTraceConfig()
      if (traceConfig) {
        const rootToTargetFollowId = createCanonicalEdgeId(
          traceConfig.rootPubkey,
          traceConfig.targetPubkey,
          'follow',
        )
        const targetToRootInboundId = createCanonicalEdgeId(
          traceConfig.targetPubkey,
          traceConfig.rootPubkey,
          'inbound',
        )
        const targetToRootFollowId = createCanonicalEdgeId(
          traceConfig.targetPubkey,
          traceConfig.rootPubkey,
          'follow',
        )
        traceAccountFlow('legacySnapshotAdapter.adaptEdges', {
          linkCount: state.links.length,
          inboundLinkCount: state.inboundLinks.length,
          canonicalEdgeCount: Object.keys(edgesById).length,
          hasTraceTargetNode: Boolean(state.nodes[traceConfig.targetPubkey]),
          hasRootToTraceTargetFollowEdge: Boolean(edgesById[rootToTargetFollowId]),
          hasTraceTargetToRootInboundEdge: Boolean(edgesById[targetToRootInboundId]),
          hasTraceTargetToRootFollowEdge: Boolean(edgesById[targetToRootFollowId]),
          graphRevision: state.graphRevision,
          inboundGraphRevision: state.inboundGraphRevision,
        })
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

  private adaptRootLoad(state: AppStore) {
    if (this.previousRootLoad === state.rootLoad) {
      return this.previousRootLoad ?? EMPTY_ROOT_LOAD_STATE
    }

    this.previousRootLoad = state.rootLoad
    return state.rootLoad
  }

  private adaptSceneDiscoveryState(state: AppStore) {
    if (
      this.previousDiscoveryExpandedNodePubkeys === state.expandedNodePubkeys &&
      this.previousGraphRevision === state.graphRevision &&
      this.previousInboundGraphRevision === state.inboundGraphRevision &&
      this.previousConnectionsLinksRevision === state.connectionsLinksRevision &&
      this.previousSceneDiscoveryState
    ) {
      return this.previousSceneDiscoveryState
    }

    this.previousDiscoveryExpandedNodePubkeys = state.expandedNodePubkeys
    this.previousGraphRevision = state.graphRevision
    this.previousInboundGraphRevision = state.inboundGraphRevision
    this.previousConnectionsLinksRevision = state.connectionsLinksRevision
    this.previousSceneDiscoveryState = {
      expandedNodePubkeys: new Set(state.expandedNodePubkeys),
      graphRevision: state.graphRevision,
      inboundGraphRevision: state.inboundGraphRevision,
      connectionsLinksRevision: state.connectionsLinksRevision,
    }

    return this.previousSceneDiscoveryState
  }

  private adaptPinnedNodePubkeys(state: AppStore) {
    if (
      this.previousPinnedNodePubkeys === state.pinnedNodePubkeys &&
      this.previousFixedRootPubkey === state.fixedRootPubkey &&
      this.previousPinnedRootNodePubkey === state.rootNodePubkey
    ) {
      return this.previousCanonicalPinnedNodePubkeys
    }

    this.previousPinnedNodePubkeys = state.pinnedNodePubkeys
    this.previousFixedRootPubkey = state.fixedRootPubkey
    this.previousPinnedRootNodePubkey = state.rootNodePubkey
    this.previousCanonicalPinnedNodePubkeys = new Set(state.pinnedNodePubkeys)

    if (
      state.fixedRootPubkey !== null &&
      state.rootNodePubkey !== null &&
      state.fixedRootPubkey === state.rootNodePubkey
    ) {
      this.previousCanonicalPinnedNodePubkeys.add(state.rootNodePubkey)
    }

    return this.previousCanonicalPinnedNodePubkeys
  }

  private getScenePinnedNodePubkeysSignature(pinnedNodePubkeys: ReadonlySet<string>) {
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
