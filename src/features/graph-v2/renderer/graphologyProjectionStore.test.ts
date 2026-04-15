import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (edgeId: string): GraphSceneSnapshot => ({
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
