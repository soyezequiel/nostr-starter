import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGraphSceneSnapshot } from '@/features/graph-v2/projections/buildGraphSceneSnapshot'
import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'

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
    bob: {
      pubkey: 'bob',
      label: 'Bob',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      source: 'follow',
      discoveredAt: 2,
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
    'root->bob:follow': {
      id: 'root->bob:follow',
      source: 'root',
      target: 'bob',
      relation: 'follow',
      origin: 'graph',
      weight: 1,
    },
    'alice->bob:follow': {
      id: 'alice->bob:follow',
      source: 'alice',
      target: 'bob',
      relation: 'follow',
      origin: 'connections',
      weight: 1,
    },
  },
  rootPubkey: 'root',
  activeLayer: 'following',
  connectionsSourceLayer: 'following',
  selectedNodePubkey: null,
  pinnedNodePubkeys: new Set<string>(),
  relayState: {
    urls: ['wss://relay.example'],
    endpoints: {
      'wss://relay.example': {
        url: 'wss://relay.example',
        status: 'connected',
        lastCheckedAt: null,
        lastNotice: null,
      },
    },
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
    inboundGraphRevision: 0,
    connectionsLinksRevision: 1,
  },
  ...overrides,
})

test('keeps force edges separate from visible edges in relationship layers', () => {
  const scene = buildGraphSceneSnapshot(createState())

  assert.deepEqual(
    scene.visibleEdges.map((edge) => edge.id),
    ['root->alice:follow', 'root->bob:follow'],
  )
  assert.deepEqual(
    scene.forceEdges.map((edge) => edge.id),
    ['alice->bob:follow', 'root->alice:follow', 'root->bob:follow'],
  )
  assert.equal(
    scene.forceEdges.find((edge) => edge.id === 'alice->bob:follow')?.hidden,
    true,
  )
})

test('builds connections layer without reintroducing the root node', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      activeLayer: 'connections',
    }),
  )

  assert.deepEqual(
    scene.visibleEdges.map((edge) => edge.id),
    ['alice->bob:follow'],
  )
  assert.deepEqual(
    scene.nodes.map((node) => node.pubkey),
    ['alice', 'bob'],
  )
})
