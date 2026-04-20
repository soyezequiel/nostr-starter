import assert from 'node:assert/strict'
import test from 'node:test'

import type { CanonicalNode } from '@/features/graph-v2/domain/types'
import {
  buildVisibleProfileWarmupDebugSnapshot,
  orderProfileWarmupPubkeys,
  selectVisibleProfileWarmupPubkeys,
} from '@/features/graph-v2/ui/visibleProfileWarmup'

const makeNode = (
  pubkey: string,
  overrides: Partial<CanonicalNode> = {},
): CanonicalNode => ({
  pubkey,
  label: null,
  picture: null,
  about: null,
  nip05: null,
  lud16: null,
  source: 'follow',
  discoveredAt: null,
  keywordHits: 0,
  profileEventId: null,
  profileFetchedAt: null,
  profileSource: null,
  profileState: 'idle',
  isExpanded: false,
  nodeExpansionState: null,
  ...overrides,
})

test('orders visible profile warmup by viewport before global scene order', () => {
  assert.deepEqual(
    orderProfileWarmupPubkeys({
      viewportPubkeys: ['visible-late', 'shared'],
      scenePubkeys: ['scene-first', 'shared', 'visible-late'],
    }),
    ['visible-late', 'shared', 'scene-first'],
  )
})

test('selects viewport profiles before earlier scene-only profiles', () => {
  const nodesByPubkey = {
    'scene-first': makeNode('scene-first'),
    'visible-late': makeNode('visible-late'),
  }

  const selection = selectVisibleProfileWarmupPubkeys({
    viewportPubkeys: ['visible-late'],
    scenePubkeys: ['scene-first', 'visible-late'],
    nodesByPubkey,
    attemptedAtByPubkey: new Map(),
    inflightPubkeys: new Set(),
    now: 10_000,
    batchSize: 1,
    cooldownMs: 1_000,
  })

  assert.deepEqual(selection.pubkeys, ['visible-late'])
  assert.equal(selection.eligibleCount, 2)
})

test('skips usable, inflight, and cooldown profiles when warming visible nodes', () => {
  const nodesByPubkey = {
    usable: makeNode('usable', { profileState: 'ready', label: 'Alice' }),
    inflight: makeNode('inflight'),
    cooldown: makeNode('cooldown'),
    readyEmpty: makeNode('readyEmpty', { profileState: 'ready' }),
    candidate: makeNode('candidate'),
  }

  const selection = selectVisibleProfileWarmupPubkeys({
    viewportPubkeys: ['usable', 'inflight', 'cooldown', 'readyEmpty', 'candidate'],
    scenePubkeys: [],
    nodesByPubkey,
    attemptedAtByPubkey: new Map([['cooldown', 9_500]]),
    inflightPubkeys: new Set(['inflight']),
    now: 10_000,
    batchSize: 8,
    cooldownMs: 1_000,
  })

  assert.deepEqual(selection.pubkeys, ['readyEmpty', 'candidate'])
  assert.deepEqual(selection.skipped, {
    missingNode: 0,
    alreadyUsable: 1,
    inflight: 1,
    cooldown: 1,
  })
})

test('debug snapshot reports visible warmup counters', () => {
  const nodesByPubkey = {
    idle: makeNode('idle'),
    loading: makeNode('loading', { profileState: 'loading' }),
    ready: makeNode('ready', { profileState: 'ready', picture: 'https://x.test/a.jpg' }),
    empty: makeNode('empty', { profileState: 'ready' }),
    missing: makeNode('missing', { profileState: 'missing' }),
  }

  const snapshot = buildVisibleProfileWarmupDebugSnapshot({
    viewportPubkeys: ['idle', 'ready', 'unknown'],
    scenePubkeys: ['loading', 'empty', 'missing'],
    nodesByPubkey,
    attemptedAtByPubkey: new Map([['missing', 1]]),
    inflightPubkeys: new Set(['loading']),
    now: 10_000,
    batchSize: 8,
    cooldownMs: 1_000,
  })

  assert.deepEqual(snapshot.pubkeys, ['idle', 'empty', 'missing'])
  assert.equal(snapshot.skipped.missingNode, 1)
  assert.equal(snapshot.skipped.inflight, 1)
  assert.deepEqual(snapshot.viewportProfileStates, {
    idle: 1,
    loading: 0,
    readyUsable: 1,
    readyEmpty: 0,
    missing: 0,
    unknown: 1,
  })
})
