import assert from 'node:assert/strict'
import test from 'node:test'

import { selectAvatarDrawItemsForFrame } from '@/features/graph-v2/renderer/avatar/avatarOverlayRenderer'

test('keeps the forced dragged avatar even when the frame cap is zero', () => {
  const items = [
    { pubkey: 'alice', priority: 10, r: 8 },
    { pubkey: 'bob', priority: 20, r: 8 },
  ]

  assert.deepEqual(selectAvatarDrawItemsForFrame(items, 0, 'bob'), [
    { pubkey: 'bob', priority: 20, r: 8 },
  ])
})

test('draws the forced dragged avatar after budgeted regular avatars', () => {
  const items = [
    { pubkey: 'far', priority: 30, r: 20 },
    { pubkey: 'dragged', priority: 50, r: 6 },
    { pubkey: 'root', priority: 0, r: 10 },
    { pubkey: 'selected', priority: 1, r: 12 },
  ]

  assert.deepEqual(
    selectAvatarDrawItemsForFrame(items, 2, 'dragged').map(
      (item) => item.pubkey,
    ),
    ['root', 'selected', 'dragged'],
  )
})

test('keeps only direct persistent avatars outside the regular frame cap', () => {
  const items = [
    { pubkey: 'indirect-neighbor', priority: 2, r: 18 },
    { pubkey: 'far', priority: 30, r: 20 },
    { pubkey: 'root', priority: 0, r: 10, isPersistentAvatar: true },
    { pubkey: 'pinned', priority: 1, r: 8, isPersistentAvatar: true },
    { pubkey: 'selected', priority: 2, r: 12, isPersistentAvatar: true },
  ]

  assert.deepEqual(
    selectAvatarDrawItemsForFrame(items, 0, null).map((item) => item.pubkey),
    ['root', 'pinned', 'selected'],
  )
})
