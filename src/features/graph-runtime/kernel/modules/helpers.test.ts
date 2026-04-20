import assert from 'node:assert/strict'
import test from 'node:test'
import type { Event, Filter } from 'nostr-tools'

import type { RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import type {
  RelayEventEnvelope,
  RelaySubscribeOptions,
  RelaySubscriptionSummary,
} from '@/features/graph-runtime/nostr'
import type { EventsWorkerActionMap } from '@/features/graph-runtime/workers/events/contracts'
import type { WorkerClient } from '@/features/graph-runtime/workers/shared/runtime'
import {
  collectAdditionalPaginatedInboundFollowerEvents,
  collectTargetedReciprocalFollowerEvidence,
  mapProfileRecordToNodeProfile,
  safeParseProfile,
} from './helpers'

test('safeParseProfile acepta image y normaliza URLs de media', () => {
  const parsed = safeParseProfile(
    JSON.stringify({
      display_name: 'Alice',
      about: 'bio',
      image: 'ipfs://bafybeiavatarcid/profile.png',
      nip05: 'alice@example.com',
    }),
  )

  assert.deepEqual(parsed, {
    name: 'Alice',
    about: 'bio',
    picture: 'https://ipfs.io/ipfs/bafybeiavatarcid/profile.png',
    pictureSource: 'ipfs://bafybeiavatarcid/profile.png',
    nip05: 'alice@example.com',
    lud16: null,
  })
})

test('mapProfileRecordToNodeProfile normaliza URLs cacheadas antes de renderizar', () => {
  const profile = mapProfileRecordToNodeProfile({
    pubkey: 'pubkey',
    eventId: 'event',
    createdAt: 123,
    fetchedAt: 456,
    name: 'Alice',
    about: null,
    picture: '//cdn.example.com/avatar.png',
    nip05: null,
    lud16: null,
  })

  assert.equal(profile.picture, 'https://cdn.example.com/avatar.png')
  assert.equal(profile.name, 'Alice')
  assert.equal(profile.eventId, 'event')
  assert.equal(profile.fetchedAt, 456)
})

test('collectTargetedReciprocalFollowerEvidence consulta follows por author y valida reciprocidad', async () => {
  const rootPubkey = 'root'
  const envelopes = [
    createContactListEnvelope('alice', ['root'], 'event-alice'),
    createContactListEnvelope('bob', ['someone-else'], 'event-bob'),
  ]
  const capturedFilters: Filter[][] = []

  const adapter: RelayAdapterInstance = {
    subscribe(filters) {
      capturedFilters.push(filters)
      return {
        subscribe(observer) {
          queueMicrotask(() => {
            observer.nextBatch?.(envelopes)
            observer.complete?.(createRelaySummary(filters))
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
  const eventsWorker: WorkerClient<EventsWorkerActionMap> = {
    invoke: async (action, payload) => {
      assert.equal(action, 'PARSE_CONTACT_LIST')

      return {
        followPubkeys: payload.event.tags
          .filter((tag) => tag[0] === 'p' && tag[1])
          .map((tag) => tag[1]),
        relayHints: [],
        diagnostics: [],
      }
    },
    dispose: () => {},
  }

  const evidence = await collectTargetedReciprocalFollowerEvidence({
    adapter,
    eventsWorker,
    followPubkeys: ['bob', 'alice', 'root', 'alice'],
    targetPubkey: rootPubkey,
  })

  assert.deepEqual(evidence, {
    followerPubkeys: ['alice'],
    partial: false,
  })
  assert.deepEqual(capturedFilters, [
    [
      {
        authors: ['alice', 'bob'],
        kinds: [3],
        '#p': ['root'],
        limit: 50,
      },
    ],
  ])
})

test('collectAdditionalPaginatedInboundFollowerEvents pagina por relay con cursor until', async () => {
  const rootPubkey = 'root'
  const relayA = 'wss://relay-a.example'
  const relayB = 'wss://relay-b.example'
  const seedEnvelopes = [
    createContactListEnvelope('alice', ['root'], 'event-a1', {
      createdAt: 300,
      relayUrl: relayA,
    }),
    createContactListEnvelope('bob', ['root'], 'event-a2', {
      createdAt: 200,
      relayUrl: relayA,
    }),
    createContactListEnvelope('carol', ['root'], 'event-b1', {
      createdAt: 250,
      relayUrl: relayB,
    }),
  ]
  const pageEnvelopes = [
    createContactListEnvelope('dave', ['root'], 'event-a3', {
      createdAt: 190,
      relayUrl: relayA,
    }),
    createContactListEnvelope('erin', ['root'], 'event-a4', {
      createdAt: 180,
      relayUrl: relayA,
    }),
  ]
  const capturedQueries: Array<{
    filters: Filter[]
    relayUrls: string[] | undefined
  }> = []

  const adapter: RelayAdapterInstance = {
    subscribe(filters, options?: RelaySubscribeOptions) {
      capturedQueries.push({
        filters,
        relayUrls: options?.relayUrls,
      })
      return {
        subscribe(observer) {
          queueMicrotask(() => {
            const filter = filters[0]
            const relayUrl = options?.relayUrls?.[0]
            const envelopes =
              relayUrl === relayA && filter?.until === 199
                ? pageEnvelopes
                : []

            observer.nextBatch?.(envelopes)
            observer.complete?.(createRelaySummary(filters))
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
  const pageProgress: Array<{
    relayUrl: string
    pageIndex: number
    newEventCount: number
    totalNewEventCount: number
  }> = []

  const result = await collectAdditionalPaginatedInboundFollowerEvents({
    adapter,
    countResults: [
      {
        relayUrl: relayA,
        count: 4,
        supported: true,
        elapsedMs: 10,
        errorMessage: null,
      },
      {
        relayUrl: relayB,
        count: 1,
        supported: true,
        elapsedMs: 10,
        errorMessage: null,
      },
    ],
    maxPagesPerRelay: 3,
    onPage: (progress) => {
      pageProgress.push({
        relayUrl: progress.relayUrl,
        pageIndex: progress.pageIndex,
        newEventCount: progress.newEventCount,
        totalNewEventCount: progress.totalNewEventCount,
      })
    },
    pageConcurrency: 1,
    pageLimit: 2,
    relayLimit: 2,
    relayUrls: [relayB, relayA],
    seedEnvelopes,
    targetPubkey: rootPubkey,
  })

  assert.deepEqual(
    result.events.map((envelope) => envelope.event.id),
    ['event-a3', 'event-a4'],
  )
  assert.equal(result.pageCount, 1)
  assert.deepEqual(result.relaySummaries, [
    {
      relayUrl: relayA,
      seedEventCount: 2,
      knownCount: 4,
      requestedPageCount: 1,
      collectedEventCount: 4,
      newEventCount: 2,
      stoppedReason: 'count-reached',
    },
    {
      relayUrl: relayB,
      seedEventCount: 1,
      knownCount: 1,
      requestedPageCount: 0,
      collectedEventCount: 1,
      newEventCount: 0,
      stoppedReason: 'not-needed',
    },
  ])
  assert.deepEqual(capturedQueries, [
    {
      relayUrls: [relayA],
      filters: [
        {
          kinds: [3],
          '#p': ['root'],
          limit: 2,
          until: 199,
        },
      ],
    },
  ])
  assert.deepEqual(pageProgress, [
    {
      relayUrl: relayA,
      pageIndex: 2,
      newEventCount: 2,
      totalNewEventCount: 2,
    },
  ])
})

test('collectAdditionalPaginatedInboundFollowerEvents pagina relays con COUNT util aunque el seed inicial sea bajo', async () => {
  const rootPubkey = 'root'
  const relayA = 'wss://relay-a.example'
  const seedEnvelopes = [
    createContactListEnvelope('alice', ['root'], 'event-a1', {
      createdAt: 300,
      relayUrl: relayA,
    }),
  ]
  const pageEnvelopes = [
    createContactListEnvelope('bob', ['root'], 'event-a2', {
      createdAt: 200,
      relayUrl: relayA,
    }),
  ]
  const capturedQueries: Array<{
    filters: Filter[]
    relayUrls: string[] | undefined
  }> = []

  const adapter: RelayAdapterInstance = {
    subscribe(filters, options?: RelaySubscribeOptions) {
      capturedQueries.push({
        filters,
        relayUrls: options?.relayUrls,
      })
      return {
        subscribe(observer) {
          queueMicrotask(() => {
            observer.nextBatch?.(pageEnvelopes)
            observer.complete?.(createRelaySummary(filters))
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

  const result = await collectAdditionalPaginatedInboundFollowerEvents({
    adapter,
    countResults: [
      {
        relayUrl: relayA,
        count: 2,
        supported: true,
        elapsedMs: 10,
        errorMessage: null,
      },
    ],
    maxPagesPerRelay: 2,
    pageConcurrency: 1,
    pageLimit: 250,
    relayLimit: 1,
    relayUrls: [relayA],
    seedEnvelopes,
    targetPubkey: rootPubkey,
  })

  assert.equal(result.pageCount, 1)
  assert.deepEqual(
    result.events.map((envelope) => envelope.event.id),
    ['event-a2'],
  )
  assert.deepEqual(capturedQueries, [
    {
      relayUrls: [relayA],
      filters: [
        {
          kinds: [3],
          '#p': ['root'],
          limit: 250,
          until: 299,
        },
      ],
    },
  ])
})

test('collectAdditionalPaginatedInboundFollowerEvents pagina relays sin seed inicial cuando COUNT reporta followers', async () => {
  const rootPubkey = 'root'
  const relayA = 'wss://relay-a.example'
  const pageEnvelopes = [
    createContactListEnvelope('alice', ['root'], 'event-a1', {
      createdAt: 300,
      relayUrl: relayA,
    }),
    createContactListEnvelope('bob', ['root'], 'event-a2', {
      createdAt: 200,
      relayUrl: relayA,
    }),
  ]
  const capturedQueries: Array<{
    filters: Filter[]
    relayUrls: string[] | undefined
  }> = []

  const adapter: RelayAdapterInstance = {
    subscribe(filters, options?: RelaySubscribeOptions) {
      capturedQueries.push({
        filters,
        relayUrls: options?.relayUrls,
      })
      return {
        subscribe(observer) {
          queueMicrotask(() => {
            observer.nextBatch?.(pageEnvelopes)
            observer.complete?.(createRelaySummary(filters))
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

  const result = await collectAdditionalPaginatedInboundFollowerEvents({
    adapter,
    countResults: [
      {
        relayUrl: relayA,
        count: 2,
        supported: true,
        elapsedMs: 10,
        errorMessage: null,
      },
    ],
    maxPagesPerRelay: 1,
    pageConcurrency: 1,
    pageLimit: 250,
    relayLimit: 1,
    relayUrls: [relayA],
    seedEnvelopes: [],
    targetPubkey: rootPubkey,
  })

  assert.equal(result.pageCount, 1)
  assert.deepEqual(
    result.events.map((envelope) => envelope.event.id),
    ['event-a1', 'event-a2'],
  )
  assert.deepEqual(result.relaySummaries, [
    {
      relayUrl: relayA,
      seedEventCount: 0,
      knownCount: 2,
      requestedPageCount: 1,
      collectedEventCount: 2,
      newEventCount: 2,
      stoppedReason: 'count-reached',
    },
  ])
  assert.deepEqual(capturedQueries, [
    {
      relayUrls: [relayA],
      filters: [
        {
          kinds: [3],
          '#p': ['root'],
          limit: 250,
        },
      ],
    },
  ])
})

function createContactListEnvelope(
  pubkey: string,
  followPubkeys: string[],
  id: string,
  options: {
    createdAt?: number
    relayUrl?: string
  } = {},
): RelayEventEnvelope {
  return {
    event: {
      id,
      pubkey,
      kind: 3,
      created_at: options.createdAt ?? 123,
      tags: followPubkeys.map((followPubkey) => ['p', followPubkey]),
      content: '',
      sig: '',
    } satisfies Event,
    relayUrl: options.relayUrl ?? 'wss://relay.example',
    receivedAtMs: 123,
    attempt: 0,
  }
}

function createRelaySummary(filters: Filter[]): RelaySubscriptionSummary {
  return {
    filters,
    startedAtMs: 1,
    finishedAtMs: 2,
    relayHealth: {},
    stats: {
      acceptedEvents: 0,
      duplicateRelayEvents: 0,
      rejectedEvents: 0,
    },
  }
}
