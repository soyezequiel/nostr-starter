import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveProportionalNodeLabelSize } from '@/features/graph-v2/renderer/cachedNodeLabels'

test('scales node labels proportionally to rendered node size', () => {
  const defaultLabelSize = 14

  assert.equal(resolveProportionalNodeLabelSize(9, defaultLabelSize), 10)
  assert.equal(resolveProportionalNodeLabelSize(12, defaultLabelSize), 12.6)
  assert.equal(resolveProportionalNodeLabelSize(18, defaultLabelSize), 18.9)
})

test('keeps proportional node labels inside readable bounds', () => {
  assert.equal(resolveProportionalNodeLabelSize(2, 14), 10)
  assert.equal(resolveProportionalNodeLabelSize(80, 14), 24)
})
