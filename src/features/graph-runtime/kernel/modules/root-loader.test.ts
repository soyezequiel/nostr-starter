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

test('loadRoot dispara inbound suplementario sobre relays nuevos descubiertos en hints del contact list live (cold-start)', async () => {
  // Cold-start: no cache de contact list ni de relay list. El contact list live
  // trae un relay hint que no existe en defaults; esperamos que se dispare un
  // adapter suplementario consultando ese relay nuevo.
  const defaultRelays = ['wss://default-1.example', 'wss://default-2.example']
  const liveOnlyRelay = 'wss://live-hint.example'
  const supplementaryFollower = 'inbound-via-live-hint'

  const store = createBaseStore()
  store.getState().setRelayUrls([])

  const captured: {
    calls: Array<{
      filters: Array<Record<string, unknown>>
      relayUrls: readonly string[] | undefined
    }>
  } = { calls: [] }
  const adapterRelayUrls: string[][] = []

  const adapterFactory = (options: { relayUrls: string[] }) => {
    adapterRelayUrls.push(options.relayUrls.slice())
    return {
      subscribe(
        filters: Array<Record<string, unknown>>,
        subscribeOptions?: { relayUrls?: string[] },
      ) {
        captured.calls.push({ filters, relayUrls: subscribeOptions?.relayUrls })
        return {
          subscribe(observer: {
            next?: (value: unknown) => void
            complete?: (summary: unknown) => void
          }) {
            queueMicrotask(() => {
              const firstFilter = filters[0] ?? {}
              const isContactList =
                Array.isArray(firstFilter.authors) &&
                Array.isArray(firstFilter.kinds) &&
                (firstFilter.kinds as number[]).includes(3)
              const isInbound =
                !Array.isArray(firstFilter.authors) &&
                Array.isArray(firstFilter['#p']) &&
                Array.isArray(firstFilter.kinds) &&
                (firstFilter.kinds as number[]).includes(3)
              const targetRelay = subscribeOptions?.relayUrls?.[0]

              if (isContactList) {
                observer.next?.({
                  event: {
                    id: 'live-contact-list',
                    pubkey: 'root',
                    kind: 3,
                    created_at: 999,
                    tags: [['p', 'follow-a', liveOnlyRelay]],
                  },
                  relayUrl: defaultRelays[0],
                  receivedAtMs: 999,
                })
              } else if (isInbound && targetRelay === liveOnlyRelay) {
                // Solo el relay nuevo (consultado por el supplementary
                // discovery) devuelve este follower.
                observer.next?.({
                  event: {
                    id: 'inbound-from-live-hint',
                    pubkey: supplementaryFollower,
                    kind: 3,
                    created_at: 1000,
                    tags: [['p', 'root']],
                  },
                  relayUrl: liveOnlyRelay,
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
  }

  const ctx = {
    store,
    repositories: {
      contactLists: { get: async () => null },
      profiles: { get: async () => null },
      inboundFollowerSnapshots: {
        get: async () => null,
        upsert: async () => {},
      },
      relayLists: {
        get: async () => null,
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
          .filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string')
          .map((tag) => tag[1] as string)
        const relayHints = payload.event.tags
          .filter(
            (tag) =>
              tag[0] === 'p' &&
              typeof tag[2] === 'string' &&
              tag[2].length > 0,
          )
          .map((tag) => tag[2] as string)
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
    createRelayAdapter: adapterFactory,
    defaultRelayUrls: defaultRelays,
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
    profileHydration: { hydrateNodeProfiles: async () => {} },
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
  await rootLoader.loadRoot('root', { useDefaultRelays: true })
  await flushMicrotasks(20)

  // Verifica que se haya creado un adapter suplementario que incluye el live hint.
  assert.ok(
    adapterRelayUrls.some((urls) => urls.includes(liveOnlyRelay)),
    `expected at least one adapter to include ${liveOnlyRelay}, got ${JSON.stringify(adapterRelayUrls)}`,
  )

  // Verifica que se haya hecho una consulta inbound dirigida al relay nuevo.
  const supplementaryInboundCall = captured.calls.find((call) => {
    const filter = call.filters[0] as
      | (Record<string, unknown> & { '#p'?: unknown; authors?: unknown })
      | undefined
    return (
      filter !== undefined &&
      Array.isArray(filter['#p']) &&
      !Array.isArray(filter.authors) &&
      call.relayUrls?.includes(liveOnlyRelay) === true
    )
  })
  assert.ok(
    supplementaryInboundCall,
    `expected a supplementary inbound subscription targeting ${liveOnlyRelay}, captured ${JSON.stringify(
      captured.calls.map((c) => ({ relayUrls: c.relayUrls })),
    )}`,
  )

  // El follower devuelto por el relay nuevo debe quedar en el grafo.
  const inboundAdjacency = (
    store.getState() as { inboundAdjacency: Record<string, string[]> }
  ).inboundAdjacency
  assert.ok(
    (inboundAdjacency.root ?? []).includes(supplementaryFollower),
    `expected supplementary follower ${supplementaryFollower} in inbound adjacency of root, got ${JSON.stringify(inboundAdjacency.root)}`,
  )
})

test('loadRoot dispara inbound suplementario tambien con read relays NIP-65 (kind:10002) del root en cold-start', async () => {
  // Cold-start: sin cache. El kind:10002 del root anuncia un read relay que no
  // esta en defaults. Esperamos que el discovery suplementario use ese relay.
  const defaultRelays = ['wss://default-1.example', 'wss://default-2.example']
  const nip65ReadRelay = 'wss://nip65-only.example'
  const supplementaryFollower = 'inbound-via-nip65'

  const store = createBaseStore()
  store.getState().setRelayUrls([])

  const captured: {
    calls: Array<{
      filters: Array<Record<string, unknown>>
      relayUrls: readonly string[] | undefined
    }>
  } = { calls: [] }
  const adapterRelayUrls: string[][] = []

  const adapterFactory = (options: { relayUrls: string[] }) => {
    adapterRelayUrls.push(options.relayUrls.slice())
    return {
      subscribe(
        filters: Array<Record<string, unknown>>,
        subscribeOptions?: { relayUrls?: string[] },
      ) {
        captured.calls.push({ filters, relayUrls: subscribeOptions?.relayUrls })
        return {
          subscribe(observer: {
            next?: (value: unknown) => void
            complete?: (summary: unknown) => void
          }) {
            queueMicrotask(() => {
              const firstFilter = filters[0] ?? {}
              const kinds = (firstFilter.kinds as number[] | undefined) ?? []
              const isContactList =
                Array.isArray(firstFilter.authors) && kinds.includes(3)
              const isRelayList =
                Array.isArray(firstFilter.authors) && kinds.includes(10002)
              const isInbound =
                !Array.isArray(firstFilter.authors) &&
                Array.isArray(firstFilter['#p']) &&
                kinds.includes(3)
              const targetRelay = subscribeOptions?.relayUrls?.[0]

              if (isRelayList) {
                // Devolvemos un kind:10002 que declara un read relay nuevo.
                observer.next?.({
                  event: {
                    id: 'root-relay-list',
                    pubkey: 'root',
                    kind: 10002,
                    created_at: 998,
                    tags: [['r', nip65ReadRelay, 'read']],
                  },
                  relayUrl: defaultRelays[0],
                  receivedAtMs: 998,
                })
              } else if (isContactList) {
                observer.next?.({
                  event: {
                    id: 'live-contact-list',
                    pubkey: 'root',
                    kind: 3,
                    created_at: 999,
                    tags: [['p', 'follow-a']],
                  },
                  relayUrl: defaultRelays[0],
                  receivedAtMs: 999,
                })
              } else if (isInbound && targetRelay === nip65ReadRelay) {
                observer.next?.({
                  event: {
                    id: 'inbound-from-nip65',
                    pubkey: supplementaryFollower,
                    kind: 3,
                    created_at: 1000,
                    tags: [['p', 'root']],
                  },
                  relayUrl: nip65ReadRelay,
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
  }

  const ctx = {
    store,
    repositories: {
      contactLists: { get: async () => null },
      profiles: { get: async () => null },
      inboundFollowerSnapshots: {
        get: async () => null,
        upsert: async () => {},
      },
      relayLists: {
        get: async () => null,
        upsert: async () => {},
      },
      relayDiscoveryStats: {
        getMany: async () => [],
        recordCountResults: async () => {},
        recordInboundFetch: async () => {},
      },
    },
    eventsWorker: {
      invoke: async (
        action: string,
        payload: { event: { tags: string[][] } },
      ) => {
        if (action !== 'PARSE_CONTACT_LIST') {
          throw new Error(`unexpected action ${action}`)
        }
        const followPubkeys = payload.event.tags
          .filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string')
          .map((tag) => tag[1] as string)
        return {
          followPubkeys: Array.from(new Set(followPubkeys)).sort(),
          relayHints: [],
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
    createRelayAdapter: adapterFactory,
    defaultRelayUrls: defaultRelays,
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
    profileHydration: { hydrateNodeProfiles: async () => {} },
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
  await rootLoader.loadRoot('root', { useDefaultRelays: true })
  await flushMicrotasks(20)

  // El supplementary adapter debe incluir el read relay del NIP-65.
  assert.ok(
    adapterRelayUrls.some((urls) => urls.includes(nip65ReadRelay)),
    `expected supplementary adapter to include ${nip65ReadRelay}, got ${JSON.stringify(adapterRelayUrls)}`,
  )

  // Debe haber una consulta inbound dirigida a ese relay nuevo.
  const supplementaryInboundCall = captured.calls.find((call) => {
    const filter = call.filters[0] as
      | (Record<string, unknown> & { '#p'?: unknown; authors?: unknown })
      | undefined
    return (
      filter !== undefined &&
      Array.isArray(filter['#p']) &&
      !Array.isArray(filter.authors) &&
      call.relayUrls?.includes(nip65ReadRelay) === true
    )
  })
  assert.ok(
    supplementaryInboundCall,
    `expected supplementary inbound subscription targeting ${nip65ReadRelay}, captured ${JSON.stringify(
      captured.calls.map((c) => ({ relayUrls: c.relayUrls })),
    )}`,
  )

  // El follower devuelto por el relay NIP-65 debe quedar en el grafo.
  const inboundAdjacency = (
    store.getState() as { inboundAdjacency: Record<string, string[]> }
  ).inboundAdjacency
  assert.ok(
    (inboundAdjacency.root ?? []).includes(supplementaryFollower),
    `expected supplementary follower ${supplementaryFollower} in inbound adjacency of root, got ${JSON.stringify(inboundAdjacency.root)}`,
  )
})
