import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'zustand/vanilla'
import type { EventToggleSlice } from '@/features/graph-runtime/app/store/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createEventToggleSlice } = require('./eventToggleSlice.ts')

test('activity external node auto-add is disabled by default and can be toggled', () => {
  const store = createStore<EventToggleSlice>()((...args) => ({
    ...createEventToggleSlice(...args),
  }))

  assert.equal(store.getState().autoAddExternalActivityNodes, false)

  store.getState().setAutoAddExternalActivityNodes(true)
  assert.equal(store.getState().autoAddExternalActivityNodes, true)

  store.getState().setAutoAddExternalActivityNodes(false)
  assert.equal(store.getState().autoAddExternalActivityNodes, false)
})
