import assert from 'node:assert/strict'
import test from 'node:test'

import { AvatarBitmapCache } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'

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
            beginPath: () => undefined,
            arc: () => undefined,
            closePath: () => undefined,
            fill: () => undefined,
            fillText: () => undefined,
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

test('AvatarBitmapCache closes ImageBitmap entries when evicted', () => {
  const originalImageBitmap = globalThis.ImageBitmap
  let closed = 0
  class MockImageBitmap {
    close() {
      closed += 1
    }
  }
  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    value: MockImageBitmap,
  })

  try {
    const cache = new AvatarBitmapCache(16)
    const monogram = {} as HTMLCanvasElement
    for (let i = 0; i < 17; i += 1) {
      cache.markReady(
        `key-${i}`,
        64,
        new MockImageBitmap() as unknown as ImageBitmap,
        monogram,
        64 * 64 * 4,
      )
    }
    assert.equal(cache.size(), 16)
    assert.equal(closed, 1)
  } finally {
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      value: originalImageBitmap,
    })
  }
})

test('AvatarBitmapCache keeps monograms bounded and LRU ordered', () => {
  const restoreDocument = installDocumentStub()
  try {
    const cache = new AvatarBitmapCache(16)
    const first = cache.getMonogram('p0', { label: 'p0', color: '#7dd3a7' })
    const second = cache.getMonogram('p1', { label: 'p1', color: '#7dd3a7' })

    for (let i = 2; i < 32; i += 1) {
      cache.getMonogram(`p${i}`, { label: `p${i}`, color: '#7dd3a7' })
    }

    assert.equal(
      cache.getMonogram('p0', { label: 'p0', color: '#7dd3a7' }),
      first,
    )

    cache.getMonogram('p32', { label: 'p32', color: '#7dd3a7' })

    assert.equal(
      cache.getMonogram('p0', { label: 'p0', color: '#7dd3a7' }),
      first,
    )
    assert.notEqual(
      cache.getMonogram('p1', { label: 'p1', color: '#7dd3a7' }),
      second,
    )
  } finally {
    restoreDocument()
  }
})
