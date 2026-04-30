import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveActivityOverlayCssPosition } from '@/features/graph-v2/ui/activityOverlayPosition'

test('activity overlay uses Sigma viewport coordinates as CSS pixels', () => {
  const adapter = {
    getViewportPosition: (pubkey: string) =>
      pubkey === 'alice' ? { x: 240, y: 160 } : null,
  }

  assert.deepEqual(resolveActivityOverlayCssPosition(adapter, 'alice'), {
    x: 240,
    y: 160,
  })
  assert.equal(resolveActivityOverlayCssPosition(adapter, 'unknown'), null)
})
