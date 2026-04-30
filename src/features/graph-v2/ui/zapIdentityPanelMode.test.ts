import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveZapIdentityPanelMode } from '@/features/graph-v2/ui/zapIdentityPanelMode'

test('resolveZapIdentityPanelMode opens the native identity only when the pubkey is rendered in the current scene', () => {
  const mode = resolveZapIdentityPanelMode({
    pubkey: 'alice',
    renderedNodePubkeys: new Set(['alice', 'bob']),
  })

  assert.equal(mode, 'scene')
})

test('resolveZapIdentityPanelMode treats a canonical-but-hidden identity as off-graph for the current scene', () => {
  const mode = resolveZapIdentityPanelMode({
    pubkey: 'alice',
    renderedNodePubkeys: new Set(['bob']),
  })

  assert.equal(mode, 'off-graph')
})
