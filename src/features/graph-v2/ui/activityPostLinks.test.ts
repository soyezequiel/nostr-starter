import assert from 'node:assert/strict'
import test from 'node:test'

import { nip19 } from 'nostr-tools'

import { buildActivityPostExternalLinks } from '@/features/graph-v2/ui/activityPostLinks'

const VALID_EVENT_ID = '0'.repeat(63) + '1'

test('buildActivityPostExternalLinks rejects missing and invalid event ids', () => {
  assert.equal(buildActivityPostExternalLinks(null), null)
  assert.equal(buildActivityPostExternalLinks(undefined), null)
  assert.equal(buildActivityPostExternalLinks('not-an-event-id'), null)
  assert.equal(buildActivityPostExternalLinks('a'.repeat(63)), null)
  assert.equal(buildActivityPostExternalLinks('g'.repeat(64)), null)
})

test('buildActivityPostExternalLinks builds Primal and Jumble post URLs for valid event ids', () => {
  const links = buildActivityPostExternalLinks(VALID_EVENT_ID)

  assert.deepEqual(links, {
    primalUrl: `https://primal.net/e/${nip19.neventEncode({ id: VALID_EVENT_ID })}`,
    jumbleUrl: `https://jumble.social/notes/${nip19.noteEncode(VALID_EVENT_ID)}`,
  })
})

test('buildActivityPostExternalLinks normalizes uppercase event ids before encoding', () => {
  const upper = 'A'.repeat(63) + 'B'
  const lower = upper.toLowerCase()
  const links = buildActivityPostExternalLinks(upper)

  assert.deepEqual(links, {
    primalUrl: `https://primal.net/e/${nip19.neventEncode({ id: lower })}`,
    jumbleUrl: `https://jumble.social/notes/${nip19.noteEncode(lower)}`,
  })
})
