import assert from 'node:assert/strict'
import test from 'node:test'

import { buildArrowMarkerData } from './arrowMarkers'
import type { GraphEdgeSegment } from './graphSceneGeometry'

const createSegment = (
  overrides: Partial<GraphEdgeSegment> = {},
): GraphEdgeSegment => ({
  id: 'a-b:follow',
  source: 'a',
  target: 'b',
  sourcePosition: [0, 0],
  targetPosition: [10, 0],
  relation: 'follow',
  weight: 0,
  isPriority: false,
  targetSharedByExpandedCount: 0,
  progressStart: 0,
  progressEnd: 1,
  ...overrides,
})

test('uses one directional marker at the end of a one-way edge', () => {
  const markers = buildArrowMarkerData({
    segments: [createSegment({ progressStart: 0.8, progressEnd: 1 })],
    arrowType: 'triangle',
  })

  assert.deepEqual(markers.map((marker) => marker.arrowIcon), ['triangle'])
})

test('uses a single bidirectional marker for a mutual edge', () => {
  const markers = buildArrowMarkerData({
    segments: [
      createSegment({
        id: 'a-b:mutual',
        isBidirectional: true,
        progressStart: 0.4,
        progressEnd: 0.6,
      }),
      createSegment({
        id: 'a-b:mutual',
        isBidirectional: true,
        progressStart: 0.9,
        progressEnd: 1,
      }),
    ],
    arrowType: 'chevron',
  })

  assert.equal(markers.length, 1)
  assert.equal(markers[0].arrowIcon, 'chevron-bidirectional')
  assert.equal(markers[0].progressStart, 0.4)
  assert.equal(markers[0].progressEnd, 0.6)
})
