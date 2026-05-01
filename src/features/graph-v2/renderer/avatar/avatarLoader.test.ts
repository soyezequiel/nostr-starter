import assert from 'node:assert/strict'
import test from 'node:test'

import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'
import type { AvatarDiskCache } from '@/features/graph-v2/renderer/avatar/avatarDiskCache'

const makeLoader = (nowRef: { t: number }) =>
  new AvatarLoader({
    fetchImpl: (async () => {
      throw new Error('not used in these tests')
    }) as unknown as typeof fetch,
    createImageBitmapImpl: (async () => {
      throw new Error('not used')
    }) as unknown as typeof createImageBitmap,
    now: () => nowRef.t,
  })

test('AvatarLoader.isBlocked is false by default', () => {
  const nowRef = { t: 1000 }
  const loader = makeLoader(nowRef)
  assert.equal(loader.isBlocked('u'), false)
})

test('AvatarLoader.block marks key as blocked until TTL expires', () => {
  const nowRef = { t: 1000 }
  const loader = makeLoader(nowRef)
  loader.block('u', 500)
  assert.equal(loader.isBlocked('u'), true)
  nowRef.t = 1499
  assert.equal(loader.isBlocked('u'), true)
  nowRef.t = 1501
  assert.equal(loader.isBlocked('u'), false)
})

test('AvatarLoader.unblock removes block', () => {
  const nowRef = { t: 1000 }
  const loader = makeLoader(nowRef)
  loader.block('u', 10000)
  loader.unblock('u')
  assert.equal(loader.isBlocked('u'), false)
})

test('AvatarLoader exposes blocked reasons in the debug snapshot', () => {
  const nowRef = { t: 1000 }
  const loader = makeLoader(nowRef)
  loader.block('u', 5000, 'http_502')

  const snapshot = loader.getDebugSnapshot()
  assert.equal(snapshot.blockedCount, 1)
  assert.equal(snapshot.blocked[0]?.reason, 'http_502')
  assert.equal(snapshot.blocked[0]?.ttlMsRemaining, 5000)
})

test('AvatarLoader.load rejects unsafe URL', async () => {
  const loader = makeLoader({ t: 0 })
  await assert.rejects(
    () => loader.load('javascript:alert(1)', 64, new AbortController().signal),
    /unsafe_url/,
  )
})

test('AvatarLoader.load falls back to img when fetch is blocked by CORS', async () => {
  const originalDocument = globalThis.document
  const originalImageElement = globalThis.HTMLImageElement

  class MockImageElement extends EventTarget {
    decoding = ''
    referrerPolicy = ''
    private currentSrc = ''

    set src(value: string) {
      this.currentSrc = value
      if (value) {
        queueMicrotask(() => {
          this.dispatchEvent(new Event('load'))
        })
      }
    }

    get src() {
      return this.currentSrc
    }
  }

  Object.defineProperty(globalThis, 'HTMLImageElement', {
    configurable: true,
    value: MockImageElement,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === 'img') {
          return new MockImageElement()
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            drawImage: () => undefined,
            restore: () => undefined,
          }),
        }
      },
    },
  })

  try {
    const loader = new AvatarLoader({
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () => {
        throw new Error('not used')
      }) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://images.example/avatar.png',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.ok(loaded.bitmap)
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'HTMLImageElement', {
      configurable: true,
      value: originalImageElement,
    })
  }
})

test('AvatarLoader.load falls back to img when fetch times out', async () => {
  const originalDocument = globalThis.document
  const originalImageElement = globalThis.HTMLImageElement

  class MockImageElement extends EventTarget {
    decoding = ''
    referrerPolicy = ''
    private currentSrc = ''

    set src(value: string) {
      this.currentSrc = value
      if (value) {
        queueMicrotask(() => {
          this.dispatchEvent(new Event('load'))
        })
      }
    }

    get src() {
      return this.currentSrc
    }
  }

  Object.defineProperty(globalThis, 'HTMLImageElement', {
    configurable: true,
    value: MockImageElement,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === 'img') {
          return new MockImageElement()
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            drawImage: () => undefined,
            restore: () => undefined,
          }),
        }
      },
    },
  })

  try {
    const loader = new AvatarLoader({
      fetchImpl: (async () => {
        throw new Error('timeout')
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () => {
        throw new Error('not used')
      }) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://images.example/avatar.png',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.ok(loaded.bitmap)
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'HTMLImageElement', {
      configurable: true,
      value: originalImageElement,
    })
  }
})

test('AvatarLoader.load falls back to the same-origin proxy when direct browser loading fails', async () => {
  const originalDocument = globalThis.document
  const originalImageBitmap = globalThis.ImageBitmap
  const fetchUrls: string[] = []

  class MockImageBitmap {
    close() {}
  }

  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          save: () => undefined,
          beginPath: () => undefined,
          arc: () => undefined,
          closePath: () => undefined,
          clip: () => undefined,
          drawImage: () => undefined,
          restore: () => undefined,
        }),
      }),
    },
  })

  try {
    const loader = new AvatarLoader({
      proxyOrigin: 'http://localhost:3000',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        fetchUrls.push(url)
        if (fetchUrls.length === 1) {
          throw new TypeError('Failed to fetch')
        }
        return new Response(new Blob(['png'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () =>
        new MockImageBitmap()) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://images.example/avatar.png',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.equal(fetchUrls.length, 2)
    const proxyUrl = new URL(fetchUrls[1])
    assert.equal(proxyUrl.origin, 'http://localhost:3000')
    assert.equal(proxyUrl.pathname, '/api/social-avatar')
    assert.equal(
      proxyUrl.searchParams.get('url'),
      'https://images.example/avatar.png',
    )
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

test('AvatarLoader.load tries the same-origin proxy first for known problematic hosts', async () => {
  const originalDocument = globalThis.document
  const originalImageBitmap = globalThis.ImageBitmap
  const fetchUrls: string[] = []

  class MockImageBitmap {
    close() {}
  }

  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          save: () => undefined,
          beginPath: () => undefined,
          arc: () => undefined,
          closePath: () => undefined,
          clip: () => undefined,
          drawImage: () => undefined,
          restore: () => undefined,
        }),
      }),
    },
  })

  try {
    const loader = new AvatarLoader({
      proxyOrigin: 'http://localhost:3000',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        fetchUrls.push(url)
        if (fetchUrls.length === 1) {
          throw new Error('timeout')
        }
        return new Response(new Blob(['png'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () =>
        new MockImageBitmap()) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://cdn.nostr.build/i/avatar.jpg',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.equal(fetchUrls.length, 2)
    const firstUrl = new URL(fetchUrls[0]!)
    assert.equal(firstUrl.origin, 'http://localhost:3000')
    assert.equal(firstUrl.pathname, '/api/social-avatar')
    assert.equal(firstUrl.searchParams.get('url'), 'https://cdn.nostr.build/i/avatar.jpg')
    assert.equal(fetchUrls[1], 'https://cdn.nostr.build/i/avatar.jpg')
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

test('AvatarLoader.load stops after a proxy-first success without attempting direct recovery', async () => {
  const originalDocument = globalThis.document
  const originalImageBitmap = globalThis.ImageBitmap
  const fetchUrls: string[] = []

  class MockImageBitmap {
    close() {}
  }

  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          save: () => undefined,
          beginPath: () => undefined,
          arc: () => undefined,
          closePath: () => undefined,
          clip: () => undefined,
          drawImage: () => undefined,
          restore: () => undefined,
        }),
      }),
    },
  })

  try {
    const loader = new AvatarLoader({
      proxyOrigin: 'http://localhost:3000',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        fetchUrls.push(url)
        return new Response(new Blob(['png'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () =>
        new MockImageBitmap()) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://nostr.build/i/avatar.jpg',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.equal(fetchUrls.length, 1)
    const firstUrl = new URL(fetchUrls[0]!)
    assert.equal(firstUrl.origin, 'http://localhost:3000')
    assert.equal(firstUrl.pathname, '/api/social-avatar')
    assert.equal(firstUrl.searchParams.get('url'), 'https://nostr.build/i/avatar.jpg')
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

test('AvatarLoader.load fails fast on terminal direct fetch errors without trying proxy fallback', async () => {
  const originalDocument = globalThis.document
  const fetchUrls: string[] = []
  let imageCreateCount = 0

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === 'img') {
          imageCreateCount += 1
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            drawImage: () => undefined,
            restore: () => undefined,
          }),
        }
      },
    },
  })

  try {
    const loader = new AvatarLoader({
      proxyOrigin: 'http://localhost:3000',
      fetchImpl: (async (input: RequestInfo | URL) => {
        fetchUrls.push(String(input))
        return new Response(null, { status: 404 })
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () => {
        throw new Error('not used')
      }) as unknown as typeof createImageBitmap,
    })

    await assert.rejects(
      () =>
        loader.load(
          'https://images.example/avatar.png',
          64,
          new AbortController().signal,
        ),
      /http_404/,
    )

    assert.equal(fetchUrls.length, 1)
    assert.equal(imageCreateCount, 0)
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
})

test('AvatarLoader.load skips image fallback after terminal proxy failure reasons', async () => {
  const originalDocument = globalThis.document
  const fetchUrls: string[] = []
  let imageCreateCount = 0

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === 'img') {
          imageCreateCount += 1
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            drawImage: () => undefined,
            restore: () => undefined,
          }),
        }
      },
    },
  })

  try {
    const loader = new AvatarLoader({
      proxyOrigin: 'http://localhost:3000',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        fetchUrls.push(url)
        if (fetchUrls.length === 1) {
          throw new TypeError('Failed to fetch')
        }
        return new Response(null, {
          status: 502,
          headers: { 'x-avatar-proxy-reason': 'unresolved_host' },
        })
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () => {
        throw new Error('not used')
      }) as unknown as typeof createImageBitmap,
    })

    await assert.rejects(
      () =>
        loader.load(
          'https://images.example/avatar.png',
          64,
          new AbortController().signal,
        ),
      /Failed to fetch|unresolved_host|http_502/,
    )

    assert.equal(fetchUrls.length, 2)
    assert.equal(imageCreateCount, 0)
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
})

test('AvatarLoader.load reads avatar blobs from IndexedDB disk cache before fetching', async () => {
  const originalDocument = globalThis.document
  const originalImageBitmap = globalThis.ImageBitmap
  let fetchCount = 0
  let deletedKey: Array<[string, number]> = []

  class MockImageBitmap {
    close() {}
  }

  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          save: () => undefined,
          beginPath: () => undefined,
          arc: () => undefined,
          closePath: () => undefined,
          clip: () => undefined,
          drawImage: () => undefined,
          restore: () => undefined,
        }),
      }),
    },
  })

  const diskCache: AvatarDiskCache = {
    has: async () => true,
    get: async () => ({
      blob: new Blob(['cached-avatar'], { type: 'image/webp' }),
      mimeType: 'image/webp',
      byteSize: 13,
    }),
    put: async () => {
      throw new Error('put should not be called for disk hits')
    },
    delete: async (sourceUrl, bucket) => {
      deletedKey = [[sourceUrl, bucket]]
    },
  }

  try {
    const loader = new AvatarLoader({
      diskCache,
      fetchImpl: (async () => {
        fetchCount += 1
        throw new Error('fetch should not be used')
      }) as unknown as typeof fetch,
      createImageBitmapImpl: (async () =>
        new MockImageBitmap()) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://images.example/avatar.png',
      64,
      new AbortController().signal,
    )

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.ok(loaded.bitmap)
    assert.equal(fetchCount, 0)
    assert.deepEqual(deletedKey, [])
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

test('AvatarLoader.load stores successful fetched avatar blobs in IndexedDB disk cache', async () => {
  const originalDocument = globalThis.document
  const originalImageBitmap = globalThis.ImageBitmap
  const puts: Array<{ sourceUrl: string; bucket: number; blob: Blob }> = []
  let drawImageCount = 0

  class MockImageBitmap {
    close() {}
  }

  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              save: () => undefined,
              beginPath: () => undefined,
              arc: () => undefined,
              closePath: () => undefined,
              clip: () => undefined,
              drawImage: () => {
                drawImageCount += 1
              },
              restore: () => undefined,
            }),
            toBlob: (callback: (blob: Blob | null) => void) => {
              callback(new Blob(['processed-avatar'], { type: 'image/png' }))
            },
          }
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            save: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            clip: () => undefined,
            drawImage: () => undefined,
            restore: () => undefined,
          }),
        }
      },
    },
  })

  const diskCache: AvatarDiskCache = {
    has: async () => false,
    get: async () => null,
    put: async (input) => {
      puts.push({
        sourceUrl: input.sourceUrl,
        bucket: input.bucket,
        blob: input.blob,
      })
    },
    delete: async () => undefined,
  }

  try {
    const loader = new AvatarLoader({
      diskCache,
      fetchImpl: (async () =>
        new Response(new Blob(['network-avatar'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })) as unknown as typeof fetch,
      createImageBitmapImpl: (async () =>
        new MockImageBitmap()) as unknown as typeof createImageBitmap,
    })

    const loaded = await loader.load(
      'https://images.example/avatar.png',
      64,
      new AbortController().signal,
    )
    await Promise.resolve()

    assert.equal(loaded.bytes, 64 * 64 * 4)
    assert.equal(puts.length, 1)
    assert.equal(puts[0]?.sourceUrl, 'https://images.example/avatar.png')
    assert.equal(puts[0]?.bucket, 64)
    assert.equal(puts[0]?.blob.type, 'image/png')
    assert.equal(await puts[0]?.blob.text(), 'processed-avatar')
    assert.ok(drawImageCount >= 2)
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

// ── loadManyDiskCached ────────────────────────────────────────────────────────

const makeFakeBitmap = () =>
  ({
    width: 64,
    height: 64,
    close: () => undefined,
  }) as unknown as ImageBitmap

const makeBulkLoader = ({
  bulkGetFreshResults,
  decodeResult,
}: {
  bulkGetFreshResults: Array<{ blob: Blob; mimeType: string; byteSize: number } | null>
  decodeResult?: ImageBitmap
}) => {
  const bitmap = decodeResult ?? makeFakeBitmap()
  return new AvatarLoader({
    fetchImpl: (async () => {
      throw new Error('not used')
    }) as unknown as typeof fetch,
    createImageBitmapImpl: async () => bitmap,
    now: () => 0,
    diskCache: {
      has: async () => false,
      get: async () => null,
      bulkGetFresh: async () => bulkGetFreshResults,
      put: async () => undefined,
      delete: async () => undefined,
    } as AvatarDiskCache,
  })
}

test('loadManyDiskCached returns decoded bitmaps for all hits', async () => {
  const blob = new Blob(['img'], { type: 'image/png' })
  const loader = makeBulkLoader({
    bulkGetFreshResults: [
      { blob, mimeType: 'image/png', byteSize: 4 },
      null,
      { blob, mimeType: 'image/png', byteSize: 4 },
    ],
  })

  const requests = [
    { url: 'https://example.com/a.png', bucket: 64 as const },
    { url: 'https://example.com/b.png', bucket: 64 as const },
    { url: 'https://example.com/c.png', bucket: 64 as const },
  ]

  const results = await loader.loadManyDiskCached(requests, new AbortController().signal)

  assert.equal(results.length, 3)
  assert.ok(results[0] !== null)
  assert.equal(results[1], null)
  assert.ok(results[2] !== null)
})

test('loadManyDiskCached returns all nulls when disk cache is absent', async () => {
  const loader = new AvatarLoader({
    fetchImpl: (async () => { throw new Error('not used') }) as unknown as typeof fetch,
    createImageBitmapImpl: (async () => { throw new Error('not used') }) as unknown as typeof createImageBitmap,
    now: () => 0,
    diskCache: null,
  })

  const results = await loader.loadManyDiskCached(
    [{ url: 'https://example.com/a.png', bucket: 64 as const }],
    new AbortController().signal,
  )

  assert.deepEqual(results, [null])
})

test('loadManyDiskCached skips unsafe URLs', async () => {
  const blob = new Blob(['img'], { type: 'image/png' })
  const bulkGetFreshCalls: number[] = []
  const loader = new AvatarLoader({
    fetchImpl: (async () => { throw new Error('not used') }) as unknown as typeof fetch,
    createImageBitmapImpl: async () => makeFakeBitmap(),
    now: () => 0,
    diskCache: {
      has: async () => false,
      get: async () => null,
      bulkGetFresh: async (requests) => {
        bulkGetFreshCalls.push(requests.length)
        return requests.map(() => ({ blob, mimeType: 'image/png', byteSize: 4 }))
      },
      put: async () => undefined,
      delete: async () => undefined,
    } as AvatarDiskCache,
  })

  const results = await loader.loadManyDiskCached(
    [
      { url: 'javascript:alert(1)', bucket: 64 as const },
      { url: 'https://example.com/safe.png', bucket: 64 as const },
    ],
    new AbortController().signal,
  )

  // Only the safe URL is passed to bulkGetFresh
  assert.equal(bulkGetFreshCalls[0], 1)
  assert.equal(results[0], null) // unsafe → null
  assert.ok(results[1] !== null) // safe → decoded
})

test('loadManyDiskCached respects abort signal', async () => {
  const ctrl = new AbortController()
  ctrl.abort()

  const loader = makeBulkLoader({
    bulkGetFreshResults: [{ blob: new Blob(['img']), mimeType: 'image/png', byteSize: 4 }],
  })

  const results = await loader.loadManyDiskCached(
    [{ url: 'https://example.com/a.png', bucket: 64 as const }],
    ctrl.signal,
  )

  assert.deepEqual(results, [null])
})

test('loadManyDiskCached returns empty array for empty request list', async () => {
  const loader = makeBulkLoader({ bulkGetFreshResults: [] })
  const results = await loader.loadManyDiskCached([], new AbortController().signal)
  assert.deepEqual(results, [])
})
