import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppStore } from '@/features/graph-runtime/app/store/createAppStore'
import type { AppStoreApi } from '@/features/graph-runtime/app/store/types'
import { GraphDomainStore } from '@/features/graph-v2/application/GraphDomainStore'
import { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'

const createRuntimeStub = () => ({
  loadRoot: async () => ({
    status: 'ready' as const,
    loadedFrom: 'live' as const,
    discoveredFollowCount: 0,
    message: 'ok',
    relayHealth: {},
  }),
  reconfigureRelays: async () => ({
    status: 'applied' as const,
    relayUrls: [],
    message: 'ok',
    diagnostics: [],
    isGraphStale: false,
    relayHealth: {},
  }),
  revertRelayOverride: async () => null,
  expandNode: async () => ({
    status: 'ready' as const,
    discoveredFollowCount: 0,
    rejectedPubkeys: [],
    message: 'ok',
  }),
  toggleLayer: () => ({
    previousLayer: 'graph' as const,
    activeLayer: 'graph' as const,
    message: null,
  }),
  findPath: async () => ({
    path: null,
    visitedCount: 0,
    algorithm: 'bfs' as const,
  }),
  selectNode: () => ({
    previousPubkey: null,
    selectedPubkey: null,
  }),
  getNodeDetail: async () => null,
  prefetchNodeProfiles: async () => [],
})

test('mirrors the paired store state into the canonical domain store', () => {
  const store = createAppStore()
  const runtime = createRuntimeStub()
  const bridge = new LegacyKernelBridge({
    runtime,
    store,
    domainStore: new GraphDomainStore(),
  })

  store.getState().setRootLoadState({
    status: 'loading',
    message: 'Cargando root...',
    loadedFrom: 'none',
  })
  store.getState().setRootNodePubkey('root-pubkey')
  store.getState().setRelayUrls(['wss://relay.example'])

  const state = bridge.getState()

  assert.equal(state.discoveryState.rootLoad.status, 'loading')
  assert.equal(state.discoveryState.rootLoad.message, 'Cargando root...')
  assert.equal(state.rootPubkey, 'root-pubkey')
  assert.deepEqual(state.relayState.urls, ['wss://relay.example'])

  bridge.dispose()
})

test('can reconnect after dispose and resume syncing store changes', () => {
  const store = createAppStore()
  const bridge = new LegacyKernelBridge({
    runtime: createRuntimeStub(),
    store,
    domainStore: new GraphDomainStore(),
  })

  bridge.dispose()
  store.getState().setRootNodePubkey('missed-while-disconnected')
  assert.equal(bridge.getState().rootPubkey, null)

  bridge.connect()
  assert.equal(bridge.getState().rootPubkey, 'missed-while-disconnected')

  store.getState().setRootLoadState({
    status: 'loading',
    message: 'recargando',
    loadedFrom: 'none',
  })

  assert.equal(bridge.getState().discoveryState.rootLoad.status, 'loading')
  assert.equal(bridge.getState().discoveryState.rootLoad.message, 'recargando')

  bridge.dispose()
})

test('reuses the adapted canonical snapshot when unrelated legacy UI state changes', () => {
  const store = createAppStore()
  const bridge = new LegacyKernelBridge({
    runtime: createRuntimeStub(),
    store,
    domainStore: new GraphDomainStore(),
  })

  const firstState = bridge.getState()
  let emits = 0
  const unsubscribe = bridge.subscribe(() => {
    emits += 1
  })

  store.getState().setOpenPanel('relay-config')

  assert.equal(bridge.getState(), firstState)
  assert.equal(emits, 0)

  unsubscribe()
  bridge.dispose()
})

test('rebuilds only the affected adapted slices when graph data changes', () => {
  const store = createAppStore()
  const bridge = new LegacyKernelBridge({
    runtime: createRuntimeStub(),
    store,
    domainStore: new GraphDomainStore(),
  })

  const initialState = bridge.getState()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  const nextState = bridge.getState()

  assert.notEqual(nextState, initialState)
  assert.notEqual(nextState.nodesByPubkey, initialState.nodesByPubkey)
  assert.equal(nextState.edgesById, initialState.edgesById)
  assert.equal(nextState.relayState, initialState.relayState)
  assert.notEqual(nextState.discoveryState, initialState.discoveryState)

  bridge.dispose()
})

test('rejects custom runtime/store mismatches at construction time', () => {
  assert.throws(
    () =>
      new LegacyKernelBridge({
        runtime: createRuntimeStub(),
      }),
    /runtime and store to be provided together/i,
  )

  assert.throws(
    () =>
      new LegacyKernelBridge({
        store: createAppStore() as AppStoreApi,
      }),
    /runtime and store to be provided together/i,
  )
})
