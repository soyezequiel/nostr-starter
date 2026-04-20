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
const { createKernelEventEmitter } = require('../events.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createNodeDetailModule } = require('./node-detail.ts')

const flushMicrotasks = async (times = 4) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

const createStoreForNodeDetail = () =>
  createStore<Record<string, unknown>>()((...args) => ({
    ...createGraphSlice(...args),
    ...createRelaySlice(...args),
    ...createUiSlice(...args),
  }))

test('getNodeDetail hydrates a selected node when store and cache are incomplete', async () => {
  const store = createStoreForNodeDetail()
  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'idle',
      source: 'follow',
    },
  ])

  const hydrateCalls: Array<{ pubkeys: string[]; relayUrls: string[] }> = []
  const nodeDetail = createNodeDetailModule(
    {
      store,
      repositories: {
        profiles: {
          get: async () => null,
        },
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
      createRelayAdapter: () => ({
        subscribe: () => ({
          subscribe: () => () => {},
        }),
        count: async () => [],
        getRelayHealth: () => ({}),
        subscribeToRelayHealth: () => () => {},
        close: () => {},
      }),
      defaultRelayUrls: ['wss://relay.example'],
      now: () => 1_000,
      emitter: createKernelEventEmitter(),
    },
    {
      persistence: {
        persistContactListEvent: async () => {},
        persistProfileEvent: async () => {},
      },
      profileHydration: {
        hydrateNodeProfiles: async (pubkeys: string[], relayUrls: string[]) => {
          hydrateCalls.push({ pubkeys, relayUrls })
          const existingNode = store.getState().nodes.alice
          store.getState().upsertNodes([
            {
              ...existingNode,
              label: 'katika21',
              picture: 'https://cdn.example.com/alice.jpg',
              about: 'Writer, neuroscientist',
              nip05: 'katika21@nostr.red',
              lud16: 'katika21@getalby.com',
              profileEventId: 'evt-alice',
              profileFetchedAt: 123,
              profileSource: 'relay',
              profileState: 'ready',
            },
          ])
        },
        syncNodeProfile: () => {},
        markNodeProfileMissing: () => {},
      },
    },
  )

  const detail = await nodeDetail.getNodeDetail('alice')

  assert.deepEqual(hydrateCalls, [
    { pubkeys: ['alice'], relayUrls: ['wss://relay.example'] },
  ])
  assert.equal(detail?.name, 'katika21')
  assert.equal(detail?.about, 'Writer, neuroscientist')
  assert.equal(detail?.nip05, 'katika21@nostr.red')
  assert.equal(store.getState().nodes.alice?.label, 'katika21')
  assert.equal(store.getState().nodes.alice?.profileState, 'ready')
})

test('getNodeDetail retries profiles previously marked missing', async () => {
  const store = createStoreForNodeDetail()
  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'missing',
      source: 'follow',
    },
  ])

  let hydrateCalls = 0
  const nodeDetail = createNodeDetailModule(
    {
      store,
      repositories: {
        profiles: {
          get: async () => null,
        },
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
      createRelayAdapter: () => ({
        subscribe: () => ({
          subscribe: () => () => {},
        }),
        count: async () => [],
        getRelayHealth: () => ({}),
        subscribeToRelayHealth: () => () => {},
        close: () => {},
      }),
      defaultRelayUrls: ['wss://relay.example'],
      now: () => 1_000,
      emitter: createKernelEventEmitter(),
    },
    {
      persistence: {
        persistContactListEvent: async () => {},
        persistProfileEvent: async () => {},
      },
      profileHydration: {
        hydrateNodeProfiles: async () => {
          hydrateCalls += 1
          const existingNode = store.getState().nodes.alice
          store.getState().upsertNodes([
            {
              ...existingNode,
              label: 'Ser Sleepy',
              about: 'This is a short bio',
              picture: 'https://cdn.example.com/sleepy.jpg',
              nip05: 'sersleepy@primal.net',
              lud16: 'sersleepy@rizful.com',
              profileEventId: 'evt-sleepy',
              profileFetchedAt: 123,
              profileSource: 'primal-cache',
              profileState: 'ready',
            },
          ])
        },
        syncNodeProfile: () => {},
        markNodeProfileMissing: () => {},
      },
    },
  )

  const detail = await nodeDetail.getNodeDetail('alice')

  assert.equal(hydrateCalls, 1)
  assert.equal(detail?.name, 'Ser Sleepy')
  assert.equal(detail?.about, 'This is a short bio')
  assert.equal(store.getState().nodes.alice?.profileState, 'ready')
})

test('getNodeDetail retries profiles marked ready without usable profile fields', async () => {
  const store = createStoreForNodeDetail()
  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: 'empty-profile-event',
      profileFetchedAt: 100,
      profileSource: 'relay',
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'ready',
      source: 'follow',
    },
  ])

  let hydrateCalls = 0
  const nodeDetail = createNodeDetailModule(
    {
      store,
      repositories: {
        profiles: {
          get: async () => null,
        },
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
      createRelayAdapter: () => ({
        subscribe: () => ({
          subscribe: () => () => {},
        }),
        count: async () => [],
        getRelayHealth: () => ({}),
        subscribeToRelayHealth: () => () => {},
        close: () => {},
      }),
      defaultRelayUrls: ['wss://relay.example'],
      now: () => 1_000,
      emitter: createKernelEventEmitter(),
    },
    {
      persistence: {
        persistContactListEvent: async () => {},
        persistProfileEvent: async () => {},
      },
      profileHydration: {
        hydrateNodeProfiles: async () => {
          hydrateCalls += 1
          const existingNode = store.getState().nodes.alice
          store.getState().upsertNodes([
            {
              ...existingNode,
              label: 'Ser Sleepy',
              about: 'This is a short bio',
              picture: 'https://cdn.example.com/sleepy.jpg',
              nip05: 'sersleepy@primal.net',
              lud16: 'sersleepy@rizful.com',
              profileEventId: 'evt-sleepy',
              profileFetchedAt: 123,
              profileSource: 'primal-cache',
              profileState: 'ready',
            },
          ])
        },
        syncNodeProfile: () => {},
        markNodeProfileMissing: () => {},
      },
    },
  )

  const detail = await nodeDetail.getNodeDetail('alice')

  assert.equal(hydrateCalls, 1)
  assert.equal(detail?.name, 'Ser Sleepy')
  assert.equal(detail?.picture, 'https://cdn.example.com/sleepy.jpg')
  assert.equal(store.getState().nodes.alice?.profileEventId, 'evt-sleepy')
})

test('prefetchNodeProfiles hydrates incomplete visible profiles without selecting them', async () => {
  const store = createStoreForNodeDetail()
  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'missing',
      source: 'follow',
    },
    {
      pubkey: 'bob',
      label: 'Bob',
      picture: 'https://cdn.example.com/bob.jpg',
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 2,
      profileState: 'ready',
      source: 'follow',
    },
  ])

  const hydrateCalls: Array<{ pubkeys: string[]; relayUrls: string[] }> = []
  const nodeDetail = createNodeDetailModule(
    {
      store,
      repositories: {
        profiles: {
          get: async () => null,
        },
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
      createRelayAdapter: () => ({
        subscribe: () => ({
          subscribe: () => () => {},
        }),
        count: async () => [],
        getRelayHealth: () => ({}),
        subscribeToRelayHealth: () => () => {},
        close: () => {},
      }),
      defaultRelayUrls: ['wss://relay.example'],
      now: () => 1_000,
      emitter: createKernelEventEmitter(),
    },
    {
      persistence: {
        persistContactListEvent: async () => {},
        persistProfileEvent: async () => {},
      },
      profileHydration: {
        hydrateNodeProfiles: async (pubkeys: string[], relayUrls: string[]) => {
          hydrateCalls.push({ pubkeys, relayUrls })
          const existingNode = store.getState().nodes.alice
          store.getState().upsertNodes([
            {
              ...existingNode,
              label: 'Alice',
              picture: 'https://cdn.example.com/alice.jpg',
              about: 'Alice bio',
              nip05: 'alice@example.com',
              lud16: null,
              profileEventId: 'evt-alice',
              profileFetchedAt: 123,
              profileSource: 'relay',
              profileState: 'ready',
            },
          ])
        },
        syncNodeProfile: () => {},
        markNodeProfileMissing: () => {},
      },
    },
  )

  const requestedPubkeys = await nodeDetail.prefetchNodeProfiles(['alice', 'bob'])

  assert.deepEqual(requestedPubkeys, ['alice'])
  assert.deepEqual(hydrateCalls, [
    { pubkeys: ['alice'], relayUrls: ['wss://relay.example'] },
  ])
  assert.equal(store.getState().selectedNodePubkey, null)
  assert.equal(store.getState().openPanel, 'overview')
  assert.equal(store.getState().nodes.alice?.label, 'Alice')
})

test('selectNode prefetches node detail metadata for the identity panel', async () => {
  const store = createStoreForNodeDetail()
  store.getState().setRelayUrls(['wss://relay.example'])
  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'idle',
      source: 'follow',
    },
  ])

  let hydrateCalls = 0
  const nodeDetail = createNodeDetailModule(
    {
      store,
      repositories: {
        profiles: {
          get: async () => null,
        },
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
      createRelayAdapter: () => ({
        subscribe: () => ({
          subscribe: () => () => {},
        }),
        count: async () => [],
        getRelayHealth: () => ({}),
        subscribeToRelayHealth: () => () => {},
        close: () => {},
      }),
      defaultRelayUrls: ['wss://relay.example'],
      now: () => 1_000,
      emitter: createKernelEventEmitter(),
    },
    {
      persistence: {
        persistContactListEvent: async () => {},
        persistProfileEvent: async () => {},
      },
      profileHydration: {
        hydrateNodeProfiles: async () => {
          hydrateCalls += 1
          const existingNode = store.getState().nodes.alice
          store.getState().upsertNodes([
            {
              ...existingNode,
              label: 'katika21',
              about: 'Writer, neuroscientist',
              picture: 'https://cdn.example.com/alice.jpg',
              nip05: 'katika21@nostr.red',
              lud16: null,
              profileEventId: 'evt-alice',
              profileFetchedAt: 123,
              profileSource: 'relay',
              profileState: 'ready',
            },
          ])
        },
        syncNodeProfile: () => {},
        markNodeProfileMissing: () => {},
      },
    },
  )

  const result = nodeDetail.selectNode('alice')
  await flushMicrotasks()

  assert.equal(result.selectedPubkey, 'alice')
  assert.equal(store.getState().selectedNodePubkey, 'alice')
  assert.equal(store.getState().openPanel, 'node-detail')
  assert.equal(hydrateCalls, 1)
  assert.equal(store.getState().nodes.alice?.label, 'katika21')
  assert.equal(store.getState().nodes.alice?.about, 'Writer, neuroscientist')
})
