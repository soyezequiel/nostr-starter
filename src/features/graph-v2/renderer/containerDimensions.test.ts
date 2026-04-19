import assert from 'node:assert/strict'
import test from 'node:test'

import { hasRenderableSigmaContainer } from './containerDimensions'

test('requires positive Sigma container dimensions', () => {
  assert.equal(hasRenderableSigmaContainer(null), false)
  assert.equal(hasRenderableSigmaContainer(undefined), false)
  assert.equal(hasRenderableSigmaContainer({ offsetWidth: 0, offsetHeight: 640 }), false)
  assert.equal(hasRenderableSigmaContainer({ offsetWidth: 800, offsetHeight: 0 }), false)
  assert.equal(hasRenderableSigmaContainer({ offsetWidth: 800, offsetHeight: 640 }), true)
})
