import assert from 'node:assert/strict'
import test from 'node:test'

import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildLayerProjection } from '@/features/graph-v2/projections/buildLayerProjection'

const createState = (
  overrides: Partial<CanonicalGraphState> = {},
): CanonicalGraphState => ({
  nodesByPubkey: {
    root: {
      pubkey: 'root',
      label: 'Root',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      source: 'root',
      discoveredAt: 0,
      keywordHits: 0,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      isExpanded: true,
      nodeExpansionState: null,
    },
    alice: {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      source: 'follow',
      discoveredAt: 1,
      keywordHits: 0,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      isExpanded: false,
      nodeExpansionState: null,
    },
  },
  edgesById: {
    'root->alice:follow': {
      id: 'root->alice:follow',
      source: 'root',
      target: 'alice',
      relation: 'follow',
      origin: 'graph',
      weight: 1,
    },
    'alice->root:follow': {
      id: 'alice->root:follow',
      source: 'alice',
      target: 'root',
      relation: 'follow',
      origin: 'graph',
      weight: 1,
    },
    'alice->root:inbound': {
      id: 'alice->root:inbound',
      source: 'alice',
      target: 'root',
      relation: 'inbound',
      origin: 'inbound',
      weight: 1,
    },
  },
  rootPubkey: 'root',
  activeLayer: 'mutuals',
  connectionsSourceLayer: 'graph',
  selectedNodePubkey: null,
  pinnedNodePubkeys: new Set<string>(),
  relayState: {
    urls: [],
    endpoints: {},
    overrideStatus: 'idle',
    isGraphStale: false,
  },
  discoveryState: {
    rootLoad: {
      status: 'ready',
      message: null,
      loadedFrom: 'live',
      visibleLinkProgress: null,
    },
    expandedNodePubkeys: new Set<string>(['root']),
    graphRevision: 1,
    inboundGraphRevision: 1,
    connectionsLinksRevision: 0,
  },
  ...overrides,
})

test('emits at most one mutual edge per directed pair inside a snapshot', () => {
  const projection = buildLayerProjection(createState(), 'mutuals')
  const pairKeys = projection.visibleEdges.map(
    (edge) => `${edge.source}->${edge.target}`,
  )

  assert.deepEqual(pairKeys, ['alice->root', 'root->alice'])
  assert.equal(new Set(pairKeys).size, pairKeys.length)
})
