import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  clampInfluenceDelta,
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
    nodeCount: 5,
    visibleEdgeCount: 3,
    forceEdgeCount: 0,
    relayCount: 0,
    isGraphStale: false,
    topologySignature: 'drag-influence-scene',
  },
})

const createStore = () => {
  const store = new GraphologyProjectionStore()
  store.applyScene(createScene())
  return store
}

test('clamps oversized influence deltas', () => {
  assert.equal(clampInfluenceDelta(40, 1), 12)
  assert.equal(clampInfluenceDelta(-40, 1), -12)
  assert.equal(clampInfluenceDelta(10, 0.2), 2)
})

test('depth-1 neighbors converge faster than depth-2 and outside nodes stay still', () => {
  const store = createStore()
  const influenceState = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 1],
      ['B', 0.45],
      ['C', 0.18],
    ]),
  )
  const beforeB = store.getNodePosition('B')
  const beforeC = store.getNodePosition('C')
  const beforeD = store.getNodePosition('D')

  assert.ok(beforeB)
  assert.ok(beforeC)
  assert.ok(beforeD)

  store.setNodePosition('A', 18, -6, true)

  let firstStep = stepDragNeighborhoodInfluence(
    store,
    'A',
    influenceState,
    16,
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  )

  assert.equal(firstStep.translated, true)
  assert.equal(firstStep.active, true)

  for (let index = 0; index < 4; index += 1) {
    firstStep = stepDragNeighborhoodInfluence(
      store,
      'A',
      influenceState,
      16,
      DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
    )
  }

  const afterB = store.getNodePosition('B')
  const afterC = store.getNodePosition('C')
  const afterD = store.getNodePosition('D')

  assert.ok(afterB)
  assert.ok(afterC)
  assert.ok(afterD)

  const bDisplacement = Math.hypot(afterB.x - beforeB.x, afterB.y - beforeB.y)
  const cDisplacement = Math.hypot(afterC.x - beforeC.x, afterC.y - beforeC.y)
  const dDisplacement = Math.hypot(afterD.x - beforeD.x, afterD.y - beforeD.y)

  assert.ok(bDisplacement > cDisplacement * 1.45)
  assert.ok(cDisplacement > 0)
  assert.deepEqual(afterD, beforeD)
  assert.equal(dDisplacement, 0)
})

test('keeps fixed neighbors untouched while other neighbors keep springing', () => {
  const store = createStore()
  const influenceState = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 1],
      ['B', 0.45],
      ['C', 0.18],
    ]),
  )
  const beforeB = store.getNodePosition('B')
  const beforeC = store.getNodePosition('C')

  assert.ok(beforeB)
  assert.ok(beforeC)

  store.setNodeFixed('B', true)
  store.setNodePosition('A', 12, 8, true)

  for (let index = 0; index < 6; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', influenceState, 16)
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
