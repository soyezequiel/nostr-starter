import assert from 'node:assert/strict'
import test from 'node:test'

import { AvatarBitmapCache } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import { AvatarScheduler } from '@/features/graph-v2/renderer/avatar/avatarScheduler'
import { clearTerminalAvatarFailure } from '@/features/graph-runtime/debug/avatarTerminalFailures'
import type { AvatarBudget } from '@/features/graph-v2/renderer/avatar/types'

const installDocumentStub = () => {
  const originalDocument = globalThis.document
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () =>
        ({
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            createRadialGradient: () => ({
              addColorStop: () => undefined,
            }),
            createLinearGradient: () => ({
              addColorStop: () => undefined,
            }),
            fillRect: () => undefined,
            fill: () => undefined,
            stroke: () => undefined,
            strokeText: () => undefined,
            fillText: () => undefined,
            restore: () => undefined,
          }),
        }) as unknown as HTMLCanvasElement,
    },
  })
  return () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
}

const budget: AvatarBudget = {
  sizeThreshold: 12,
  zoomThreshold: 2,
  concurrency: 1,
  maxBucket: 128,
  lruCap: 16,
  maxAvatarDrawsPerFrame: 10,
  maxImageDrawsPerFrame: 10,
  drawAvatars: true,
}

test('scheduler starts up to the effective load concurrency', () => {
  const restoreDocument = installDocumentStub()
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      pubkey: `node-${index}`,
      urlKey: `node-${index}::https://example.com/node-${index}.png`,
      url: `https://example.com/node-${index}.png`,
      bucket: 64 as const,
      priority: index,
      monogram: { label: `Node ${index}`, color: '#7dd3a7' },
    }))

    scheduler.reconcile(candidates, { ...budget, concurrency: 6 })

    assert.equal(loadCalls.length, 6)
    assert.equal(scheduler.inflightSize(), 6)
    assert.deepEqual(
      loadCalls.map((call) => call.url),
      candidates.slice(0, 6).map((candidate) => candidate.url),
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler expands concurrency for avatars already cached on disk', async () => {
  const restoreDocument = installDocumentStub()
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    pubkey: `node-${index}`,
    urlKey: `node-${index}::https://example.com/node-${index}.png`,
    url: `https://example.com/node-${index}.png`,
    bucket: 64 as const,
    priority: index,
    monogram: { label: `Node ${index}`, color: '#7dd3a7' },
  }))
  const diskCachedUrls = new Set(
    candidates.slice(1).map((candidate) => candidate.url),
  )
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const diskCacheLoadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const diskCacheProbes: Array<{ url: string; bucket: number }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    hasDiskCached: async (url: string, bucket: number) => {
      diskCacheProbes.push({ url, bucket })
      return diskCachedUrls.has(url)
    },
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
    loadDiskCached: (url: string, _bucket: number, signal: AbortSignal) => {
      diskCacheLoadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(candidates, budget)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(loadCalls.length, 1)
    assert.equal(diskCacheLoadCalls.length, candidates.length - 1)
    assert.equal(scheduler.inflightSize(), candidates.length)
    assert.deepEqual(
      loadCalls.map((call) => call.url),
      candidates.slice(0, 1).map((candidate) => candidate.url),
    )
    assert.deepEqual(
      diskCacheLoadCalls.map((call) => call.url),
      candidates.slice(1).map((candidate) => candidate.url),
    )
    assert.deepEqual(
      diskCacheProbes.map((probe) => probe.url),
      candidates.slice(1).map((candidate) => candidate.url),
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler does not use the disk cache lane for network fallback when the disk entry disappears', async () => {
  const restoreDocument = installDocumentStub()
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    pubkey: `node-${index}`,
    urlKey: `node-${index}::https://example.com/node-${index}.png`,
    url: `https://example.com/node-${index}.png`,
    bucket: 64 as const,
    priority: index,
    monogram: { label: `Node ${index}`, color: '#7dd3a7' },
  }))
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const diskCacheLoadCalls: string[] = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    hasDiskCached: async () => true,
    loadDiskCached: async (url: string) => {
      diskCacheLoadCalls.push(url)
      return null
    },
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(candidates, budget)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(loadCalls.length, 1)
    assert.equal(loadCalls[0]?.url, candidates[0]?.url)
    assert.deepEqual(
      diskCacheLoadCalls,
      candidates.slice(1).map((candidate) => candidate.url),
    )
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler keeps normal concurrency for avatars missing from disk cache', async () => {
  const restoreDocument = installDocumentStub()
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    pubkey: `node-${index}`,
    urlKey: `node-${index}::https://example.com/node-${index}.png`,
    url: `https://example.com/node-${index}.png`,
    bucket: 64 as const,
    priority: index,
    monogram: { label: `Node ${index}`, color: '#7dd3a7' },
  }))
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    hasDiskCached: async () => false,
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(candidates, budget)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(loadCalls.length, 1)
    assert.equal(loadCalls[0]?.url, candidates[0]?.url)
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler caps disk cache miss probes so IndexedDB cannot starve loading', async () => {
  const restoreDocument = installDocumentStub()
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    pubkey: `node-${index}`,
    urlKey: `node-${index}::https://example.com/node-${index}.png`,
    url: `https://example.com/node-${index}.png`,
    bucket: 64 as const,
    priority: index,
    monogram: { label: `Node ${index}`, color: '#7dd3a7' },
  }))
  const probedUrls: string[] = []
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    hasDiskCached: async (url: string) => {
      probedUrls.push(url)
      return false
    },
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(candidates, budget)
    await new Promise((resolve) => setTimeout(resolve, 0))
    scheduler.reconcile(candidates, budget)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(loadCalls.length, 1)
    assert.equal(probedUrls.length, 14)
    assert.deepEqual(
      probedUrls,
      candidates.slice(1, 15).map((candidate) => candidate.url),
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('urgent avatars preempt lower-priority inflight loads', () => {
  const restoreDocument = installDocumentStub()
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'regular',
          urlKey: 'regular::https://example.com/regular.png',
          url: 'https://example.com/regular.png',
          bucket: 64,
          priority: 30,
          monogram: { label: 'Regular', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    scheduler.prime(
      [
        {
          pubkey: 'selected',
          urlKey: 'selected::https://example.com/selected.png',
          url: 'https://example.com/selected.png',
          bucket: 64,
          priority: 2,
          urgent: true,
          monogram: { label: 'Selected', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    assert.equal(loadCalls.length, 2)
    assert.equal(loadCalls[0]?.url, 'https://example.com/regular.png')
    assert.equal(loadCalls[0]?.signal.aborted, true)
    assert.equal(loadCalls[1]?.url, 'https://example.com/selected.png')
    assert.equal(loadCalls[1]?.signal.aborted, false)
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('urgent avatars retry failed blocked loads instead of staying on monogram', () => {
  const restoreDocument = installDocumentStub()
  const urlKey = 'selected::https://example.com/selected.png'
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  let blocked = true
  const loader = {
    isBlocked: () => blocked,
    block: () => {
      blocked = true
    },
    unblock: () => {
      blocked = false
    },
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const cache = new AvatarBitmapCache(16)
    const monogram = cache.getMonogram('selected', {
      label: 'Selected',
      color: '#7dd3a7',
    })
    cache.markFailed(urlKey, monogram)

    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'selected',
          urlKey,
          url: 'https://example.com/selected.png',
          bucket: 64,
          priority: 2,
          urgent: true,
          monogram: { label: 'Selected', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    assert.equal(blocked, false)
    assert.equal(loadCalls.length, 1)
    assert.equal(loadCalls[0]?.url, 'https://example.com/selected.png')
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler clamps requested avatar buckets to the active budget', () => {
  const restoreDocument = installDocumentStub()
  const loadCalls: Array<{ bucket: number }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (_url: string, bucket: number) => {
      loadCalls.push({ bucket })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'small',
          urlKey: 'small::https://example.com/small.png',
          url: 'https://example.com/small.png',
          bucket: 512,
          priority: 1,
          monogram: { label: 'Small', color: '#7dd3a7' },
        },
      ],
      { ...budget, maxBucket: 64 },
    )

    assert.equal(loadCalls[0]?.bucket, 64)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('failed avatar loads stay on monogram fallback', async () => {
  const restoreDocument = installDocumentStub()
  const cache = new AvatarBitmapCache(16)
  const urlKey = 'broken::https://example.com/broken.png'
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: () => Promise.reject(new Error('image_load_failed')),
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'broken',
          urlKey,
          url: 'https://example.com/broken.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Broken', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(cache.get(urlKey)?.state, 'failed')
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('scheduler debug snapshot records failure reasons and recent events', async () => {
  const restoreDocument = installDocumentStub()
  const cache = new AvatarBitmapCache(16)
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    unblock: () => undefined,
    load: () => Promise.reject(Object.assign(new Error('http_404'), { reason: 'http_404' })),
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'broken',
          urlKey: 'broken::https://example.com/broken.png',
          url: 'https://example.com/broken.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Broken', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    const snapshot = scheduler.getDebugSnapshot()
    assert.equal(snapshot.recentEvents[0]?.type, 'started')
    assert.equal(snapshot.recentEvents[1]?.type, 'failed')
    assert.equal(snapshot.recentEvents[1]?.reason, 'http_404')
    assert.equal(
      cache.getDebugSnapshot().entries[0]?.reason,
      'http_404',
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('persistent avatar failures stay blocked for longer', async () => {
  const restoreDocument = installDocumentStub()
  const cache = new AvatarBitmapCache(16)
  let blockedTtlMs = 0
  let blockedReason: string | null = null
  const loader = {
    isBlocked: () => false,
    block: (_urlKey: string, ttlMs: number, reason: string | null) => {
      blockedTtlMs = ttlMs
      blockedReason = reason
    },
    unblock: () => undefined,
    load: () =>
      Promise.reject(
        Object.assign(new Error('http_404'), { reason: 'http_404' }),
      ),
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'broken',
          urlKey: 'broken::https://example.com/broken.png',
          url: 'https://example.com/broken.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Broken', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(blockedReason, null)
    assert.equal(blockedTtlMs, 0)
    const failedEntry = cache.getDebugSnapshot().entries[0]
    assert.equal(failedEntry?.reason, 'http_404')
    assert.equal(failedEntry?.expiresAt, null)
    scheduler.dispose()
  } finally {
    clearTerminalAvatarFailure('broken::https://example.com/broken.png')
    restoreDocument()
  }
})

test('urgent retry does not requeue terminally quarantined avatars', () => {
  const restoreDocument = installDocumentStub()
  const cache = new AvatarBitmapCache(16)
  const urlKey = 'terminal::https://example.com/terminal.png'
  let loadCallCount = 0
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    unblock: () => undefined,
    load: () => {
      loadCallCount += 1
      return Promise.reject(
        Object.assign(new Error('http_404'), { reason: 'http_404' }),
      )
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'terminal',
          urlKey,
          url: 'https://example.com/terminal.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Terminal', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        scheduler.reconcile(
          [
            {
              pubkey: 'terminal',
              urlKey,
              url: 'https://example.com/terminal.png',
              bucket: 64,
              priority: 1,
              urgent: true,
              monogram: { label: 'Terminal', color: '#7dd3a7' },
            },
          ],
          budget,
        )

        assert.equal(loadCallCount, 1)
        assert.equal(cache.get(urlKey)?.state, 'failed')
        scheduler.dispose()
        clearTerminalAvatarFailure(urlKey)
        restoreDocument()
        resolve()
      }, 0)
    })
  } catch (error) {
    clearTerminalAvatarFailure(urlKey)
    restoreDocument()
    throw error
  }
})

test('transient avatar failures use a shorter retry backoff', async () => {
  const restoreDocument = installDocumentStub()
  const cache = new AvatarBitmapCache(16)
  let blockedTtlMs = 0
  let blockedReason: string | null = null
  const loader = {
    isBlocked: () => false,
    block: (_urlKey: string, ttlMs: number, reason: string | null) => {
      blockedTtlMs = ttlMs
      blockedReason = reason
    },
    unblock: () => undefined,
    load: () =>
      Promise.reject(
        Object.assign(new Error('timeout'), { reason: 'timeout' }),
      ),
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'slow',
          urlKey: 'slow::https://example.com/slow.png',
          url: 'https://example.com/slow.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Slow', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(blockedReason, 'timeout')
    assert.equal(blockedTtlMs, 15 * 60 * 1000)
    const failedEntry = cache.getDebugSnapshot().entries[0]
    assert.equal(
      (failedEntry?.expiresAt ?? 0) - (failedEntry?.failedAt ?? 0),
      15 * 60 * 1000,
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('short viewport churn does not abort an inflight avatar load', () => {
  const restoreDocument = installDocumentStub()
  let now = 1_000
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
      now: () => now,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'alice',
          urlKey: 'alice::https://example.com/alice.png',
          url: 'https://example.com/alice.png',
          bucket: 64,
          priority: 5,
          monogram: { label: 'Alice', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    now += 300
    scheduler.reconcile([], budget)

    assert.equal(loadCalls.length, 1)
    assert.equal(loadCalls[0]?.signal.aborted, false)
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('stale out-of-viewport inflight loads are aborted after the grace window', () => {
  const restoreDocument = installDocumentStub()
  let now = 1_000
  const cache = new AvatarBitmapCache(16)
  const loadCalls: Array<{ signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (_url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
      now: () => now,
    })
    const urlKey = 'alice::https://example.com/alice.png'

    scheduler.reconcile(
      [
        {
          pubkey: 'alice',
          urlKey,
          url: 'https://example.com/alice.png',
          bucket: 64,
          priority: 5,
          monogram: { label: 'Alice', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    now += 2_000
    scheduler.reconcile([], budget)

    assert.equal(loadCalls.length, 1)
    assert.equal(loadCalls[0]?.signal.aborted, true)
    assert.equal(scheduler.inflightSize(), 0)
    assert.equal(cache.get(urlKey), undefined)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('load rejections caused by scheduler aborts do not block avatars', async () => {
  const restoreDocument = installDocumentStub()
  let now = 1_000
  const cache = new AvatarBitmapCache(16)
  const urlKey = 'alice::https://example.com/alice.png'
  let blockCallCount = 0
  const loader = {
    isBlocked: () => false,
    block: () => {
      blockCallCount += 1
    },
    load: (_url: string, _bucket: number, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      }),
  }

  try {
    const scheduler = new AvatarScheduler({
      cache,
      loader: loader as never,
      now: () => now,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'alice',
          urlKey,
          url: 'https://example.com/alice.png',
          bucket: 64,
          priority: 1,
          monogram: { label: 'Alice', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    now += 2_000
    scheduler.reconcile([], budget)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(blockCallCount, 0)
    assert.equal(cache.get(urlKey), undefined)
    assert.equal(
      scheduler.getDebugSnapshot().recentEvents.some((event) => event.type === 'failed'),
      false,
    )
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})

test('new visible avatars reclaim stale inflight slots instead of waiting for timeout', () => {
  const restoreDocument = installDocumentStub()
  let now = 1_000
  const loadCalls: Array<{ url: string; signal: AbortSignal }> = []
  const loader = {
    isBlocked: () => false,
    block: () => undefined,
    load: (url: string, _bucket: number, signal: AbortSignal) => {
      loadCalls.push({ url, signal })
      return new Promise(() => undefined)
    },
  }

  try {
    const scheduler = new AvatarScheduler({
      cache: new AvatarBitmapCache(16),
      loader: loader as never,
      now: () => now,
    })

    scheduler.reconcile(
      [
        {
          pubkey: 'alice',
          urlKey: 'alice::https://example.com/alice.png',
          url: 'https://example.com/alice.png',
          bucket: 64,
          priority: 10,
          monogram: { label: 'Alice', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    now += 2_000
    scheduler.reconcile(
      [
        {
          pubkey: 'bob',
          urlKey: 'bob::https://example.com/bob.png',
          url: 'https://example.com/bob.png',
          bucket: 64,
          priority: 8,
          monogram: { label: 'Bob', color: '#7dd3a7' },
        },
      ],
      budget,
    )

    assert.equal(loadCalls.length, 2)
    assert.equal(loadCalls[0]?.url, 'https://example.com/alice.png')
    assert.equal(loadCalls[0]?.signal.aborted, true)
    assert.equal(loadCalls[1]?.url, 'https://example.com/bob.png')
    assert.equal(loadCalls[1]?.signal.aborted, false)
    assert.equal(scheduler.inflightSize(), 1)
    scheduler.dispose()
  } finally {
    restoreDocument()
  }
})
