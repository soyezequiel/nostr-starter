import assert from 'node:assert/strict'
import test from 'node:test'

import { SpatialNodeHitTester } from '@/features/graph-v2/renderer/spatialNodeHitTest'

type TestNode = {
  pubkey: string
  x: number
  y: number
  radius: number
  hidden?: boolean
  zIndex?: number
}

const createTester = (nodes: TestNode[]) => {
  const sigma = {
    getNodeAtPosition: () => null,
    getNodeDisplayData: (pubkey: string) => {
      const node = nodes.find((candidate) => candidate.pubkey === pubkey)
      if (!node) {
        return undefined
      }

      return {
        x: node.x,
        y: node.y,
        size: node.radius,
        hidden: node.hidden ?? false,
        zIndex: node.zIndex ?? 0,
      }
    },
    graphToViewport: (point: { x: number; y: number }) => point,
    getCamera: () => ({
      on: () => undefined,
      removeListener: () => undefined,
    }),
  } as unknown as ConstructorParameters<typeof SpatialNodeHitTester>[0]

  const graph = {
    forEachNode: (
      callback: (
        pubkey: string,
        attributes: { x: number; y: number },
      ) => void,
    ) => {
      for (const node of nodes) {
        callback(node.pubkey, { x: node.x, y: node.y })
      }
    },
    on: () => undefined,
    removeListener: () => undefined,
  } as unknown as ConstructorParameters<typeof SpatialNodeHitTester>[1]

  return new SpatialNodeHitTester(sigma, graph, 32)
}

test('only picks a node when the pointer is inside the rendered radius', () => {
  const tester = createTester([
    {
      pubkey: 'alice',
      x: 100,
      y: 100,
      radius: 10,
    },
  ])

  assert.equal(tester.pick({ x: 110, y: 100 }), 'alice')
  assert.equal(tester.pick({ x: 110.1, y: 100 }), null)
})

test('uses a larger hit radius for touch taps without changing mouse precision', () => {
  const tester = createTester([
    {
      pubkey: 'alice',
      x: 100,
      y: 100,
      radius: 10,
    },
  ])

  assert.equal(tester.pick({ x: 122, y: 100 }), null)
  assert.equal(
    tester.pick({
      x: 122,
      y: 100,
      original: { touches: [] },
    } as Parameters<typeof tester.pick>[0]),
    'alice',
  )
})

test('prefers the closest overlapping node and ignores hidden nodes', () => {
  const tester = createTester([
    {
      pubkey: 'hidden',
      x: 100,
      y: 100,
      radius: 50,
      hidden: true,
    },
    {
      pubkey: 'alice',
      x: 100,
      y: 100,
      radius: 20,
    },
    {
      pubkey: 'bob',
      x: 108,
      y: 100,
      radius: 20,
    },
  ])

  assert.equal(tester.pick({ x: 109, y: 100 }), 'bob')
})
