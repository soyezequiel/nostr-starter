import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectedGraph } from 'graphology'

import {
  buildDragNeighborhoodWeights,
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

test('assigns weights by shortest-hop distance including the drag source', () => {
  const weights = buildDragNeighborhoodWeights(createGraph(), 'A')

  assert.equal(weights.get('A'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[0])
  assert.equal(weights.get('B'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[1])
  assert.equal(weights.get('F'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[1])
  assert.equal(weights.get('C'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[2])
  assert.equal(weights.get('E'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[2])
})

test('does not include nodes beyond the configured neighborhood radius', () => {
  const weights = buildDragNeighborhoodWeights(createGraph(), 'A')

  assert.equal(weights.has('D'), false)
})

test('does not duplicate nodes when multiple paths reach the same neighbor', () => {
  const graph = createGraph()
  graph.addDirectedEdgeWithKey('F->C', 'F', 'C')

  const weights = buildDragNeighborhoodWeights(graph, 'A')
  const entriesForC = Array.from(weights.entries()).filter(([pubkey]) => pubkey === 'C')

  assert.equal(entriesForC.length, 1)
  assert.equal(weights.get('C'), DEFAULT_DRAG_NEIGHBORHOOD_CONFIG.weightsByDepth[2])
})

test('returns an empty map when the source node is missing', () => {
  const weights = buildDragNeighborhoodWeights(createGraph(), 'Z')

  assert.equal(weights.size, 0)
})
