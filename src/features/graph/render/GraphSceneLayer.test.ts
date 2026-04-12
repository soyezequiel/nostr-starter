import assert from 'node:assert/strict'
import test from 'node:test'

import { buildArrowMarkerData } from './GraphSceneLayer'
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

test('uses a dedicated bidirectional marker for mutual segments', () => {
  const arrowData = buildArrowMarkerData({
    segments: [
      createSegment({
        progressStart: 0.4,
        progressEnd: 0.6,
        isBidirectional: true,
      }),
    ],
    arrowType: 'triangle',
  })

  assert.equal(arrowData.length, 1)
  assert.equal(arrowData[0].arrowIcon, 'triangle-bidirectional')
})

test('keeps single-direction arrowheads for non-mutual segments', () => {
  const arrowData = buildArrowMarkerData({
    segments: [createSegment()],
    arrowType: 'chevron',
  })

  assert.equal(arrowData.length, 1)
  assert.equal(arrowData[0].arrowIcon, 'chevron')
})
