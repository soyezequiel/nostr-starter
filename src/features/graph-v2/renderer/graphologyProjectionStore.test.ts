import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (
  edgeId: string,
  activeLayer: GraphSceneSnapshot['diagnostics']['activeLayer'] = 'graph',
): GraphSceneSnapshot => ({
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
  ],
  visibleEdges: [
    {
      id: edgeId,
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
    activeLayer,
    nodeCount: 2,
    visibleEdgeCount: 1,
    forceEdgeCount: 0,
    relayCount: 0,
    isGraphStale: false,
    topologySignature: edgeId,
  },
})

test('replaces an existing directed pair when the incoming edge key changes', () => {
  const store = new GraphologyProjectionStore()

  store.applyScene(createScene('inbound:A:B'))
  store.applyScene(createScene('follow:A:B'))

  const graph = store.getGraph()

  assert.equal(graph.order, 2)
  assert.equal(graph.size, 1)
  assert.equal(graph.directedEdge('A', 'B'), 'follow:A:B')
  assert.equal(graph.hasEdge('inbound:A:B'), false)
  assert.equal(graph.hasEdge('follow:A:B'), true)
})

test('preserves node attribute object identity when scene attributes do not change', () => {
  const store = new GraphologyProjectionStore()
  const scene = createScene('follow:A:B')

  store.applyScene(scene)
  const graph = store.getGraph()
  const firstNodeAttributes = graph.getNodeAttributes('A')
  const firstEdgeAttributes = graph.getEdgeAttributes('follow:A:B')

  store.applyScene(scene)

  assert.equal(graph.getNodeAttributes('A'), firstNodeAttributes)
  assert.equal(graph.getEdgeAttributes('follow:A:B'), firstEdgeAttributes)
})

test('translates node positions without changing their fixed state', () => {
  const store = new GraphologyProjectionStore()
  store.applyScene(createScene('follow:A:B'))

  store.setNodeFixed('A', true)
  store.translateNodePosition('A', 3, -2)

  assert.deepEqual(store.getNodePosition('A'), { x: 7, y: -2 })
  assert.equal(store.isNodeFixed('A'), true)
})

test('reuses node positions across layers for continuous transitions', () => {
  const store = new GraphologyProjectionStore()

  store.applyScene(createScene('follow:A:B', 'graph'))
  store.setNodePosition('B', 10, 10)

  store.applyScene(createScene('follow:A:B', 'connections'))
  store.setNodePosition('B', 100, 100)

  store.applyScene(createScene('follow:A:B', 'graph'))

  assert.deepEqual(store.getNodePosition('B'), { x: 100, y: 100 })
})

test('projects selected neighborhoods into prominent sigma attributes', () => {
  const store = new GraphologyProjectionStore()
  const scene = createScene('follow:A:B')
  scene.nodes = scene.nodes.map((node) =>
    node.pubkey === 'A'
      ? {
          ...node,
          color: '#ffb25b',
          size: 18,
          isSelected: true,
          focusState: 'selected',
        }
      : {
          ...node,
          color: '#f8f2a2',
          size: 13,
          isNeighbor: true,
          focusState: 'neighbor',
        },
  )
  scene.visibleEdges = scene.visibleEdges.map((edge) => ({
    ...edge,
    color: '#f4fbff',
    size: 2.7,
    touchesFocus: true,
  }))

  store.applyScene(scene)

  const graph = store.getGraph()
  const selected = graph.getNodeAttributes('A')
  const neighbor = graph.getNodeAttributes('B')
  const edge = graph.getEdgeAttributes('follow:A:B')

  assert.equal(selected.highlighted, true)
  assert.equal(selected.forceLabel, true)
  assert.equal(selected.zIndex, 8)
  assert.equal(neighbor.highlighted, true)
  assert.equal(neighbor.forceLabel, true)
  assert.equal(neighbor.zIndex, 5)
  assert.equal(edge.touchesFocus, true)
  assert.equal(edge.zIndex, 6)
})

test('does not promote semantic selection without visual focus state', () => {
  const store = new GraphologyProjectionStore()
  const scene = createScene('follow:A:B')
  scene.nodes = scene.nodes.map((node) =>
    node.pubkey === 'B'
      ? {
          ...node,
          isSelected: true,
          focusState: 'idle',
        }
      : node,
  )
  scene.selection = {
    selectedNodePubkey: 'B',
    hoveredNodePubkey: null,
  }

  store.applyScene(scene)

  const semanticSelection = store.getGraph().getNodeAttributes('B')

  assert.equal(semanticSelection.isSelected, true)
  assert.equal(semanticSelection.highlighted, false)
  assert.equal(semanticSelection.forceLabel, false)
  assert.equal(semanticSelection.zIndex, 0)
})
