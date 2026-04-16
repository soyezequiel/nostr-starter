import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectedGraph } from 'graphology'

import {
  buildDragHopDistances,
  DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
} from '@/features/graph-v2/renderer/dragNeighborhood'

const createGraph = () => {
  const graph = new DirectedGraph()

  for (const pubkey of ['A', 'B', 'C', 'D', 'E', 'F']) {
    graph.addNode(pubkey)
  }

  graph.addDirectedEdgeWithKey('A->B', 'A', 'B')
  graph.addDirectedEdgeWithKey('B->C', 'B', 'C')
  graph.addDirectedEdgeWithKey('C->D', 'C', 'D')
  graph.addDirectedEdgeWithKey('E->B', 'E', 'B')
  graph.addDirectedEdgeWithKey('A->F', 'A', 'F')

  return graph
}

test('assigns shortest hop distance from the drag source', () => {
  const distances = buildDragHopDistances(createGraph(), 'A')

  assert.equal(distances.get('A'), 0)
  assert.equal(distances.get('B'), 1)
  assert.equal(distances.get('F'), 1)
  assert.equal(distances.get('C'), 2)
  assert.equal(distances.get('E'), 2)
  assert.equal(distances.get('D'), 3)
})

test('does not duplicate nodes when multiple paths reach the same neighbor', () => {
  const graph = createGraph()
  graph.addDirectedEdgeWithKey('F->C', 'F', 'C')

  const distances = buildDragHopDistances(graph, 'A')
  const entriesForC = Array.from(distances.entries()).filter(
    ([pubkey]) => pubkey === 'C',
  )

  assert.equal(entriesForC.length, 1)
  assert.equal(distances.get('C'), 2)
})

test('traversal has no hard weight cutoff — deep neighbors are still included', () => {
  const graph = createGraph()

  for (const pubkey of ['G', 'H', 'I', 'J']) {
    graph.addNode(pubkey)
  }

  graph.addDirectedEdgeWithKey('D->G', 'D', 'G')
  graph.addDirectedEdgeWithKey('G->H', 'G', 'H')
  graph.addDirectedEdgeWithKey('H->I', 'H', 'I')
  graph.addDirectedEdgeWithKey('I->J', 'I', 'J')

  const distances = buildDragHopDistances(graph, 'A')

  assert.equal(distances.get('G'), 4)
  assert.equal(distances.get('H'), 5)
  assert.equal(distances.get('I'), 6)
  assert.equal(distances.get('J'), 7)
})

test('respects max hop distance when it is tight enough to clip the frontier', () => {
  const graph = createGraph()

  const distances = buildDragHopDistances(graph, 'A', {
    ...DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
    maxHopDistance: 2,
  })

  assert.equal(distances.get('A'), 0)
  assert.equal(distances.get('B'), 1)
  assert.equal(distances.get('C'), 2)
  assert.equal(distances.has('D'), false)
})

test('returns an empty map when the source node is missing', () => {
  const distances = buildDragHopDistances(createGraph(), 'Z')

  assert.equal(distances.size, 0)
})
