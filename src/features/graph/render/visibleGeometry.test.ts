import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphRenderNode } from './types'
import { getVisibleArrowPlacement, getZoomResponsiveNodeSizeFactor } from './visibleGeometry'

const createArrowTestContext = () => ({
  nodeByPubkey: new Map<string, GraphRenderNode>(),
  nodeScreenRadii: new Map<string, number>(),
  nodeSizeFactor: 1,
  viewState: { zoom: 0 },
})

test('keeps node size unchanged at close and default zoom levels', () => {
  assert.equal(
    getZoomResponsiveNodeSizeFactor({ nodeSizeFactor: 0.88, zoom: 1 }),
    0.88,
  )
  assert.equal(
    getZoomResponsiveNodeSizeFactor({ nodeSizeFactor: 0.88, zoom: 3 }),
    0.88,
  )
})

test('shrinks nodes smoothly as the user zooms far out', () => {
  const midOverviewFactor = getZoomResponsiveNodeSizeFactor({
    nodeSizeFactor: 0.88,
    zoom: 0,
  })
  const farOverviewFactor = getZoomResponsiveNodeSizeFactor({
    nodeSizeFactor: 0.88,
    zoom: -2,
  })

  assert.ok(midOverviewFactor < 0.88)
  assert.ok(farOverviewFactor < midOverviewFactor)
  assert.ok(farOverviewFactor > 0)
})

test('places the arrowhead in the direction of a vertical edge vector', () => {
  const placement = getVisibleArrowPlacement({
    segment: {
      id: 'a-b',
      source: 'a',
      target: 'b',
      sourcePosition: [0, 0],
      targetPosition: [0, 10],
      relation: 'follow',
      weight: 1,
      isPriority: false,
      targetSharedByExpandedCount: 0,
      progressStart: 0.2,
      progressEnd: 0.8,
    },
    context: createArrowTestContext(),
  })

  assert.equal(placement.angle, -90)
  assert.deepEqual(placement.position, [0, 13])
})

