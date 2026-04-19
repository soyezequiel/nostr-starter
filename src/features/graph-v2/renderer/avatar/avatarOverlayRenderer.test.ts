import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAvatarDrawRadiusPx,
  selectAvatarDrawContext,
  selectAvatarDrawItemsForFrame,
} from '@/features/graph-v2/renderer/avatar/avatarOverlayRenderer'

test('keeps the forced dragged avatar even when the frame cap is zero', () => {
  const items = [
    { pubkey: 'alice', priority: 10, r: 8 },
    { pubkey: 'bob', priority: 20, r: 8 },
  ]

  assert.deepEqual(selectAvatarDrawItemsForFrame(items, 0, new Set(['bob'])), [
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
    selectAvatarDrawItemsForFrame(items, 2, new Set(['dragged'])).map(
      (item) => item.pubkey,
    ),
    ['root', 'selected', 'dragged'],
  )
})

test('keeps every proximity-forced avatar outside the regular frame cap', () => {
  const items = [
    { pubkey: 'regular', priority: 0, r: 10 },
    { pubkey: 'near-a', priority: 30, r: 8 },
    { pubkey: 'near-b', priority: 40, r: 8 },
  ]

  assert.deepEqual(
    selectAvatarDrawItemsForFrame(
      items,
      0,
      new Set(['near-a', 'near-b']),
    ).map((item) => item.pubkey),
    ['near-a', 'near-b'],
  )
})

test('does not enlarge proximity-revealed avatars beyond the node radius', () => {
  assert.equal(
    resolveAvatarDrawRadiusPx({
      avatarRadiusPx: 4,
      hasPriorityAvatarSizing: false,
      zoomedOutMonogram: true,
    }),
    4,
  )
})

test('still enlarges the directly hovered avatar when it is tiny', () => {
  assert.equal(
    resolveAvatarDrawRadiusPx({
      avatarRadiusPx: 4,
      hasPriorityAvatarSizing: true,
      zoomedOutMonogram: true,
    }),
    18,
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
    selectAvatarDrawItemsForFrame(items, 0, new Set()).map(
      (item) => item.pubkey,
    ),
    ['root', 'pinned', 'selected'],
  )
})

test('draws the forced avatar on the forced context when available', () => {
  const labelContext = { name: 'labels' }
  const forcedContext = { name: 'mouse' }
  const forcedPubkeys = new Set(['alice'])

  assert.equal(
    selectAvatarDrawContext('alice', forcedPubkeys, labelContext, forcedContext),
    forcedContext,
  )
  assert.equal(
    selectAvatarDrawContext('bob', forcedPubkeys, labelContext, forcedContext),
    labelContext,
  )
  assert.equal(
    selectAvatarDrawContext('alice', forcedPubkeys, labelContext, null),
    labelContext,
  )
})
