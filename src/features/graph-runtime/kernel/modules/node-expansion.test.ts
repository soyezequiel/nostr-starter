import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'zustand/vanilla'

// `tsx --test` runs this repo in a CJS-compatible mode, so require keeps the
// local TS module export shape predictable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGraphSlice } = require('../../app/store/slices/graphSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRelaySlice } = require('../../app/store/slices/relaySlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createUiSlice } = require('../../app/store/slices/uiSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createKernelEventEmitter } = require('../events.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createNodeExpansionModule } = require('./node-expansion.ts')

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const flushMicrotasks = async (times = 3) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

test('expandNode resolves before reciprocal enrichment finishes and merges late inbound followers afterwards', async () => {
  const store = createStore<Record<string, unknown>>()((...args) => ({
    ...createGraphSlice(...args),
    ...createRelaySlice(...args),
    ...createUiSlice(...args),
  }))

  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().setRootNodePubkey('root')
  store.getState().upsertNodes([
    {
      pubkey: 'root',
      keywordHits: 0,
      discoveredAt: 0,
      profileState: 'ready',
      source: 'root',
    },
    {
      pubkey: 'target',
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'ready',
      source: 'follow',
    },
  ])
  store.getState().upsertLinks([
    {
      source: 'root',
      target: 'target',
      relation: 'follow',
    },
  ])
  store.getState().setSelectedNodePubkey('target')
  store.getState().setOpenPanel('node-detail')

  const reciprocalDeferred = createDeferred<{
    followerPubkeys: string[]
    partial: boolean
  }>()
  let targetedReciprocalCallCount = 0

  const createRelayAdapter = () => ({
    subscribe(filters: Array<Record<string, unknown>>) {
      return {
        subscribe(observer: {
          next?: (value: unknown) => void
          complete?: (summary: unknown) => void
          error?: (error: Error) => void
        }) {
          queueMicrotask(() => {
            const firstFilter = filters[0] ?? {}
            if (Array.isArray(firstFilter.authors)) {
              observer.next?.({
                event: {
                  id: 'contact-list-event',
                  pubkey: 'target',
                  kind: 3,
                  created_at: 123,
                  tags: [['p', 'visible-follow']],
                },
                relayUrl: 'wss://relay.example',
                receivedAtMs: 123,
              })
            }

            observer.complete?.({
              relayCount: 1,
            })
          })

          return () => {}
        },
      }
    },
    count: async () => [],
    getRelayHealth: () => ({}),
    subscribeToRelayHealth: () => () => {},
    close: () => {},
  })

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
    },
    eventsWorker: {
      invoke: async (action: string) => {
        if (action !== 'PARSE_CONTACT_LIST') {
          throw new Error(`unexpected action ${action}`)
        }

        return {
          followPubkeys: ['visible-follow'],
          relayHints: [],
          diagnostics: [],
        }
      },
    },
    graphWorker: {
      invoke: async () => {
        throw new Error('graph worker should not be used in this test')
      },
      dispose: () => {},
    },
    createRelayAdapter,
    defaultRelayUrls: ['wss://relay.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }

  const expansion = createNodeExpansionModule(ctx, {
    analysis: {
      schedule: () => {},
    },
    persistence: {
      persistContactListEvent: async () => {},
      persistProfileEvent: async () => {},
    },
    profileHydration: {
      hydrateNodeProfiles: async () => {},
    },
    rootLoader: {
      getLoadSequence: () => 1,
      isStaleLoad: () => false,
    },
    zapLayer: {
      getZapTargetPubkeys: () => [],
      prefetchZapLayer: async () => {},
    },
    nodeDetail: {
      getActivePreviewRequest: () => undefined,
    },
    loadTargetedReciprocalFollowerEvidence: async () => {
      targetedReciprocalCallCount += 1
      return reciprocalDeferred.promise
    },
  })

  const expansionOutcome = await Promise.race([
    expansion.expandNode('target').then((result: unknown) => result),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 50)
    }),
  ])

  assert.notEqual(expansionOutcome, 'timeout')
  assert.equal(targetedReciprocalCallCount, 1)
  assert.deepEqual(
    store.getState().adjacency.target,
    ['visible-follow'],
  )
  assert.equal(store.getState().inboundAdjacency.target, undefined)
  assert.equal(store.getState().expandedNodePubkeys.has('target'), true)
  assert.equal(store.getState().selectedNodePubkey, null)
  assert.equal(store.getState().openPanel, 'overview')

  reciprocalDeferred.resolve({
    followerPubkeys: ['late-follower'],
    partial: false,
  })
  await flushMicrotasks()

  assert.deepEqual(
    store.getState().inboundAdjacency.target,
    ['late-follower'],
  )
  assert.equal(store.getState().nodes['late-follower']?.source, 'inbound')
})
