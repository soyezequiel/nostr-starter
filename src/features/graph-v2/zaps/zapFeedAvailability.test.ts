import assert from 'node:assert/strict'
import test from 'node:test'

import { canRunZapFeedForScene } from './zapFeedAvailability'

test('allows live and recent zap feeds while viewing connections', () => {
  assert.equal(
    canRunZapFeedForScene({
      showZaps: true,
      isFixtureMode: false,
      activeLayer: 'connections',
    }),
    true,
  )
})

test('keeps fixture mode and hidden zaps from starting feeds', () => {
  assert.equal(
    canRunZapFeedForScene({
      showZaps: true,
      isFixtureMode: true,
      activeLayer: 'connections',
    }),
    false,
  )
  assert.equal(
    canRunZapFeedForScene({
      showZaps: false,
      isFixtureMode: false,
      activeLayer: 'connections',
    }),
    false,
  )
})
