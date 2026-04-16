import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  applyDragNeighborhoodInfluence,
  releaseDraggedNode,
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

test('applies less movement to second-hop neighbors and ignores nodes outside the radius', () => {
  const store = createStore()

  const beforeB = store.getNodePosition('B')
  const beforeC = store.getNodePosition('C')
  const beforeD = store.getNodePosition('D')

  assert.ok(beforeB)
  assert.ok(beforeC)
  assert.ok(beforeD)

  applyDragNeighborhoodInfluence(
    store,
    'A',
    new Map([
      ['A', 1],
      ['B', 0.45],
      ['C', 0.18],
    ]),
    4,
    -2,
  )

  assert.deepEqual(store.getNodePosition('B'), {
    x: beforeB.x + 1.8,
    y: beforeB.y - 0.9,
  })
  assert.deepEqual(store.getNodePosition('C'), {
    x: beforeC.x + 0.72,
    y: beforeC.y - 0.36,
  })
  assert.deepEqual(store.getNodePosition('D'), beforeD)
})

test('does not drag fixed neighbors through influence', () => {
  const store = createStore()
  const beforeB = store.getNodePosition('B')

  assert.ok(beforeB)

  store.setNodeFixed('B', true)
  applyDragNeighborhoodInfluence(
    store,
    'A',
    new Map([
      ['A', 1],
      ['B', 0.45],
    ]),
    3,
    2,
  )

  assert.deepEqual(store.getNodePosition('B'), beforeB)
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
