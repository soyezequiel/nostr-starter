import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  createDragNeighborhoodInfluenceState,
  DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  releaseDraggedNode,
  stepDragNeighborhoodInfluence,
} from '@/features/graph-v2/renderer/dragInfluence'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (): GraphSceneSnapshot => ({
  nodes: [
    {
      pubkey: 'A',
      label: 'A',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: true,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'root',
    },
    {
      pubkey: 'B',
      label: 'B',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: false,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'idle',
    },
    {
      pubkey: 'C',
      label: 'C',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: false,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'idle',
    },
    {
      pubkey: 'D',
      label: 'D',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: false,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'idle',
    },
    {
      pubkey: 'E',
      label: 'E',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: false,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'idle',
    },
    {
      pubkey: 'F',
      label: 'F',
      pictureUrl: null,
      color: '#fff',
      size: 10,
      isRoot: false,
      isSelected: false,
      isPinned: false,
      isNeighbor: false,
      isDimmed: false,
      focusState: 'idle',
    },
  ],
  visibleEdges: [
    {
      id: 'follow:A:B',
      source: 'A',
      target: 'B',
      color: '#8fb6ff',
      size: 1,
      hidden: false,
      relation: 'follow',
      weight: 1,
      isDimmed: false,
      touchesFocus: false,
    },
    {
      id: 'follow:B:C',
      source: 'B',
      target: 'C',
      color: '#8fb6ff',
      size: 1,
      hidden: false,
      relation: 'follow',
      weight: 1,
      isDimmed: false,
      touchesFocus: false,
    },
    {
      id: 'follow:D:E',
      source: 'D',
      target: 'E',
      color: '#8fb6ff',
      size: 1,
      hidden: false,
      relation: 'follow',
      weight: 1,
      isDimmed: false,
      touchesFocus: false,
    },
    {
      id: 'follow:C:F',
      source: 'C',
      target: 'F',
      color: '#8fb6ff',
      size: 1,
      hidden: false,
      relation: 'follow',
      weight: 1,
      isDimmed: false,
      touchesFocus: false,
    },
  ],
  forceEdges: [],
  labels: [],
  selection: {
    selectedNodePubkey: null,
    hoveredNodePubkey: null,
  },
  pins: {
    pubkeys: [],
  },
  cameraHint: {
    focusPubkey: null,
    rootPubkey: 'A',
  },
  diagnostics: {
    activeLayer: 'graph',
    nodeCount: 6,
    visibleEdgeCount: 4,
    forceEdgeCount: 0,
    relayCount: 0,
    isGraphStale: false,
    topologySignature: 'drag-influence-scene',
  },
})

const createStore = () => {
  const store = new GraphologyProjectionStore()
  store.applyScene(createScene())
  // Place nodes on a predictable line so rest lengths are deterministic.
  store.setNodePosition('A', 0, 0)
  store.setNodePosition('B', 10, 0)
  store.setNodePosition('C', 20, 0)
  store.setNodePosition('F', 30, 0)
  store.setNodePosition('D', 200, 200) // disconnected component, unreachable from A
  store.setNodePosition('E', 210, 200)
  return store
}

test('collects hop-connected nodes and builds spring edges between them', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['F', 3],
    ]),
  )

  assert.equal(state.nodes.size, 3)
  assert.ok(state.nodes.has('B'))
  assert.ok(state.nodes.has('C'))
  assert.ok(state.nodes.has('F'))
  // Spring edges between every consecutive pair included in the set.
  const edgePairs = state.edges.map(
    (edge) =>
      [edge.sourcePubkey, edge.targetPubkey].sort().join('::'),
  )
  assert.ok(edgePairs.includes('A::B'))
  assert.ok(edgePairs.includes('B::C'))
  assert.ok(edgePairs.includes('C::F'))
  // Rest lengths equal the initial geometric distance.
  const edgeAB = state.edges.find(
    (edge) =>
      (edge.sourcePubkey === 'A' && edge.targetPubkey === 'B') ||
      (edge.sourcePubkey === 'B' && edge.targetPubkey === 'A'),
  )
  assert.ok(edgeAB)
  assert.equal(Math.round(edgeAB!.restLength), 10)
})

test('chain propagation: closer neighbors move more than distant ones, with smooth decay', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['F', 3],
    ]),
  )

  const beforeB = store.getNodePosition('B')!
  const beforeC = store.getNodePosition('C')!
  const beforeF = store.getNodePosition('F')!

  // Pin A somewhere far.
  store.setNodePosition('A', 40, 0, true)

  for (let index = 0; index < 8; index += 1) {
    stepDragNeighborhoodInfluence(
      store,
      'A',
      state,
      16,
      DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
    )
  }

  const afterB = store.getNodePosition('B')!
  const afterC = store.getNodePosition('C')!
  const afterF = store.getNodePosition('F')!

  const bDisplacement = Math.hypot(afterB.x - beforeB.x, afterB.y - beforeB.y)
  const cDisplacement = Math.hypot(afterC.x - beforeC.x, afterC.y - beforeC.y)
  const fDisplacement = Math.hypot(afterF.x - beforeF.x, afterF.y - beforeF.y)

  assert.ok(bDisplacement > cDisplacement)
  assert.ok(cDisplacement > fDisplacement)
  assert.ok(fDisplacement > 0)
})

test('leaves disconnected nodes untouched even when they are in the hop map', () => {
  const store = createStore()
  // D is in a separate component; the spring network has no edges to it.
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['D', 1],
    ]),
  )

  const beforeD = store.getNodePosition('D')!
  store.setNodePosition('A', 80, 0, true)

  for (let index = 0; index < 6; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  const afterD = store.getNodePosition('D')!
  // D has anchor force only (no edge force) — it should stay near its initial
  // position because it starts at rest.
  assert.equal(afterD.x, beforeD.x)
  assert.equal(afterD.y, beforeD.y)
})

test('keeps fixed neighbors untouched while the chain around them flexes', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]),
  )
  const beforeB = store.getNodePosition('B')!
  const beforeC = store.getNodePosition('C')!

  store.setNodeFixed('B', true)
  store.setNodePosition('A', 60, 0, true)

  for (let index = 0; index < 10; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  assert.deepEqual(store.getNodePosition('B'), beforeB)
  assert.notDeepEqual(store.getNodePosition('C'), beforeC)
  assert.equal(store.isNodeFixed('B'), true)
})

test('releases the dragged node back to unfixed when it was not pinned', () => {
  const store = createStore()

  store.setNodeFixed('A', true)
  releaseDraggedNode(store, 'A', [])

  assert.equal(store.isNodeFixed('A'), false)
})

test('keeps the dragged node fixed after release when it remains pinned', () => {
  const store = createStore()

  store.setNodeFixed('A', true)
  releaseDraggedNode(store, 'A', ['A'])

  assert.equal(store.isNodeFixed('A'), true)
})
