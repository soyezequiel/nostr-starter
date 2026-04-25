import assert from 'node:assert/strict'
import test from 'node:test'

import { createDragLocalFixture } from '@/features/graph-v2/testing/fixtures/dragLocalFixture'

test('creates a 40-node drag lab fixture with one pinned neighbor', () => {
  const fixture = createDragLocalFixture()

  assert.equal(Object.keys(fixture.state.nodesByPubkey).length, 40)
  assert.equal(fixture.state.pinnedNodePubkeys.size, 1)
  assert.ok(fixture.state.nodesByPubkey[fixture.dragTargetPubkey])
  assert.ok(fixture.state.nodesByPubkey[fixture.pinnedNeighborPubkey])
  assert.ok(fixture.state.pinnedNodePubkeys.has(fixture.pinnedNeighborPubkey))
})
