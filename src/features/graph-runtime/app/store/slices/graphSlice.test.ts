import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'zustand/vanilla'
import type { GraphSlice } from '@/features/graph-runtime/app/store/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGraphSlice } = require('./graphSlice.ts')

const createStoreForGraphSlice = () =>
  createStore<GraphSlice>()((...args) => ({
    ...createGraphSlice(...args),
  }))

test('upsertNodes ignores undefined patch fields for existing nodes', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: 'https://cdn.example.com/alice.jpg',
      about: 'Original profile',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
      profileEventId: 'evt-1',
      profileFetchedAt: 1_000,
      profileSource: 'relay',
      profileState: 'ready',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: undefined,
      picture: undefined,
      about: 'Updated profile',
      nip05: undefined,
      lud16: undefined,
      profileEventId: 'evt-2',
      profileFetchedAt: 2_000,
      profileSource: 'relay',
      profileState: 'ready',
      keywordHits: 1,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  const node = store.getState().nodes.alice

  assert.equal(node.label, 'Alice')
  assert.equal(node.picture, 'https://cdn.example.com/alice.jpg')
  assert.equal(node.nip05, 'alice@example.com')
  assert.equal(node.lud16, 'alice@getalby.com')
  assert.equal(node.about, 'Updated profile')
  assert.equal(node.profileEventId, 'evt-2')
})

test('upsertNodes still allows explicit null profile field clears', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: 'https://cdn.example.com/alice.jpg',
      about: 'Original profile',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
      profileEventId: 'evt-1',
      profileFetchedAt: 1_000,
      profileSource: 'relay',
      profileState: 'ready',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: null as unknown as string,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'missing',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  const node = store.getState().nodes.alice

  assert.equal(node.label, null)
  assert.equal(node.picture, null)
  assert.equal(node.about, null)
  assert.equal(node.nip05, null)
  assert.equal(node.lud16, null)
  assert.equal(node.profileEventId, null)
})

test('upsertNodePatches merges same-pubkey patches into one visual and detail revision bump', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: 'https://cdn.example.com/alice.jpg',
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

  const before = store.getState()
  const result = store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      about: 'Primer bio',
      profileFetchedAt: 10,
      profileState: 'loading',
    },
    {
      pubkey: 'alice',
      label: 'Alice Final',
    },
    {
      pubkey: 'alice',
      about: 'Bio final',
      profileFetchedAt: 20,
      profileSource: 'relay',
      profileState: 'ready',
    },
  ])
  const after = store.getState()

  assert.deepEqual(result.acceptedPubkeys, ['alice'])
  assert.deepEqual(result.rejectedPubkeys, [])
  assert.equal(after.nodes.alice?.label, 'Alice Final')
  assert.equal(after.nodes.alice?.about, 'Bio final')
  assert.equal(after.nodes.alice?.profileFetchedAt, 20)
  assert.equal(after.nodes.alice?.profileSource, 'relay')
  assert.equal(after.nodes.alice?.profileState, 'ready')
  assert.equal(after.graphRevision, before.graphRevision)
  assert.equal(after.nodeVisualRevision, before.nodeVisualRevision + 1)
  assert.equal(after.nodeDetailRevision, before.nodeDetailRevision + 1)
})

test('upsertNodePatches only bumps detail revision for detail-only changes', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
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

  const before = store.getState()
  store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      about: 'Detail-only update',
      profileFetchedAt: 42,
      profileSource: 'relay',
      profileState: 'ready',
    },
  ])
  const after = store.getState()

  assert.equal(after.graphRevision, before.graphRevision)
  assert.equal(after.nodeVisualRevision, before.nodeVisualRevision)
  assert.equal(after.nodeDetailRevision, before.nodeDetailRevision + 1)
})

test('upsertNodePatches bumps visual revision for visual changes', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'idle',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  const before = store.getState()
  store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      label: 'Alice Updated',
    },
  ])
  const after = store.getState()

  assert.equal(after.graphRevision, before.graphRevision)
  assert.equal(after.nodeVisualRevision, before.nodeVisualRevision + 1)
  assert.equal(after.nodeDetailRevision, before.nodeDetailRevision)
})

test('setNodeExpansionState bumps visual revision only when the expansion state changes', () => {
  const store = createStoreForGraphSlice()

  store.getState().upsertNodes([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'idle',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])

  const before = store.getState()
  const loadingState = {
    status: 'loading' as const,
    message: 'Expandiendo',
    phase: 'fetching-structure' as const,
    step: 2,
    totalSteps: 4,
    startedAt: 10,
    updatedAt: 20,
  }

  store.getState().setNodeExpansionState('alice', loadingState)
  const afterChange = store.getState()
  store.getState().setNodeExpansionState('alice', loadingState)
  const afterDuplicate = store.getState()

  assert.equal(
    afterChange.nodeVisualRevision,
    before.nodeVisualRevision + 1,
  )
  assert.equal(
    afterDuplicate.nodeVisualRevision,
    afterChange.nodeVisualRevision,
  )
})

test('setConnectionsLinks skips revision bump for equivalent links', () => {
  const store = createStoreForGraphSlice()
  const links = [
    { source: 'alice', target: 'bob', relation: 'follow' as const },
    { source: 'bob', target: 'carol', relation: 'follow' as const },
  ]

  store.getState().setConnectionsLinks(links)
  const afterFirstWrite = store.getState()
  store.getState().setConnectionsLinks(links.map((link) => ({ ...link })))
  const afterDuplicateWrite = store.getState()

  assert.equal(afterFirstWrite.connectionsLinksRevision, 1)
  assert.equal(
    afterDuplicateWrite.connectionsLinksRevision,
    afterFirstWrite.connectionsLinksRevision,
  )
  assert.equal(afterDuplicateWrite.connectionsLinks, afterFirstWrite.connectionsLinks)
})

test('upsertNodePatches preserves maxNodes and rejected pubkeys', () => {
  const store = createStoreForGraphSlice()

  store.getState().setGraphMaxNodes(1)
  store.getState().upsertNodes([
    {
      pubkey: 'root',
      label: 'Root',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      keywordHits: 0,
      discoveredAt: 0,
      source: 'root',
    },
  ])

  const before = store.getState()
  const result = store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      keywordHits: 0,
      discoveredAt: 1,
      source: 'follow',
    },
  ])
  const after = store.getState()

  assert.deepEqual(result.acceptedPubkeys, [])
  assert.deepEqual(result.rejectedPubkeys, ['alice'])
  assert.equal(after.graphCaps.capReached, true)
  assert.equal(Object.keys(after.nodes).length, 1)
  assert.equal(after.graphRevision, before.graphRevision)
  assert.equal(after.nodeVisualRevision, before.nodeVisualRevision)
  assert.equal(after.nodeDetailRevision, before.nodeDetailRevision)
})
