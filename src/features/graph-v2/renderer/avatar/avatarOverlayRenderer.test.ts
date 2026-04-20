import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
} from '@/features/graph-v2/renderer/avatar/types'
import {
  resolveAvatarCacheCap,
  resolveAvatarFrameDrawCap,
  resolveAvatarDrawRadiusPx,
  resolveAvatarImageDisableReason,
  resolveAvatarLoadConcurrency,
  retainInflightAvatarPubkeys,
  selectAvatarDrawContext,
  selectAvatarDrawItemsForFrame,
  selectClosestAvatarRevealPubkeys,
  shouldDisableAvatarImage,
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

test('caps proximity reveal pubkeys to the closest nodes before forcing avatars', () => {
  const candidates = [
    { pubkey: 'near-b', distanceSquared: 16 },
    { pubkey: 'far', distanceSquared: 81 },
    { pubkey: 'near-a', distanceSquared: 9 },
  ]

  assert.deepEqual(
    selectClosestAvatarRevealPubkeys(candidates, 2),
    ['near-a', 'near-b'],
  )
})

test('uses pubkey order as a deterministic tie breaker for proximity reveal', () => {
  const candidates = [
    { pubkey: 'charlie', distanceSquared: 16 },
    { pubkey: 'alice', distanceSquared: 16 },
    { pubkey: 'bob', distanceSquared: 16 },
  ]

  assert.deepEqual(selectClosestAvatarRevealPubkeys(candidates, 2), [
    'alice',
    'bob',
  ])
})

test('retains visible inflight avatars even when the current frame cap drops them', () => {
  const retained = retainInflightAvatarPubkeys(
    [
      { pubkey: 'root', url: 'https://example.com/root.png' },
      { pubkey: 'alice', url: 'https://example.com/alice.png' },
      { pubkey: 'bob', url: null },
    ],
    new Set(['root']),
    (urlKey) => urlKey === 'alice::https://example.com/alice.png',
  )

  assert.deepEqual([...retained], ['root', 'alice'])
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

test('global graph or camera motion degrades image avatars to monograms', () => {
  assert.equal(
    shouldDisableAvatarImage({
      selectedForImage: true,
      globalMotionActive: true,
      monogramOnly: false,
      fastMoving: false,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    }),
    true,
  )
})

test('fast node motion degrades image avatars to monograms', () => {
  assert.equal(
    shouldDisableAvatarImage({
      selectedForImage: true,
      globalMotionActive: false,
      monogramOnly: false,
      fastMoving: true,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    }),
    true,
  )
})

test('image draw cap degrades remaining avatars to monograms', () => {
  assert.equal(
    shouldDisableAvatarImage({
      selectedForImage: true,
      globalMotionActive: false,
      monogramOnly: false,
      fastMoving: false,
      imageDrawCount: 12,
      maxImageDrawsPerFrame: 12,
    }),
    true,
  )
})

test('avatar image disable reason reports the first blocking condition', () => {
  assert.equal(
    resolveAvatarImageDisableReason({
      selectedForImage: false,
      globalMotionActive: true,
      monogramOnly: false,
      fastMoving: false,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    }),
    'not_selected_for_image',
  )
  assert.equal(
    resolveAvatarImageDisableReason({
      selectedForImage: true,
      globalMotionActive: false,
      monogramOnly: false,
      fastMoving: false,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    }),
    null,
  )
})

test('all visible photos mode lifts frame draw caps to the visible count', () => {
  assert.equal(
    resolveAvatarFrameDrawCap({
      baseCap: 120,
      visibleCount: 232,
      showAllVisibleImages: true,
    }),
    232,
  )
  assert.equal(
    resolveAvatarFrameDrawCap({
      baseCap: 120,
      visibleCount: 232,
      showAllVisibleImages: false,
    }),
    120,
  )
})

test('all visible photos mode expands cache cap to the visible photo count', () => {
  assert.equal(
    resolveAvatarCacheCap({
      baseCap: 128,
      visiblePhotoCount: 221,
      showAllVisibleImages: true,
    }),
    221,
  )
  assert.equal(
    resolveAvatarCacheCap({
      baseCap: 128,
      visiblePhotoCount: 221,
      showAllVisibleImages: false,
    }),
    128,
  )
})

test('all visible photos mode preserves degraded load concurrency when disabled', () => {
  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 1,
      visiblePhotoCount: 505,
      showAllVisibleImages: false,
    }),
    1,
  )
})

test('all visible photos mode raises effective load concurrency to the floor', () => {
  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 1,
      visiblePhotoCount: 505,
      showAllVisibleImages: true,
    }),
    6,
  )
})

test('all visible photos mode caps effective load concurrency', () => {
  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 12,
      visiblePhotoCount: 505,
      showAllVisibleImages: true,
    }),
    8,
  )
})

test('all visible photos mode does not invent load slots beyond visible photos', () => {
  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 1,
      visiblePhotoCount: 3,
      showAllVisibleImages: true,
    }),
    3,
  )
  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 1,
      visiblePhotoCount: 0,
      showAllVisibleImages: true,
    }),
    0,
  )
})

test('avatar runtime defaults keep all visible photos on and saver modes off', () => {
  assert.equal(DEFAULT_AVATAR_RUNTIME_OPTIONS.showAllVisibleImages, true)
  assert.equal(DEFAULT_AVATAR_RUNTIME_OPTIONS.hideImagesOnFastNodes, false)
})
