import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'zustand/vanilla'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGraphSlice } = require('../../app/store/slices/graphSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRelaySlice } = require('../../app/store/slices/relaySlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createUiSlice } = require('../../app/store/slices/uiSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPathfindingSlice } = require('../../app/store/slices/pathfindingSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAnalysisSlice } = require('../../app/store/slices/analysisSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createZapSlice } = require('../../app/store/slices/zapSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createKernelEventEmitter } = require('../events.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRootLoaderModule } = require('./root-loader.ts')

const flushMicrotasks = async (times = 6) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

const createBaseStore = () =>
  createStore<Record<string, unknown>>()((...args) => ({
    ...createGraphSlice(...args),
    ...createRelaySlice(...args),
    ...createUiSlice(...args),
    ...createPathfindingSlice(...args),
    ...createAnalysisSlice(...args),
    ...createZapSlice(...args),
  }))

interface CapturedSubscription {
  filters: Array<Record<string, unknown>>
  relayUrls: readonly string[] | undefined
}

const createDeterministicAdapter = (options: {
  inboundEnvelope: { pubkey: string; relayUrl: string }
  contactListEnvelope: { pubkey: string; relayUrl: string; relayHints?: string[] }
}) => {
  const captured: { calls: CapturedSubscription[] } = { calls: [] }
  const adapter = {
    subscribe(
      filters: Array<Record<string, unknown>>,
      subscribeOptions?: { relayUrls?: string[] },
    ) {
      captured.calls.push({ filters, relayUrls: subscribeOptions?.relayUrls })
      return {
        subscribe(observer: {
          next?: (value: unknown) => void
          nextBatch?: (values: unknown[]) => void
          complete?: (summary: unknown) => void
        }) {
          queueMicrotask(() => {
            const firstFilter = filters[0] ?? {}
            const isContactList =
              Array.isArray(firstFilter.authors) &&
              Array.isArray(firstFilter.kinds) &&
              firstFilter.kinds.includes(3)
            const isInbound =
              !Array.isArray(firstFilter.authors) &&
              Array.isArray(firstFilter['#p']) &&
              Array.isArray(firstFilter.kinds) &&
              firstFilter.kinds.includes(3)
            if (isContactList) {
              observer.next?.({
                event: {
                  id: 'contact-list-event',
                  pubkey: options.contactListEnvelope.pubkey,
                  kind: 3,
                  created_at: 999,
                  tags: [
                    ...(options.contactListEnvelope.relayHints?.map((hint) => [
                      'p',
                      'follow-target',
                      hint,
                    ]) ?? []),
                  ],
                },
                relayUrl: options.contactListEnvelope.relayUrl,
                receivedAtMs: 999,
              })
            } else if (isInbound) {
              observer.next?.({
                event: {
                  id: 'inbound-event',
                  pubkey: options.inboundEnvelope.pubkey,
                  kind: 3,
                  created_at: 1000,
                  tags: [['p', options.contactListEnvelope.pubkey]],
                },
                relayUrl: options.inboundEnvelope.relayUrl,
                receivedAtMs: 1000,
              })
            }
            observer.complete?.({
              relayHealth: {},
              stats: {
                acceptedEvents: 1,
                duplicateRelayEvents: 0,
                rejectedEvents: 0,
              },
              filters,
              startedAtMs: 1,
              finishedAtMs: 2,
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
  return { adapter, captured }
}

const createRootLoaderForTest = (overrides: {
  cachedRelayList?: { readRelays: string[]; writeRelays: string[] } | null
  cachedContactList?: {
    follows: string[]
    relayHints: string[]
  } | null
  defaultRelayUrls?: string[]
  inboundEnvelope: { pubkey: string; relayUrl: string }
  contactListEnvelope: { pubkey: string; relayUrl: string; relayHints?: string[] }
}) => {
  const store = createBaseStore()
  store.getState().setRelayUrls(overrides.defaultRelayUrls ?? [])
  const { adapter, captured } = createDeterministicAdapter({
    inboundEnvelope: overrides.inboundEnvelope,
    contactListEnvelope: overrides.contactListEnvelope,
  })
  const ctx = {
    store,
    repositories: {
      contactLists: {
        get: async () => overrides.cachedContactList ?? null,
      },
      profiles: {
        get: async () => null,
      },
      inboundFollowerSnapshots: {
        get: async () => null,
        upsert: async () => {},
      },
      relayLists: {
        get: async () => overrides.cachedRelayList ?? null,
        upsert: async () => {},
      },
      relayDiscoveryStats: {
        getMany: async () => [],
        recordCountResults: async () => {},
        recordInboundFetch: async () => {},
      },
    },
    eventsWorker: {
      invoke: async (action: string, payload: { event: { tags: string[][] } }) => {
        if (action !== 'PARSE_CONTACT_LIST') {
          throw new Error(`unexpected action ${action}`)
        }
        const followPubkeys = payload.event.tags
          .filter((tag: string[]) => tag[0] === 'p' && typeof tag[1] === 'string')
          .map((tag: string[]) => tag[1])
        const relayHints = payload.event.tags
          .filter(
            (tag: string[]) => tag[0] === 'p' && typeof tag[2] === 'string' && tag[2].length > 0,
          )
          .map((tag: string[]) => tag[2])
        return {
          followPubkeys: Array.from(new Set(followPubkeys)).sort(),
          relayHints: Array.from(new Set(relayHints)).sort(),
          diagnostics: [],
          nodes: [],
          links: [],
        }
      },
    },
    graphWorker: {
      invoke: async () => {
        throw new Error('graph worker should not be used in this test')
      },
      dispose: () => {},
    },
    createRelayAdapter: () => adapter,
    defaultRelayUrls: overrides.defaultRelayUrls ?? ['wss://default.example'],
    now: (() => {
      let now = 1_000
      return () => ++now
    })(),
    emitter: createKernelEventEmitter(),
  }
  const collaborators = {
    analysis: { schedule: () => {} },
    persistence: {
      persistContactListEvent: async () => {},
      persistProfileEvent: async () => {},
    },
    profileHydration: {
      hydrateNodeProfiles: async () => {},
    },
    relaySession: {
      clearPendingOverride: () => {},
      publishRelayHealth: () => {},
      resolveRelayHealthSnapshot: () => ({}),
    },
    zapLayer: {
      cancelActiveZapLoad: () => {},
      getZapTargetPubkeys: () => [],
      prefetchZapLayer: async () => {},
    },
  }
  const rootLoader = createRootLoaderModule(ctx, collaborators)
  return { store, rootLoader, captured, ctx }
}

test('loadRoot incluye relay hints del contact list cacheado en el set de discovery', async () => {
  const defaultRelays = [
    'wss://default-1.example',
    'wss://default-2.example',
  ]
  const cachedRelayHint = 'wss://hint-from-cache.example'
  const { store, rootLoader, captured } = createRootLoaderForTest({
    defaultRelayUrls: defaultRelays,
    cachedContactList: {
      follows: ['cached-follow'],
      relayHints: [cachedRelayHint],
    },
    contactListEnvelope: {
      pubkey: 'root',
      relayUrl: defaultRelays[0],
    },
    inboundEnvelope: {
      pubkey: 'inbound-author',
      relayUrl: defaultRelays[1],
    },
  })

  await rootLoader.loadRoot('root', { useDefaultRelays: true })
  await flushMicrotasks()

  const relayUrls = (store.getState() as { relayUrls: string[] }).relayUrls
  assert.ok(
    relayUrls.includes(cachedRelayHint),
    `expected cached relay hint ${cachedRelayHint} in session relays, got ${JSON.stringify(relayUrls)}`,
  )

  const inboundCalls = captured.calls.filter((call) => {
    const filter = call.filters[0]
    return (
      filter !== undefined &&
      Array.isArray((filter as { '#p'?: unknown })['#p'])
    )
  })
  assert.ok(inboundCalls.length > 0, 'expected at least one inbound discovery call')
  const inboundUnion = new Set<string>()
  for (const call of inboundCalls) {
    for (const url of call.relayUrls ?? []) {
      inboundUnion.add(url)
    }
  }
  assert.ok(
    inboundUnion.has(cachedRelayHint),
    `expected inbound discovery to query relay hint ${cachedRelayHint}, queried ${JSON.stringify([...inboundUnion])}`,
  )
})

test('loadRoot expone metricas de inboundDiscovery en visibleLinkProgress', async () => {
  const defaultRelays = ['wss://default-1.example', 'wss://default-2.example']
  const { store, rootLoader } = createRootLoaderForTest({
    defaultRelayUrls: defaultRelays,
    cachedContactList: {
      follows: ['cached-follow'],
      relayHints: [
        'wss://hint-1.example',
        'wss://hint-2.example',
        'wss://hint-3.example',
      ],
    },
    contactListEnvelope: {
      pubkey: 'root',
      relayUrl: defaultRelays[0],
    },
    inboundEnvelope: {
      pubkey: 'inbound-author',
      relayUrl: 'wss://hint-1.example',
    },
  })

  await rootLoader.loadRoot('root', { useDefaultRelays: true })
  await flushMicrotasks()

  const progress = (
    store.getState() as {
      rootLoad: {
        visibleLinkProgress: {
          inboundDiscovery?: {
            discoveredRelayCount: number
            usedRelayCount: number
            droppedByCapCount: number
            contributingRelayCount: number
          } | null
        } | null
      }
    }
  ).rootLoad.visibleLinkProgress
  assert.ok(progress, 'expected visibleLinkProgress to be set')
  const discovery = progress.inboundDiscovery
  assert.ok(discovery, 'expected inboundDiscovery to be reported')
  assert.equal(discovery.discoveredRelayCount, 5)
  assert.equal(discovery.usedRelayCount, 5)
  assert.equal(discovery.droppedByCapCount, 0)
  assert.ok(
    discovery.contributingRelayCount >= 1,
    `expected contributingRelayCount >= 1, got ${discovery.contributingRelayCount}`,
  )
})
