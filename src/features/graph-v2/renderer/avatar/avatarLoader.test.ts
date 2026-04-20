import assert from 'node:assert/strict'
import test from 'node:test'

import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'

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
