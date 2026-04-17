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
  sceneSignature: 'test-scene',
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

test('builds a compact deterministic topology signature', () => {
  const scene = buildGraphSceneSnapshot(createState())

  assert.equal(scene.diagnostics.topologySignature, 'root::following::1::0::1::3::3')
})

test('leaves every node with idle/root focus state when there is no selection', () => {
  const scene = buildGraphSceneSnapshot(createState())

  const focusStates = scene.nodes.map((node) => [node.pubkey, node.focusState])
  assert.deepEqual(focusStates, [
    ['root', 'root'],
    ['alice', 'idle'],
    ['bob', 'idle'],
  ])
  assert.ok(scene.nodes.every((node) => !node.isDimmed))
  assert.ok(scene.visibleEdges.every((edge) => !edge.isDimmed))
})

test('uses selection as visual focus for the selected node and its links', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      selectedNodePubkey: 'alice',
    }),
  )

  const focusByPubkey = Object.fromEntries(
    scene.nodes.map((node) => [node.pubkey, node.focusState]),
  )
  const nodesByPubkey = Object.fromEntries(
    scene.nodes.map((node) => [node.pubkey, node]),
  )
  assert.equal(scene.selection.selectedNodePubkey, 'alice')
  assert.equal(nodesByPubkey.alice?.isSelected, true)
  assert.equal(focusByPubkey.alice, 'selected')
  assert.equal(focusByPubkey.root, 'root')
  assert.equal(focusByPubkey.bob, 'neighbor')
  assert.equal(nodesByPubkey.alice?.color, '#ffb25b')
  assert.equal(nodesByPubkey.alice?.size, 17)
  assert.equal(nodesByPubkey.bob?.color, '#f8f2a2')
  assert.equal(nodesByPubkey.bob?.size, 13)

  const edgeFocusById = Object.fromEntries(
    scene.forceEdges.map((edge) => [edge.id, edge.touchesFocus]),
  )
  const edgesById = Object.fromEntries(
    scene.forceEdges.map((edge) => [edge.id, edge]),
  )
  assert.equal(edgeFocusById['root->alice:follow'], true)
  assert.equal(edgeFocusById['alice->bob:follow'], true)
  assert.equal(edgeFocusById['root->bob:follow'], false)
  assert.equal(edgesById['alice->bob:follow']?.hidden, false)
  assert.equal(edgesById['alice->bob:follow']?.color, '#f4fbff')
  assert.equal(edgesById['alice->bob:follow']?.size, 2.7)
  assert.equal(edgesById['root->bob:follow']?.isDimmed, true)
  assert.equal(edgesById['root->bob:follow']?.color, '#10171f')
  assert.equal(edgesById['root->bob:follow']?.size, 0.25)
})

test('keeps root as the root focus state even when it is a depth-1 neighbor of the selection', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      selectedNodePubkey: 'alice',
    }),
  )
  const root = scene.nodes.find((node) => node.pubkey === 'root')
  assert.ok(root)
  assert.equal(root.focusState, 'root')
})

test('marks pinned nodes outside the neighborhood with pinned focus state (not dim)', () => {
  const state = createState({
    activeLayer: 'graph',
    selectedNodePubkey: 'alice',
  })
  state.nodesByPubkey['carol'] = {
    pubkey: 'carol',
    label: 'Carol',
    picture: null,
    about: null,
    nip05: null,
    lud16: null,
    source: 'follow',
    discoveredAt: 3,
    keywordHits: 0,
    profileEventId: null,
    profileFetchedAt: null,
    profileSource: null,
    profileState: 'ready',
    isExpanded: false,
    nodeExpansionState: null,
  }
  state.discoveryState = {
    ...state.discoveryState,
    expandedNodePubkeys: new Set<string>(['root', 'carol']),
  }
  state.pinnedNodePubkeys = new Set<string>(['carol'])

  const scene = buildGraphSceneSnapshot(state)
  const carol = scene.nodes.find((node) => node.pubkey === 'carol')
  assert.ok(carol)
  assert.equal(carol.isPinned, true)
  assert.equal(carol.focusState, 'pinned')
})

test('dims edges outside the selected node neighborhood', () => {
  const state = createState({
    activeLayer: 'graph',
    selectedNodePubkey: 'root',
  })
  state.nodesByPubkey['carol'] = {
    pubkey: 'carol',
    label: 'Carol',
    picture: null,
    about: null,
    nip05: null,
    lud16: null,
    source: 'follow',
    discoveredAt: 3,
    keywordHits: 0,
    profileEventId: null,
    profileFetchedAt: null,
    profileSource: null,
    profileState: 'ready',
    isExpanded: false,
    nodeExpansionState: null,
  }
  state.nodesByPubkey['dave'] = {
    pubkey: 'dave',
    label: 'Dave',
    picture: null,
    about: null,
    nip05: null,
    lud16: null,
    source: 'follow',
    discoveredAt: 4,
    keywordHits: 0,
    profileEventId: null,
    profileFetchedAt: null,
    profileSource: null,
    profileState: 'ready',
    isExpanded: false,
    nodeExpansionState: null,
  }
  state.edgesById['carol->dave:follow'] = {
    id: 'carol->dave:follow',
    source: 'carol',
    target: 'dave',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }
  state.discoveryState = {
    ...state.discoveryState,
    expandedNodePubkeys: new Set<string>(['root', 'carol']),
  }

  const scene = buildGraphSceneSnapshot(state)
  const dimmed = scene.forceEdges.find((edge) => edge.id === 'carol->dave:follow')
  assert.ok(dimmed)
  assert.equal(dimmed.isDimmed, true)
  assert.equal(dimmed.touchesFocus, false)
})
