import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
} from '@/features/graph-v2/renderer/avatar/types'
import {
  createAvatarOverlayFrameViewport,
  createAvatarUrlMetadataResolver,
  isAvatarInViewport,
  retainAvatarDrawItemsForFrame,
  resolveAvatarDrawPriority,
  resolveAvatarCacheCap,
  resolveAvatarCacheRetentionMode,
  resolveAvatarFrameDrawCap,
  resolveAvatarGlobalMotionActive,
  resolveAvatarDrawRadiusPx,
  resolveAvatarImageDisableReason,
  resolveAvatarItemGlobalMotionActive,
  resolveAvatarCandidateMaxBucket,
  resolveAvatarLoadConcurrency,
  resolveAvatarRequestedPixels,
  resolveEffectiveShowAllVisibleImages,
  resolveFastNodeVelocityThresholdPx,
  retainInflightAvatarPubkeys,
  scheduleAvatarOverlayRender,
  selectAvatarDrawContext,
  selectAvatarDrawItemsForFrame,
  shouldDrawAvatarForRendererFocus,
  shouldDisableAvatarImage,
} from '@/features/graph-v2/renderer/avatar/avatarOverlayRenderer'

test('avatar frame viewport caches container dimensions for hot-path helpers', () => {
  let widthReads = 0
  let heightReads = 0
  const viewport = createAvatarOverlayFrameViewport({
    get clientWidth() {
      widthReads += 1
      return 300
    },
    get clientHeight() {
      heightReads += 1
      return 200
    },
  })

  assert.deepEqual(viewport, {
    width: 300,
    height: 200,
    centerX: 150,
    centerY: 100,
  })
  assert.equal(isAvatarInViewport(0, 0, 8, viewport), true)
  assert.equal(isAvatarInViewport(-20, 0, 8, viewport), false)
  assert.equal(
    resolveAvatarDrawPriority({}, { x: 153, y: 104 }, viewport),
    10,
  )
  assert.equal(
    resolveAvatarDrawPriority({ isRoot: true }, { x: 0, y: 0 }, viewport),
    0,
  )
  assert.equal(widthReads, 1)
  assert.equal(heightReads, 1)
})

test('avatar overlay expansion animation requests render without full refresh', () => {
  let renderCalls = 0
  let refreshCalls = 0

  const sigma = {
    scheduleRender: () => {
      renderCalls += 1
    },
    refresh: () => {
      refreshCalls += 1
    },
  }

  scheduleAvatarOverlayRender(sigma)

  assert.equal(renderCalls, 1)
  assert.equal(refreshCalls, 0)
})

test('avatar URL metadata resolver caches and caps parsed URL metadata', () => {
  const resolver = createAvatarUrlMetadataResolver(2)
  const first = resolver.resolve('alice', 'https://example.com/a.png')
  const second = resolver.resolve('alice', 'https://example.com/a.png')

  assert.equal(first, second)
  assert.equal(first.hasPictureUrl, true)
  assert.equal(first.hasSafePictureUrl, true)
  assert.equal(first.host, 'example.com')
  assert.equal(first.urlKey, 'alice::https://example.com/a.png')

  resolver.resolve('bob', 'notaurl')
  resolver.resolve('charlie', 'https://cdn.example.com/c.png')

  assert.equal(resolver.size(), 2)
  assert.equal(resolver.resolve('bob', 'notaurl').hasSafePictureUrl, false)
})

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

test('frame cap keeps only the budgeted regular overlay draw items', () => {
  const items = [
    { pubkey: 'low-priority', priority: 5, r: 8 },
    { pubkey: 'highest-priority', priority: 0, r: 10 },
    { pubkey: 'mid-priority', priority: 2, r: 9 },
  ]

  assert.deepEqual(
    selectAvatarDrawItemsForFrame(items, 2, new Set()).map((item) => item.pubkey),
    ['highest-priority', 'mid-priority'],
  )
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

test('keeps ready avatar draw items when a transient frame cap drops them', () => {
  const items = [
    {
      pubkey: 'root',
      priority: 0,
      r: 12,
      url: 'https://example.com/root.png',
    },
    {
      pubkey: 'ready-outside-cap',
      priority: 20,
      r: 10,
      url: 'https://example.com/ready.png',
    },
    {
      pubkey: 'missing-outside-cap',
      priority: 30,
      r: 10,
      url: 'https://example.com/missing.png',
    },
    {
      pubkey: 'loading-outside-cap',
      priority: 40,
      r: 10,
      url: 'https://example.com/loading.png',
    },
  ]
  const selected = selectAvatarDrawItemsForFrame(items, 1, new Set())
  const retained = retainAvatarDrawItemsForFrame(
    items,
    selected,
    (urlKey) =>
      urlKey === 'ready-outside-cap::https://example.com/ready.png' ||
      urlKey === 'loading-outside-cap::https://example.com/loading.png',
  )

  assert.deepEqual(
    retained.map((item) => item.pubkey),
    ['root', 'ready-outside-cap', 'loading-outside-cap'],
  )
})

test('expanded avatar requests use device pixel ratio for sharper buckets', () => {
  assert.equal(
    resolveAvatarRequestedPixels({
      visibleDiameterPx: 96,
      isHighQualityAvatar: false,
      devicePixelRatio: 2,
    }),
    96,
  )
  assert.equal(
    resolveAvatarRequestedPixels({
      visibleDiameterPx: 96,
      isHighQualityAvatar: true,
      devicePixelRatio: 2,
    }),
    321,
  )
  assert.equal(
    resolveAvatarRequestedPixels({
      visibleDiameterPx: 32,
      isHighQualityAvatar: true,
      devicePixelRatio: 2,
    }),
    64,
  )
  assert.equal(
    resolveAvatarRequestedPixels({
      visibleDiameterPx: 96,
      isHighQualityAvatar: true,
      devicePixelRatio: 4,
    }),
    321,
  )
})

test('expanded avatar candidates can exceed the normal interactive bucket cap', () => {
  assert.equal(
    resolveAvatarCandidateMaxBucket({
      isHighQualityAvatar: false,
      budgetMaxBucket: 256,
      maxInteractiveBucket: 256,
    }),
    256,
  )
  assert.equal(
    resolveAvatarCandidateMaxBucket({
      isHighQualityAvatar: true,
      budgetMaxBucket: 64,
      maxInteractiveBucket: 256,
    }),
    512,
  )
})

test('does not enlarge regular zoomed-out avatars beyond the node radius', () => {
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

test('keeps all avatars eligible when renderer focus is empty', () => {
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      pubkey: 'far',
    }),
    true,
  )
})

test('does not use semantic selection as avatar focus fallback', () => {
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      pubkey: 'selected',
    }),
    true,
  )
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      pubkey: 'neighbor',
    }),
    true,
  )
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      pubkey: 'far',
    }),
    true,
  )
})

test('renderer focus limits avatars to the focused node and its neighbors', () => {
  const rendererFocusNeighborPubkeys = new Set(['focus-neighbor'])

  assert.equal(
    shouldDrawAvatarForRendererFocus({
      rendererFocusPubkey: 'focused',
      rendererFocusNeighborPubkeys,
      pubkey: 'focused',
    }),
    true,
  )
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      rendererFocusPubkey: 'focused',
      rendererFocusNeighborPubkeys,
      pubkey: 'focus-neighbor',
    }),
    true,
  )
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      rendererFocusPubkey: 'focused',
      rendererFocusNeighborPubkeys,
      pubkey: 'far',
    }),
    false,
  )
})

test('renderer focus ignores semantic selected-neighbor metadata', () => {
  assert.equal(
    shouldDrawAvatarForRendererFocus({
      rendererFocusPubkey: 'focused',
      rendererFocusNeighborPubkeys: new Set(['focus-neighbor']),
      pubkey: 'selected-neighbor',
    }),
    false,
  )
})

test('global camera motion degrades image avatars to monograms', () => {
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

test('motion hiding remains active when all visible photos mode is enabled', () => {
  assert.equal(
    resolveAvatarGlobalMotionActive({
      moving: true,
      hideImagesOnFastNodes: true,
    }),
    true,
  )
  assert.equal(
    resolveAvatarGlobalMotionActive({
      moving: true,
      hideImagesOnFastNodes: false,
    }),
    false,
  )
})

test('global motion keeps persistent focus avatars visually stable', () => {
  assert.equal(
    resolveAvatarItemGlobalMotionActive({
      globalMotionActive: true,
      isPersistentAvatar: true,
    }),
    false,
  )
  assert.equal(
    resolveAvatarItemGlobalMotionActive({
      globalMotionActive: true,
      isPersistentAvatar: false,
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

test('fast node threshold gets more sensitive when zoomed out to the full network', () => {
  assert.equal(
    resolveFastNodeVelocityThresholdPx({
      baseThreshold: 240,
      cameraRatio: 1,
    }),
    240,
  )
  assert.equal(
    resolveFastNodeVelocityThresholdPx({
      baseThreshold: 240,
      cameraRatio: 4,
    }),
    120,
  )
  assert.equal(
    resolveFastNodeVelocityThresholdPx({
      baseThreshold: 240,
      cameraRatio: 20,
    }),
    80,
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

test('movement fallback degrades ready avatar images to monograms', () => {
  for (const guard of [
    {
      expectedWithoutReady: 'global_motion_active',
      expectedWithReady: 'global_motion_active',
      globalMotionActive: true,
      fastMoving: false,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    },
    {
      expectedWithoutReady: 'fast_moving',
      expectedWithReady: 'fast_moving',
      globalMotionActive: false,
      fastMoving: true,
      imageDrawCount: 0,
      maxImageDrawsPerFrame: 12,
    },
  ]) {
    assert.equal(
      resolveAvatarImageDisableReason({
        selectedForImage: true,
        globalMotionActive: guard.globalMotionActive,
        monogramOnly: false,
        fastMoving: guard.fastMoving,
        imageDrawCount: guard.imageDrawCount,
        maxImageDrawsPerFrame: guard.maxImageDrawsPerFrame,
        hasReadyImage: false,
      }),
      guard.expectedWithoutReady,
    )
    assert.equal(
      resolveAvatarImageDisableReason({
        selectedForImage: true,
        globalMotionActive: guard.globalMotionActive,
        monogramOnly: false,
        fastMoving: guard.fastMoving,
        imageDrawCount: guard.imageDrawCount,
        maxImageDrawsPerFrame: guard.maxImageDrawsPerFrame,
        hasReadyImage: true,
      }),
      guard.expectedWithReady,
    )
  }
})

test('keeps ready avatar images visible through frame draw caps', () => {
  for (const guard of [
    {
      expectedWithoutReady: 'image_draw_cap',
      globalMotionActive: false,
      fastMoving: false,
      imageDrawCount: 12,
      maxImageDrawsPerFrame: 12,
    },
  ]) {
    assert.equal(
      resolveAvatarImageDisableReason({
        selectedForImage: true,
        globalMotionActive: guard.globalMotionActive,
        monogramOnly: false,
        fastMoving: guard.fastMoving,
        imageDrawCount: guard.imageDrawCount,
        maxImageDrawsPerFrame: guard.maxImageDrawsPerFrame,
        hasReadyImage: false,
      }),
      guard.expectedWithoutReady,
    )
    assert.equal(
      resolveAvatarImageDisableReason({
        selectedForImage: true,
        globalMotionActive: guard.globalMotionActive,
        monogramOnly: false,
        fastMoving: guard.fastMoving,
        imageDrawCount: guard.imageDrawCount,
        maxImageDrawsPerFrame: guard.maxImageDrawsPerFrame,
        hasReadyImage: true,
      }),
      null,
    )
  }
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

test('all visible photos mode stays effective while the performance budget is healthy', () => {
  assert.equal(
    resolveEffectiveShowAllVisibleImages({
      requestedShowAllVisibleImages: true,
      isDegraded: false,
      emaFrameMs: 18,
    }),
    true,
  )
})

test('all visible photos mode is disabled while the performance budget is constrained', () => {
  assert.equal(
    resolveEffectiveShowAllVisibleImages({
      requestedShowAllVisibleImages: true,
      isDegraded: true,
      emaFrameMs: 18,
    }),
    false,
  )
  assert.equal(
    resolveEffectiveShowAllVisibleImages({
      requestedShowAllVisibleImages: true,
      isDegraded: false,
      emaFrameMs: 40,
    }),
    false,
  )
  assert.equal(
    resolveEffectiveShowAllVisibleImages({
      requestedShowAllVisibleImages: false,
      isDegraded: false,
      emaFrameMs: 18,
    }),
    false,
  )
})

test('degraded effective mode respects the base frame draw cap', () => {
  const effectiveShowAllVisibleImages = resolveEffectiveShowAllVisibleImages({
    requestedShowAllVisibleImages: true,
    isDegraded: true,
    emaFrameMs: 18,
  })

  assert.equal(
    resolveAvatarFrameDrawCap({
      baseCap: 32,
      visibleCount: 94,
      showAllVisibleImages: effectiveShowAllVisibleImages,
    }),
    32,
  )
})

test('degraded effective mode keeps load bounded without shrinking all-visible cache', () => {
  const effectiveShowAllVisibleImages = resolveEffectiveShowAllVisibleImages({
    requestedShowAllVisibleImages: true,
    isDegraded: false,
    emaFrameMs: 58.6,
  })
  const cacheAllVisibleImages = resolveAvatarCacheRetentionMode({
    requestedShowAllVisibleImages: true,
    effectiveShowAllVisibleImages,
  })

  assert.equal(
    resolveAvatarLoadConcurrency({
      baseConcurrency: 1,
      visiblePhotoCount: 94,
      showAllVisibleImages: effectiveShowAllVisibleImages,
    }),
    1,
  )
  assert.equal(
    resolveAvatarCacheCap({
      baseCap: 96,
      visiblePhotoCount: 94,
      showAllVisibleImages: cacheAllVisibleImages,
    }),
    126,
  )
})

test('all visible photos mode expands cache cap beyond the visible photo count', () => {
  assert.equal(
    resolveAvatarCacheCap({
      baseCap: 128,
      visiblePhotoCount: 221,
      showAllVisibleImages: true,
    }),
    277,
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

test('avatar runtime defaults keep all visible photos on and motion hiding disabled', () => {
  assert.equal(DEFAULT_AVATAR_RUNTIME_OPTIONS.showAllVisibleImages, true)
  assert.equal(DEFAULT_AVATAR_RUNTIME_OPTIONS.hideImagesOnFastNodes, false)
})
