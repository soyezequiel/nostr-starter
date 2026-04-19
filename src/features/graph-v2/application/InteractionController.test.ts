import assert from 'node:assert/strict'
import test from 'node:test'

import { GraphInteractionController } from '@/features/graph-v2/application/InteractionController'
import type { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'

test('selects and clears nodes through the bridge', () => {
  const selections: Array<string | null> = []
  const bridge = {
    selectNode: (pubkey: string | null) => {
      selections.push(pubkey)
    },
  } as unknown as LegacyKernelBridge
  const controller = new GraphInteractionController(bridge)

  controller.callbacks.onNodeClick('alice')
  controller.callbacks.onClearSelection()

  assert.deepEqual(selections, ['alice', null])
})

test('pins a node when drag release requests it', () => {
  const pinned: string[] = []
  const bridge = {
    pinNode: (pubkey: string) => {
      pinned.push(pubkey)
    },
  } as unknown as LegacyKernelBridge
  const controller = new GraphInteractionController(bridge)

  controller.callbacks.onNodeDragEnd('alice', { x: 10, y: 20 }, { pinNode: true })
  controller.callbacks.onNodeDragEnd('bob', { x: 30, y: 40 })

  assert.deepEqual(pinned, ['alice'])
})
