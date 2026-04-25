import assert from 'node:assert/strict'
import test from 'node:test'

import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildGraphSceneSnapshot } from '@/features/graph-v2/projections/buildGraphSceneSnapshot'

let sceneCounter = 0

const createState = (
  overrides: Partial<CanonicalGraphState> = {},
): CanonicalGraphState => {
  const state: CanonicalGraphState = {
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
    sceneSignature: `test-scene-${sceneCounter += 1}`,
    topologySignature: '',
    nodeVisualRevision: 1,
    nodeDetailRevision: 0,
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
    rootLoad: {
      status: 'ready',
      message: null,
      loadedFrom: 'live',
      visibleLinkProgress: null,
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
  }

  state.topologySignature = [
    state.rootPubkey ?? 'no-root',
    state.activeLayer,
    state.connectionsSourceLayer,
    state.discoveryState.graphRevision,
    state.discoveryState.inboundGraphRevision,
    state.discoveryState.connectionsLinksRevision,
    Array.from(state.discoveryState.expandedNodePubkeys).sort().join(','),
    Object.keys(state.nodesByPubkey).length,
    Object.keys(state.edgesById).length,
  ].join('|')

  return state
}

test('keeps relationship physics edges limited to the same topology as before when there is no selection', () => {
  const scene = buildGraphSceneSnapshot(createState())

  assert.deepEqual(
    scene.render.visibleEdges.map((edge) => edge.id),
    ['root->alice:follow', 'root->bob:follow'],
  )
  assert.deepEqual(
    scene.physics.edges.map((edge) => edge.id),
    ['root->alice:follow', 'root->bob:follow'],
  )
})

test('builds connections layer without reintroducing the root node', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      activeLayer: 'connections',
    }),
  )

  assert.deepEqual(
    scene.render.visibleEdges.map((edge) => edge.id),
    ['alice->bob:follow'],
  )
  assert.deepEqual(
    scene.render.nodes.map((node) => node.pubkey),
    ['alice', 'bob'],
  )
})

test('reuses structural edges across visual-only updates while refreshing node metadata', () => {
  const firstState = createState()
  const firstScene = buildGraphSceneSnapshot(firstState)

  const secondState = createState({
    sceneSignature: 'test-scene-visual-update',
    topologySignature: firstState.topologySignature,
    nodeVisualRevision: firstState.nodeVisualRevision + 1,
    edgesById: firstState.edgesById,
    nodesByPubkey: {
      ...firstState.nodesByPubkey,
      alice: {
        ...firstState.nodesByPubkey.alice!,
        label: 'Alice Updated',
        picture: 'https://cdn.example.com/alice.jpg',
      },
    },
  })
  const secondScene = buildGraphSceneSnapshot(secondState)
  const updatedAlice = secondScene.render.nodes.find((node) => node.pubkey === 'alice')

  assert.strictEqual(secondScene.render.visibleEdges, firstScene.render.visibleEdges)
  assert.equal(updatedAlice?.label, 'Alice Updated')
  assert.equal(updatedAlice?.pictureUrl, 'https://cdn.example.com/alice.jpg')
})

test('builds compact deterministic topology signatures for render and physics', () => {
  const scene = buildGraphSceneSnapshot(createState())

  assert.equal(
    scene.render.diagnostics.topologySignature,
    'root::following::1::0::1::3::2',
  )
  assert.equal(
    scene.physics.diagnostics.topologySignature,
    'root::following::1::0::1::3::2',
  )
})

test('keeps graph physics independent from loaded connection edges', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      activeLayer: 'graph',
    }),
  )

  assert.deepEqual(
    scene.render.visibleEdges.map((edge) => edge.id),
    ['root->alice:follow', 'root->bob:follow'],
  )
  assert.deepEqual(
    scene.physics.edges.map((edge) => edge.id),
    ['root->alice:follow', 'root->bob:follow'],
  )
})

test('does not emit duplicate directed pairs when graph and inbound evidence overlap', () => {
  const state = createState({
    activeLayer: 'graph',
  })
  state.edgesById['alice->root:follow'] = {
    id: 'alice->root:follow',
    source: 'alice',
    target: 'root',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }
  state.edgesById['alice->root:inbound'] = {
    id: 'alice->root:inbound',
    source: 'alice',
    target: 'root',
    relation: 'inbound',
    origin: 'inbound',
    weight: 1,
  }

  const scene = buildGraphSceneSnapshot(state)
  const renderPairKeys = scene.render.visibleEdges.map(
    (edge) => `${edge.source}->${edge.target}`,
  )
  const physicsPairKeys = scene.physics.edges.map(
    (edge) => `${edge.source}->${edge.target}`,
  )

  assert.equal(new Set(renderPairKeys).size, renderPairKeys.length)
  assert.equal(new Set(physicsPairKeys).size, physicsPairKeys.length)
  assert.ok(
    scene.render.visibleEdges.some((edge) => edge.id === 'alice->root:follow'),
  )
  assert.ok(
    !scene.render.visibleEdges.some((edge) => edge.id === 'alice->root:inbound'),
  )
})

test('leaves every visible node with idle/root focus state when there is no selection', () => {
  const scene = buildGraphSceneSnapshot(createState())

  const focusStates = scene.render.nodes.map((node) => [
    node.pubkey,
    node.focusState,
  ])
  assert.deepEqual(focusStates, [
    ['root', 'root'],
    ['alice', 'idle'],
    ['bob', 'idle'],
  ])
  assert.ok(scene.render.nodes.every((node) => !node.isDimmed))
  assert.ok(scene.render.visibleEdges.every((edge) => !edge.isDimmed))
})

test('maps loading node expansion state into determinate ring progress', () => {
  const state = createState()
  state.nodesByPubkey.alice = {
    ...state.nodesByPubkey.alice,
    nodeExpansionState: {
      status: 'loading',
      message: 'Expandiendo',
      phase: 'correlating-followers',
      step: 2,
      totalSteps: 4,
      startedAt: 100,
      updatedAt: 200,
    },
  }

  const scene = buildGraphSceneSnapshot(state)
  const alice = scene.render.nodes.find((node) => node.pubkey === 'alice')
  const bob = scene.render.nodes.find((node) => node.pubkey === 'bob')

  assert.equal(alice?.isExpanding, true)
  assert.equal(alice?.expansionProgress, 0.5)
  assert.equal(bob?.isExpanding, false)
  assert.equal(bob?.expansionProgress, null)
})

test('colors reciprocal follows as mutual connections while keeping idle nodes neutral', () => {
  const state = createState({
    activeLayer: 'graph',
  })
  state.edgesById['alice->root:follow'] = {
    id: 'alice->root:follow',
    source: 'alice',
    target: 'root',
    relation: 'follow',
    origin: 'graph',
    weight: 1,
  }

  const scene = buildGraphSceneSnapshot(state)
  const edgesById = Object.fromEntries(
    scene.render.visibleEdges.map((edge) => [edge.id, edge]),
  )
  const alice = scene.render.nodes.find((node) => node.pubkey === 'alice')

  assert.equal(edgesById['root->alice:follow']?.color, '#5fd39d')
  assert.equal(edgesById['alice->root:follow']?.color, '#5fd39d')
  assert.equal(alice?.color, '#9da8c9')
})

test('colors root follow plus inbound follower evidence as mutual in the base graph', () => {
  const state = createState({
    activeLayer: 'graph',
  })
  state.edgesById['alice->root:inbound'] = {
    id: 'alice->root:inbound',
    source: 'alice',
    target: 'root',
    relation: 'inbound',
    origin: 'inbound',
    weight: 1,
  }

  const scene = buildGraphSceneSnapshot(state)
  const edgesById = Object.fromEntries(
    scene.render.visibleEdges.map((edge) => [edge.id, edge]),
  )

  assert.equal(edgesById['root->alice:follow']?.color, '#5fd39d')
  assert.equal(edgesById['alice->root:inbound']?.color, '#5fd39d')
})

test('renders expanded nodes with the same base size as the root', () => {
  const state = createState()
  state.nodesByPubkey.alice = {
    ...state.nodesByPubkey.alice,
    isExpanded: true,
  }

  const scene = buildGraphSceneSnapshot(state)
  const nodesByPubkey = Object.fromEntries(
    scene.render.nodes.map((node) => [node.pubkey, node]),
  )

  assert.equal(nodesByPubkey.root?.size, 18)
  assert.equal(nodesByPubkey.alice?.size, 18)
})

test('keeps selection semantic while the renderer owns visual focus', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      selectedNodePubkey: 'alice',
    }),
  )

  const focusByPubkey = Object.fromEntries(
    scene.render.nodes.map((node) => [node.pubkey, node.focusState]),
  )
  const nodesByPubkey = Object.fromEntries(
    scene.render.nodes.map((node) => [node.pubkey, node]),
  )
  assert.equal(scene.render.selection.selectedNodePubkey, 'alice')
  assert.equal(nodesByPubkey.alice?.isSelected, true)
  assert.equal(focusByPubkey.alice, 'idle')
  assert.equal(focusByPubkey.root, 'root')
  assert.equal(focusByPubkey.bob, 'idle')
  assert.equal(nodesByPubkey.alice?.color, '#9da8c9')
  assert.equal(nodesByPubkey.alice?.size, 9)
  assert.equal(nodesByPubkey.bob?.color, '#8ebfc7')
  assert.equal(nodesByPubkey.bob?.size, 9)

  assert.deepEqual(
    scene.physics.edges.map((edge) => edge.id),
    ['alice->bob:follow', 'root->alice:follow', 'root->bob:follow'],
  )

  const visibleEdgesById = Object.fromEntries(
    scene.render.visibleEdges.map((edge) => [edge.id, edge]),
  )
  assert.equal(visibleEdgesById['root->alice:follow']?.touchesFocus, false)
  assert.equal(visibleEdgesById['root->bob:follow']?.isDimmed, false)
  assert.equal(visibleEdgesById['root->bob:follow']?.touchesFocus, false)
})

test('keeps root as the root focus state even when it is a depth-1 neighbor of the selection', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      selectedNodePubkey: 'alice',
    }),
  )
  const root = scene.render.nodes.find((node) => node.pubkey === 'root')
  assert.ok(root)
  assert.equal(root.focusState, 'root')
})

test('keeps the root fixed when it is pinned in the canonical state', () => {
  const scene = buildGraphSceneSnapshot(
    createState({
      pinnedNodePubkeys: new Set<string>(['root']),
    }),
  )

  const rootPhysicsNode = scene.physics.nodes.find((node) => node.pubkey === 'root')
  assert.ok(rootPhysicsNode)
  assert.equal(rootPhysicsNode.fixed, true)
  assert.deepEqual(scene.render.pins.pubkeys, ['root'])
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
  const carol = scene.render.nodes.find((node) => node.pubkey === 'carol')
  assert.ok(carol)
  assert.equal(carol.isPinned, true)
  assert.equal(carol.focusState, 'pinned')
})

test('does not dim visible edges from semantic selection alone', () => {
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
  const dimmed = scene.render.visibleEdges.find(
    (edge) => edge.id === 'carol->dave:follow',
  )
  assert.ok(dimmed)
  assert.equal(dimmed.isDimmed, false)
  assert.equal(dimmed.touchesFocus, false)
})
