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

const createExpandableStore = () => {
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

  return store
}

const createBaseCollaborators = () => ({
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
})

const createRelayListsRepositoryStub = () => ({
  get: async () => undefined,
  upsert: async (record: unknown) => record,
})

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
      relayLists: createRelayListsRepositoryStub(),
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

test('expandNode reports partial when relays fail without cached contact list', async () => {
  const store = createExpandableStore()

  const createRelayAdapter = () => ({
    subscribe() {
      return {
        subscribe(observer: {
          error?: (error: Error) => void
        }) {
          queueMicrotask(() => {
            observer.error?.(new Error('cannot connect'))
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
      relayLists: createRelayListsRepositoryStub(),
    },
    eventsWorker: {
      invoke: async () => {
        throw new Error('events worker should not be used without events')
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
    ...createBaseCollaborators(),
    loadDirectInboundFollowerEvidence: async () => ({
      followerPubkeys: [],
      partial: false,
    }),
  })

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'partial')
  assert.equal(store.getState().nodeExpansionStates.target.status, 'partial')
  assert.equal(store.getState().expandedNodePubkeys.has('target'), true)
  assert.equal(store.getState().selectedNodePubkey, null)
})

test('expandNode reports partial when live contact list parsing fails', async () => {
  const store = createExpandableStore()

  const createRelayAdapter = () => ({
    subscribe(filters: Array<Record<string, unknown>>) {
      return {
        subscribe(observer: {
          next?: (value: unknown) => void
          complete?: (summary: unknown) => void
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
      relayLists: createRelayListsRepositoryStub(),
    },
    eventsWorker: {
      invoke: async () => {
        throw new Error('parse failed')
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
    ...createBaseCollaborators(),
    loadDirectInboundFollowerEvidence: async () => ({
      followerPubkeys: ['fallback-follower'],
      partial: false,
    }),
  })

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'partial')
  assert.equal(store.getState().nodeExpansionStates.target.status, 'partial')
  assert.deepEqual(
    store.getState().inboundAdjacency.target,
    ['fallback-follower'],
  )
  assert.equal(store.getState().expandedNodePubkeys.has('target'), true)
  assert.equal(store.getState().selectedNodePubkey, null)
})

test('expandNode reports partial when the foreground relay adapter cannot be created', async () => {
  const store = createExpandableStore()

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
      relayLists: createRelayListsRepositoryStub(),
    },
    eventsWorker: {
      invoke: async () => {
        throw new Error('events worker should not be used in this test')
      },
    },
    graphWorker: {
      invoke: async () => {
        throw new Error('graph worker should not be used in this test')
      },
      dispose: () => {},
    },
    createRelayAdapter: () => {
      throw new Error('bad relay config')
    },
    defaultRelayUrls: ['wss://relay.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }

  const expansion = createNodeExpansionModule(ctx, createBaseCollaborators())

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'partial')
  assert.equal(store.getState().nodeExpansionStates.target.status, 'partial')
  assert.equal(store.getState().expandedNodePubkeys.has('target'), false)
  assert.equal(store.getState().selectedNodePubkey, 'target')
})

test('expandNode explains how to raise the graph cap when expansion is blocked by the limit', async () => {
  const store = createExpandableStore()
  store.getState().setGraphMaxNodes(2)

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
      relayLists: createRelayListsRepositoryStub(),
    },
    eventsWorker: {
      invoke: async () => {
        throw new Error('events worker should not be used in this test')
      },
    },
    graphWorker: {
      invoke: async () => {
        throw new Error('graph worker should not be used in this test')
      },
      dispose: () => {},
    },
    createRelayAdapter: () => {
      throw new Error('relay adapter should not be created when cap is reached')
    },
    defaultRelayUrls: ['wss://relay.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }

  const expansion = createNodeExpansionModule(ctx, createBaseCollaborators())

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'error')
  assert.equal(
    result.message,
    'Cap de 2 nodos alcanzado. No se puede expandir. Podés aumentar el límite en Ajustes > Render.',
  )
  assert.equal(
    store.getState().nodeExpansionStates.target.message,
    result.message,
  )
})

test('expandNode does not let background enrichment adapter failures overwrite success', async () => {
  const store = createExpandableStore()
  let createRelayAdapterCallCount = 0

  const foregroundAdapter = {
    subscribe(filters: Array<Record<string, unknown>>) {
      return {
        subscribe(observer: {
          next?: (value: unknown) => void
          complete?: (summary: unknown) => void
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
  }

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
      relayLists: createRelayListsRepositoryStub(),
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
    createRelayAdapter: () => {
      createRelayAdapterCallCount += 1
      if (createRelayAdapterCallCount === 1) {
        return foregroundAdapter
      }
      throw new Error('background adapter failed')
    },
    defaultRelayUrls: ['wss://relay.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }

  const expansion = createNodeExpansionModule(ctx, createBaseCollaborators())

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'ready')
  assert.equal(store.getState().nodeExpansionStates.target.status, 'ready')
  assert.equal(store.getState().expandedNodePubkeys.has('target'), true)
  assert.equal(store.getState().selectedNodePubkey, null)
  assert.ok(createRelayAdapterCallCount > 1)
})

test('expandNode loads the expanded node relay list before fetching its structure', async () => {
  const store = createExpandableStore()
  const createdRelayUrlSets: string[][] = []
  const persistedRelayLists: Array<{
    pubkey: string
    readRelays: string[]
    writeRelays: string[]
    relays: string[]
  }> = []

  const createRelayAdapter = (options: { relayUrls: string[] }) => {
    const relayUrls = options.relayUrls.slice()
    createdRelayUrlSets.push(relayUrls)

    return {
      subscribe(filters: Array<Record<string, unknown>>) {
        return {
          subscribe(observer: {
            next?: (value: unknown) => void
            complete?: (summary: unknown) => void
          }) {
            queueMicrotask(() => {
              const firstFilter = filters[0] ?? {}
              const kinds = firstFilter.kinds as number[] | undefined

              if (kinds?.includes(10002)) {
                observer.next?.({
                  event: {
                    id: 'relay-list-event',
                    pubkey: 'target',
                    kind: 10002,
                    created_at: 124,
                    tags: [['r', 'wss://expanded.example', 'read']],
                  },
                  relayUrl: 'wss://relay.example',
                  receivedAtMs: 124,
                })
              }

              if (
                kinds?.includes(3) &&
                relayUrls.includes('wss://expanded.example')
              ) {
                observer.next?.({
                  event: {
                    id: 'contact-list-event',
                    pubkey: 'target',
                    kind: 3,
                    created_at: 125,
                    tags: [['p', 'visible-follow']],
                  },
                  relayUrl: 'wss://expanded.example',
                  receivedAtMs: 125,
                })
              }

              observer.complete?.({
                relayCount: relayUrls.length,
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
    }
  }

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
      relayLists: {
        get: async () => undefined,
        upsert: async (record: {
          pubkey: string
          readRelays: string[]
          writeRelays: string[]
          relays: string[]
        }) => {
          persistedRelayLists.push(record)
          return record
        },
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
    ...createBaseCollaborators(),
    loadDirectInboundFollowerEvidence: async () => ({
      followerPubkeys: [],
      partial: false,
    }),
  })

  const result = await expansion.expandNode('target')

  assert.equal(result.status, 'ready')
  assert.deepEqual(persistedRelayLists, [
    {
      pubkey: 'target',
      eventId: 'relay-list-event',
      createdAt: 124,
      fetchedAt: 124,
      readRelays: ['wss://expanded.example'],
      writeRelays: [],
      relays: ['wss://expanded.example'],
    },
  ])
  assert.deepEqual(store.getState().relayUrls, [
    'wss://relay.example',
    'wss://expanded.example',
  ])
  assert.ok(
    createdRelayUrlSets.some((relayUrls) =>
      relayUrls.includes('wss://expanded.example'),
    ),
  )
})

test('expandNode keeps multiple expanded-node relays when defaults already fill the old cap', async () => {
  const store = createExpandableStore()
  store.getState().setRelayUrls([
    'wss://relay-1.example',
    'wss://relay-2.example',
    'wss://relay-3.example',
    'wss://relay-4.example',
    'wss://relay-5.example',
    'wss://relay-6.example',
    'wss://relay-7.example',
  ])
  const createdRelayUrlSets: string[][] = []

  const createRelayAdapter = (options: { relayUrls: string[] }) => {
    const relayUrls = options.relayUrls.slice()
    createdRelayUrlSets.push(relayUrls)

    return {
      subscribe(filters: Array<Record<string, unknown>>) {
        return {
          subscribe(observer: {
            next?: (value: unknown) => void
            complete?: (summary: unknown) => void
          }) {
            queueMicrotask(() => {
              const firstFilter = filters[0] ?? {}
              const kinds = firstFilter.kinds as number[] | undefined

              if (kinds?.includes(10002)) {
                observer.next?.({
                  event: {
                    id: 'relay-list-event',
                    pubkey: 'target',
                    kind: 10002,
                    created_at: 124,
                    tags: [
                      ['r', 'wss://expanded-a.example', 'read'],
                      ['r', 'wss://expanded-b.example', 'read'],
                    ],
                  },
                  relayUrl: 'wss://relay-1.example',
                  receivedAtMs: 124,
                })
              }

              observer.complete?.({
                relayCount: relayUrls.length,
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
    }
  }

  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => null,
      },
      relayLists: createRelayListsRepositoryStub(),
    },
    eventsWorker: {
      invoke: async (action: string) => {
        if (action !== 'PARSE_CONTACT_LIST') {
          throw new Error(`unexpected action ${action}`)
        }

        return {
          followPubkeys: [],
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
    defaultRelayUrls: ['wss://relay-1.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }

  const expansion = createNodeExpansionModule(ctx, {
    ...createBaseCollaborators(),
    loadDirectInboundFollowerEvidence: async () => ({
      followerPubkeys: [],
      partial: false,
    }),
  })

  await expansion.expandNode('target')

  assert.deepEqual(store.getState().relayUrls, [
    'wss://relay-1.example',
    'wss://relay-2.example',
    'wss://relay-3.example',
    'wss://relay-4.example',
    'wss://relay-5.example',
    'wss://relay-6.example',
    'wss://relay-7.example',
    'wss://expanded-a.example',
    'wss://expanded-b.example',
  ])
  assert.ok(
    createdRelayUrlSets.some(
      (relayUrls) =>
        relayUrls.includes('wss://expanded-a.example') &&
        relayUrls.includes('wss://expanded-b.example'),
    ),
  )
})
