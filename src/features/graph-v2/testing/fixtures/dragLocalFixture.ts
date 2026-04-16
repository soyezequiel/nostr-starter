import type { CanonicalGraphState, CanonicalNode } from '@/features/graph-v2/domain/types'

const ROOT_PUBKEY = 'fixture-root'
const DRAG_TARGET_PUBKEY = 'fixture-drag-target'
const PINNED_NEIGHBOR_PUBKEY = 'fixture-pinned-neighbor'

const createNode = (
  pubkey: string,
  overrides: Partial<CanonicalNode> = {},
): CanonicalNode => ({
  pubkey,
  label: overrides.label ?? pubkey,
  picture: overrides.picture ?? null,
  about: overrides.about ?? null,
  nip05: overrides.nip05 ?? null,
  lud16: overrides.lud16 ?? null,
  source: overrides.source ?? 'follow',
  discoveredAt: overrides.discoveredAt ?? null,
  keywordHits: overrides.keywordHits ?? 0,
  profileEventId: overrides.profileEventId ?? null,
  profileFetchedAt: overrides.profileFetchedAt ?? null,
  profileSource: overrides.profileSource ?? 'relay',
  profileState: overrides.profileState ?? 'ready',
  isExpanded: overrides.isExpanded ?? false,
  nodeExpansionState: overrides.nodeExpansionState ?? null,
})

const createEdge = (
  source: string,
  target: string,
  relation: 'follow' | 'inbound' = 'follow',
) => ({
  id: `${source}:${target}:${relation}`,
  source,
  target,
  relation,
  origin: 'graph' as const,
  weight: 1,
})

export interface FixtureScenario {
  readonly state: CanonicalGraphState
  readonly dragTargetPubkey: string
  readonly pinnedNeighborPubkey: string
}

export const createDragLocalFixture = (): FixtureScenario => {
  const nodes = [
    createNode(ROOT_PUBKEY, {
      label: 'Root Fixture',
      source: 'root',
      discoveredAt: 0,
      isExpanded: true,
    }),
    createNode(DRAG_TARGET_PUBKEY, {
      label: 'Nodo Arrastrable',
      discoveredAt: 1,
      isExpanded: true,
    }),
    createNode('fixture-hop1-a', { label: 'Hop 1 A', discoveredAt: 2 }),
    createNode('fixture-hop1-b', { label: 'Hop 1 B', discoveredAt: 3 }),
    createNode('fixture-hop1-c', { label: 'Hop 1 C', discoveredAt: 4 }),
    createNode(PINNED_NEIGHBOR_PUBKEY, {
      label: 'Pinned Neighbor',
      discoveredAt: 5,
    }),
    createNode('fixture-hop2-a', { label: 'Hop 2 A', discoveredAt: 6 }),
    createNode('fixture-hop2-b', { label: 'Hop 2 B', discoveredAt: 7 }),
    createNode('fixture-hop2-c', { label: 'Hop 2 C', discoveredAt: 8 }),
    createNode('fixture-hop2-d', { label: 'Hop 2 D', discoveredAt: 9 }),
    createNode('fixture-hop3-a', { label: 'Hop 3 A', discoveredAt: 10 }),
    createNode('fixture-outside-a', { label: 'Outside A', discoveredAt: 11 }),
    createNode('fixture-outside-b', { label: 'Outside B', discoveredAt: 12 }),
  ]

  const edges = [
    createEdge(ROOT_PUBKEY, DRAG_TARGET_PUBKEY),
    createEdge(DRAG_TARGET_PUBKEY, ROOT_PUBKEY),
    createEdge(DRAG_TARGET_PUBKEY, 'fixture-hop1-a'),
    createEdge('fixture-hop1-a', DRAG_TARGET_PUBKEY),
    createEdge(DRAG_TARGET_PUBKEY, 'fixture-hop1-b'),
    createEdge(DRAG_TARGET_PUBKEY, 'fixture-hop1-c'),
    createEdge(DRAG_TARGET_PUBKEY, PINNED_NEIGHBOR_PUBKEY),
    createEdge('fixture-hop1-a', 'fixture-hop2-a'),
    createEdge('fixture-hop1-b', 'fixture-hop2-b'),
    createEdge('fixture-hop1-c', 'fixture-hop2-c'),
    createEdge(PINNED_NEIGHBOR_PUBKEY, 'fixture-hop2-d'),
    createEdge('fixture-hop2-a', 'fixture-hop3-a'),
    createEdge('fixture-outside-a', 'fixture-outside-b'),
    createEdge('fixture-outside-b', 'fixture-outside-a'),
  ]

  return {
    dragTargetPubkey: DRAG_TARGET_PUBKEY,
    pinnedNeighborPubkey: PINNED_NEIGHBOR_PUBKEY,
    state: {
      nodesByPubkey: Object.fromEntries(nodes.map((node) => [node.pubkey, node])),
      edgesById: Object.fromEntries(edges.map((edge) => [edge.id, edge])),
      rootPubkey: ROOT_PUBKEY,
      activeLayer: 'graph',
      connectionsSourceLayer: 'graph',
      selectedNodePubkey: null,
      pinnedNodePubkeys: new Set([PINNED_NEIGHBOR_PUBKEY]),
      relayState: {
        urls: ['wss://fixture.local'],
        endpoints: {
          'wss://fixture.local': {
            url: 'wss://fixture.local',
            status: 'connected',
            lastCheckedAt: 0,
            lastNotice: null,
          },
        },
        overrideStatus: 'idle',
        isGraphStale: false,
      },
      discoveryState: {
        rootLoad: {
          status: 'ready',
          message: 'Fixture drag-local cargado.',
          loadedFrom: 'cache',
          visibleLinkProgress: null,
        },
        expandedNodePubkeys: new Set([ROOT_PUBKEY, DRAG_TARGET_PUBKEY]),
        graphRevision: 1,
        inboundGraphRevision: 0,
        connectionsLinksRevision: 0,
      },
    },
  }
}
