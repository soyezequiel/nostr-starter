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
  sceneSignature: 'test-scene',
  nodeVisualRevision: 1,
  nodeDetailRevision: 0,
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

test('keeps relationship layers anchored to the root and expanded nodes', () => {
  const state = createState()
  state.nodesByPubkey.bob = {
    ...state.nodesByPubkey.alice!,
    pubkey: 'bob',
    label: 'Bob',
    discoveredAt: 2,
  }
  state.edgesById['alice->bob:follow'] = {
    id: 'alice->bob:follow',
    source: 'alice',
    target: 'bob',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }
  state.edgesById['bob->alice:follow'] = {
    id: 'bob->alice:follow',
    source: 'bob',
    target: 'alice',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }
  state.discoveryState = {
    ...state.discoveryState,
    expandedNodePubkeys: new Set<string>(['root', 'alice']),
  }

  const following = buildLayerProjection(state, 'following')
  const mutuals = buildLayerProjection(state, 'mutuals')

  assert.deepEqual(
    following.visibleEdges.map((edge) => edge.id),
    ['alice->bob:follow', 'alice->root:follow', 'root->alice:follow'],
  )
  assert.deepEqual(
    mutuals.visibleEdges.map((edge) => edge.id),
    [
      'alice->bob:follow',
      'alice->root:follow',
      'bob->alice:follow',
      'root->alice:follow',
    ],
  )
})

test('keeps expanded nodes visible in mutuals without inventing non-mutual edges', () => {
  const state = createState()
  state.nodesByPubkey.bob = {
    ...state.nodesByPubkey.alice!,
    pubkey: 'bob',
    label: 'Bob',
    discoveredAt: 2,
  }
  state.edgesById['alice->bob:follow'] = {
    id: 'alice->bob:follow',
    source: 'alice',
    target: 'bob',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }
  state.discoveryState = {
    ...state.discoveryState,
    expandedNodePubkeys: new Set<string>(['root', 'alice', 'bob']),
  }

  const mutuals = buildLayerProjection(state, 'mutuals')

  assert.deepEqual(
    Array.from(mutuals.visibleNodePubkeys).sort(),
    ['alice', 'bob', 'root'],
  )
  assert.deepEqual(
    mutuals.visibleEdges.map((edge) => edge.id),
    ['alice->root:follow', 'root->alice:follow'],
  )
})

test('reuses projections when only discovery revisions change', () => {
  const state = createState({ activeLayer: 'graph' })
  const first = buildLayerProjection(state)
  const second = buildLayerProjection({
    ...state,
    discoveryState: {
      ...state.discoveryState,
      graphRevision: state.discoveryState.graphRevision + 1,
      expandedNodePubkeys: new Set(state.discoveryState.expandedNodePubkeys),
    },
  })

  assert.strictEqual(second, first)
})

test('invalidates projection cache when topology changes', () => {
  const state = createState({ activeLayer: 'graph' })
  const first = buildLayerProjection(state)
  const second = buildLayerProjection({
    ...state,
    edgesById: {
      ...state.edgesById,
      'root->bob:follow': {
        id: 'root->bob:follow',
        source: 'root',
        target: 'bob',
        relation: 'follow',
        origin: 'graph',
        weight: 1,
      },
    },
  })

  assert.notStrictEqual(second, first)
})
