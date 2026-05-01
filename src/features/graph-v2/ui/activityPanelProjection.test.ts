import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphEventPayload } from '@/features/graph-v2/events/types'
import {
  type ActivityPanelProjectionEntry,
  projectActivityPanelEntries,
} from '@/features/graph-v2/ui/activityPanelProjection'

const labels = new Map([
  ['from', 'Alice'],
  ['to', 'Bob'],
])

const resolveActorLabel = (pubkey: string) => labels.get(pubkey) ?? pubkey

const quotePayload: GraphEventPayload = {
  kind: 'quote',
  data: {
    quotedAuthorPubkey: null,
    quotedEventId: 'event-1',
    quoterContent: 'quoted text',
  },
}

const baseEntries: ActivityPanelProjectionEntry[] = [
  {
    type: 'zap',
    id: 'zap:1',
    source: 'recent',
    fromPubkey: 'from',
    toPubkey: 'to',
    played: false,
    receivedAt: 1_000,
    zap: {
      sats: 21,
      comment: ' zap note ',
      zapCreatedAt: 50,
    },
    graphEvent: null,
  },
  {
    type: 'graph-event',
    id: 'graph-event:1',
    source: 'recent',
    fromPubkey: 'to',
    toPubkey: 'from',
    played: true,
    receivedAt: 2_000,
    zap: null,
    graphEvent: {
      kind: 'quote',
      createdAt: 60,
      payload: quotePayload,
    },
  },
]

test('projectActivityPanelEntries reuses unchanged entry objects', () => {
  const first = projectActivityPanelEntries(baseEntries, resolveActorLabel)
  const second = projectActivityPanelEntries(baseEntries, resolveActorLabel, first)

  assert.equal(second[0], first[0])
  assert.equal(second[1], first[1])
})

test('projectActivityPanelEntries replaces only changed entries', () => {
  const first = projectActivityPanelEntries(baseEntries, resolveActorLabel)
  const changed = baseEntries.map((entry) =>
    entry.id === 'zap:1'
      ? {
          ...entry,
          played: true,
          zap: {
            ...entry.zap,
            sats: 34,
            comment: 'updated',
            zapCreatedAt: 61,
          },
        }
      : entry,
  )

  const second = projectActivityPanelEntries(changed, resolveActorLabel, first)

  assert.notEqual(second[0], first[0])
  assert.equal(second[0].played, true)
  assert.equal(second[0].sats, 34)
  assert.equal(second[0].text, 'updated')
  assert.equal(second[0].occurredAt, 61_000)
  assert.equal(second[1], first[1])
})

test('projectActivityPanelEntries replaces entries when actor labels change', () => {
  const first = projectActivityPanelEntries(baseEntries, resolveActorLabel)
  labels.set('from', 'Alicia')
  const second = projectActivityPanelEntries(baseEntries, resolveActorLabel, first)
  labels.set('from', 'Alice')

  assert.notEqual(second[0], first[0])
  assert.notEqual(second[1], first[1])
  assert.equal(second[0].fromLabel, 'Alicia')
  assert.equal(second[1].toLabel, 'Alicia')
})

test('projectActivityPanelEntries does not keep stale removed entries', () => {
  const first = projectActivityPanelEntries(baseEntries, resolveActorLabel)
  const next = projectActivityPanelEntries([baseEntries[1]], resolveActorLabel, first)

  assert.equal(next.length, 1)
  assert.equal(next[0].id, 'graph-event:1')
  assert.equal(next[0], first[1])
})

test('projectActivityPanelEntries hides quote and comment previews when disabled', () => {
  const entries = projectActivityPanelEntries(
    baseEntries,
    resolveActorLabel,
    [],
    { showTextPreviews: false },
  )

  assert.equal(entries[0].text, 'zap note')
  assert.equal(entries[1].text, '')
})

test('projectActivityPanelEntries updates entries when text previews are enabled again', () => {
  const hidden = projectActivityPanelEntries(
    baseEntries,
    resolveActorLabel,
    [],
    { showTextPreviews: false },
  )
  const visible = projectActivityPanelEntries(
    baseEntries,
    resolveActorLabel,
    hidden,
    { showTextPreviews: true },
  )

  assert.notEqual(visible[1], hidden[1])
  assert.equal(visible[1].text, 'quoted text')
})
