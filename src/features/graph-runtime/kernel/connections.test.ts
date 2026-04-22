import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareConnectionPubkeys,
  createConnectionsDerivedState,
  type ConnectionContactListRecord,
} from './connections'

const contactList = (
  pubkey: string,
  follows: string[],
): ConnectionContactListRecord => ({
  pubkey,
  eventId: `event-${pubkey}`,
  createdAt: 1,
  fetchedAt: 2,
  follows,
  relayHints: [],
})

test('createConnectionsDerivedState derives deterministic non-root links inside graph', () => {
  const graphPubkeys = new Set(['root', 'carol', 'alice', 'bob'])
  const firstContactLists = new Map([
    ['carol', contactList('carol', ['root', 'alice', 'bob', 'bob', 'carol'])],
    ['alice', contactList('alice', ['outside', 'bob', 'root'])],
    ['bob', contactList('bob', ['alice', 'missing', 'bob'])],
  ])
  const secondContactLists = new Map([
    ['bob', contactList('bob', ['bob', 'missing', 'alice'])],
    ['alice', contactList('alice', ['root', 'bob', 'outside'])],
    ['carol', contactList('carol', ['carol', 'bob', 'bob', 'alice', 'root'])],
  ])

  const first = createConnectionsDerivedState(
    'root',
    graphPubkeys,
    firstContactLists,
  )
  const second = createConnectionsDerivedState(
    'root',
    graphPubkeys,
    secondContactLists,
  )

  assert.deepEqual(first.links, [
    { source: 'alice', target: 'bob', relation: 'follow' },
    { source: 'bob', target: 'alice', relation: 'follow' },
    { source: 'carol', target: 'alice', relation: 'follow' },
    { source: 'carol', target: 'bob', relation: 'follow' },
  ])
  assert.deepEqual(second.links, first.links)
  assert.equal(second.signature, first.signature)
})

test('compareConnectionPubkeys uses normalized lexical pubkey order', () => {
  assert.deepEqual(
    ['f', '1', 'a', '0', '10'].sort(compareConnectionPubkeys),
    ['0', '1', '10', 'a', 'f'],
  )
})

test('createConnectionsDerivedState scales without per-contact follow sorting', () => {
  const graphPubkeys = new Set<string>(['root'])
  const contactListsByPubkey = new Map<string, ConnectionContactListRecord>()

  for (let index = 0; index < 1_000; index += 1) {
    const pubkey = index.toString(16).padStart(64, '0')
    graphPubkeys.add(pubkey)
  }

  const graphPubkeyList = Array.from(graphPubkeys).filter(
    (pubkey) => pubkey !== 'root',
  )

  for (let index = 0; index < graphPubkeyList.length; index += 1) {
    const source = graphPubkeyList[index]
    const follows = [
      'root',
      graphPubkeyList[(index + 1) % graphPubkeyList.length],
      graphPubkeyList[(index + 2) % graphPubkeyList.length],
      graphPubkeyList[(index + 1) % graphPubkeyList.length],
    ]
    contactListsByPubkey.set(source, contactList(source, follows))
  }

  const result = createConnectionsDerivedState(
    'root',
    graphPubkeys,
    contactListsByPubkey,
  )

  assert.equal(result.links.length, 2_000)
  assert.match(result.signature, /^2000:[a-z0-9]+:[a-z0-9]+$/)
})
