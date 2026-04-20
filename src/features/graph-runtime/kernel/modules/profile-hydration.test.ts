import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'zustand/vanilla'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGraphSlice } = require('../../app/store/slices/graphSlice.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createProfileHydrationModule } = require('./profile-hydration.ts')

const PROFILE_PATCH_BUFFER_FLUSH_MS = 16

const createStoreForProfileHydration = () =>
  createStore<Record<string, unknown>>()((...args) => ({
    ...createGraphSlice(...args),
  }))

const seedNode = (store: ReturnType<typeof createStoreForProfileHydration>, pubkey: string) => {
  store.getState().upsertNodes([
    {
      pubkey,
      label: null,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'loading',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])
}

const instrumentPatchWrites = (
  store: ReturnType<typeof createStoreForProfileHydration>,
) => {
  const writes: Array<Array<Record<string, unknown>>> = []
  const original = store.getState().upsertNodePatches

  store.setState({
    upsertNodePatches: (patches: Array<Record<string, unknown>>) => {
      writes.push(patches.map((patch) => ({ ...patch })))
      return original(patches)
    },
  })

  return writes
}

const createContext = (store: ReturnType<typeof createStoreForProfileHydration>) => ({
  store,
  repositories: {
    profiles: {
      getMany: async () => [],
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
  emitter: {},
})

test('buffered profile sync coalesces multiple updates for the same pubkey into one write', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())

  const store = createStoreForProfileHydration()
  seedNode(store, 'alice')
  const writes = instrumentPatchWrites(store)
  const hydration = createProfileHydrationModule(createContext(store))

  hydration.syncNodeProfile(
    'alice',
    {
      eventId: 'evt-1',
      fetchedAt: 1,
      profileSource: 'relay',
      name: 'Alice',
      about: 'Primer bio',
      picture: 'https://cdn.example.com/alice-1.jpg',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
    },
    undefined,
    { buffered: true },
  )
  hydration.syncNodeProfile(
    'alice',
    {
      eventId: 'evt-2',
      fetchedAt: 2,
      profileSource: 'relay',
      name: 'Alice Final',
      about: 'Bio final',
      picture: 'https://cdn.example.com/alice-2.jpg',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
    },
    undefined,
    { buffered: true },
  )

  assert.equal(writes.length, 0)

  t.mock.timers.tick(PROFILE_PATCH_BUFFER_FLUSH_MS)

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.length, 1)
  assert.equal(writes[0]?.[0]?.label, 'Alice Final')
  assert.equal(writes[0]?.[0]?.about, 'Bio final')
  assert.equal(store.getState().nodes.alice?.label, 'Alice Final')
  assert.equal(store.getState().nodes.alice?.about, 'Bio final')
  assert.equal(store.getState().nodes.alice?.profileEventId, 'evt-2')
})

test('buffered profile sync flushes bursts in a few batched writes instead of one write per profile', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())

  const store = createStoreForProfileHydration()
  for (let index = 0; index < 100; index += 1) {
    seedNode(store, `pubkey-${index}`)
  }
  const writes = instrumentPatchWrites(store)
  const hydration = createProfileHydrationModule(createContext(store))

  for (let index = 0; index < 100; index += 1) {
    hydration.syncNodeProfile(
      `pubkey-${index}`,
      {
        eventId: `evt-${index}`,
        fetchedAt: index,
        profileSource: 'relay',
        name: `User ${index}`,
        about: `Bio ${index}`,
        picture: null,
        nip05: null,
        lud16: null,
      },
      undefined,
      { buffered: true },
    )
  }

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.length, 64)

  t.mock.timers.tick(PROFILE_PATCH_BUFFER_FLUSH_MS)

  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.length, 36)
  assert.equal(writes.flat().length, 100)
  assert.equal(store.getState().nodes['pubkey-99']?.profileState, 'ready')
})

test('buffered missing markers do not stomp newer ready profile patches for the same pubkey', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())

  const store = createStoreForProfileHydration()
  seedNode(store, 'alice')
  const writes = instrumentPatchWrites(store)
  const hydration = createProfileHydrationModule(createContext(store))

  hydration.markNodeProfileMissing('alice', { buffered: true })
  hydration.syncNodeProfile(
    'alice',
    {
      eventId: 'evt-ready',
      fetchedAt: 5,
      profileSource: 'relay',
      name: 'Alice Ready',
      about: 'Bio vigente',
      picture: 'https://cdn.example.com/alice-ready.jpg',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
    },
    undefined,
    { buffered: true },
  )

  t.mock.timers.tick(PROFILE_PATCH_BUFFER_FLUSH_MS)

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.length, 1)
  assert.equal(store.getState().nodes.alice?.profileState, 'ready')
  assert.equal(store.getState().nodes.alice?.label, 'Alice Ready')
  assert.equal(store.getState().nodes.alice?.about, 'Bio vigente')
  assert.equal(
    store.getState().nodes.alice?.picture,
    'https://cdn.example.com/alice-ready.jpg',
  )
  assert.equal(store.getState().nodes.alice?.profileEventId, 'evt-ready')
})
