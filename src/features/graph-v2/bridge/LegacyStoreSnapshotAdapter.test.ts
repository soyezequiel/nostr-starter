import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppStore } from '@/features/graph-runtime/app/store/createAppStore'
import { LegacyStoreSnapshotAdapter } from '@/features/graph-v2/bridge/LegacyStoreSnapshotAdapter'

test('keeps the scene signature stable for progress and relay health updates', () => {
  const store = createAppStore()
  const state = store.getState()
  state.setRelayUrls(['wss://relay.example'])
  state.setRootNodePubkey('root')
  state.upsertNodes([
    {
      pubkey: 'root',
      label: 'Root',
      keywordHits: 0,
      discoveredAt: 0,
      profileState: 'ready',
      source: 'root',
    },
    {
      pubkey: 'alice',
      label: 'Alice',
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'ready',
      source: 'follow',
    },
  ])
  state.upsertLinks([{ source: 'root', target: 'alice', relation: 'follow' }])

  const adapter = new LegacyStoreSnapshotAdapter()
  const firstScene = adapter.adaptScene(store.getState())
  const firstUi = adapter.adaptUi(store.getState())

  store.getState().setRootLoadState({
    message: 'Descubriendo links visibles...',
    visibleLinkProgress: {
      visibleLinkCount: 1,
      contactListEventCount: 1,
      inboundCandidateEventCount: 0,
      lastRelayUrl: 'wss://relay.example',
      updatedAt: 1,
      following: {
        status: 'partial',
        loadedCount: 1,
        totalCount: 1,
        isTotalKnown: true,
      },
      followers: {
        status: 'loading',
        loadedCount: 0,
        totalCount: null,
        isTotalKnown: false,
      },
    },
  })
  store.getState().updateRelayHealth('wss://relay.example', {
    status: 'connected',
    lastCheckedAt: 1,
  })
  const secondScene = adapter.adaptScene(store.getState())
  const secondUi = adapter.adaptUi(store.getState())

  assert.equal(secondScene, firstScene)
  assert.notEqual(secondUi, firstUi)
  assert.equal(secondScene.sceneSignature, firstScene.sceneSignature)
})

test('keeps the scene signature stable for non-visual node updates', () => {
  const store = createAppStore()
  const state = store.getState()
  state.setRootNodePubkey('root')
  state.upsertNodes([
    {
      pubkey: 'root',
      label: 'Root',
      keywordHits: 0,
      discoveredAt: 0,
      profileState: 'ready',
      source: 'root',
    },
    {
      pubkey: 'alice',
      label: 'Alice',
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'ready',
      source: 'follow',
    },
  ])
  state.upsertLinks([{ source: 'root', target: 'alice', relation: 'follow' }])

  const adapter = new LegacyStoreSnapshotAdapter()
  const first = adapter.adaptScene(store.getState())

  store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      about: 'Profile detail update',
      profileFetchedAt: 2,
      profileState: 'loading',
    },
  ])
  const second = adapter.adaptScene(store.getState())

  assert.equal(second.discoveryState.graphRevision, first.discoveryState.graphRevision)
  assert.equal(second.nodeVisualRevision, first.nodeVisualRevision)
  assert.equal(second.nodeDetailRevision, first.nodeDetailRevision + 1)
  assert.equal(second.sceneSignature, first.sceneSignature)
})

test('changes the scene signature for visual node updates', () => {
  const store = createAppStore()
  const state = store.getState()
  state.setRootNodePubkey('root')
  state.upsertNodes([
    {
      pubkey: 'root',
      label: 'Root',
      keywordHits: 0,
      discoveredAt: 0,
      profileState: 'ready',
      source: 'root',
    },
    {
      pubkey: 'alice',
      label: 'Alice',
      keywordHits: 0,
      discoveredAt: 1,
      profileState: 'ready',
      source: 'follow',
    },
  ])
  state.upsertLinks([{ source: 'root', target: 'alice', relation: 'follow' }])

  const adapter = new LegacyStoreSnapshotAdapter()
  const first = adapter.adaptScene(store.getState())

  store.getState().upsertNodePatches([
    {
      pubkey: 'alice',
      label: 'Alice Updated',
    },
  ])
  const second = adapter.adaptScene(store.getState())

  assert.equal(second.nodeVisualRevision, first.nodeVisualRevision + 1)
  assert.equal(second.nodeDetailRevision, first.nodeDetailRevision)
  assert.notEqual(second.sceneSignature, first.sceneSignature)
})

test('projects the fixed root into the canonical pinned set and scene signature', () => {
  const store = createAppStore()
  const state = store.getState()
  state.setRootNodePubkey('root')
  state.upsertNodes([
    {
      pubkey: 'root',
      label: 'Root',
      keywordHits: 0,
      discoveredAt: 0,
      profileState: 'ready',
      source: 'root',
    },
  ])

  const adapter = new LegacyStoreSnapshotAdapter()
  const before = adapter.adaptScene(store.getState())

  state.setFixedRootPubkey('root')
  const pinned = adapter.adaptScene(store.getState())

  assert.equal(pinned.pinnedNodePubkeys.has('root'), true)
  assert.notEqual(pinned.sceneSignature, before.sceneSignature)

  state.setFixedRootPubkey(null)
  const released = adapter.adaptScene(store.getState())

  assert.equal(released.pinnedNodePubkeys.has('root'), false)
  assert.notEqual(released.sceneSignature, pinned.sceneSignature)
})
