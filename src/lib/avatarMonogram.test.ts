import assert from 'node:assert/strict'
import test from 'node:test'

import { getAvatarMonogram } from '@/lib/avatarMonogram'

test('getAvatarMonogram uses initials from multi-word profile names', () => {
  assert.equal(getAvatarMonogram('Alice Example'), 'AE')
  assert.equal(getAvatarMonogram('@fiatjaf nostr'), 'FN')
})

test('getAvatarMonogram uses the first two useful characters for one-word names', () => {
  assert.equal(getAvatarMonogram('fiatjaf'), 'FI')
  assert.equal(getAvatarMonogram('pablo_f7z'), 'PF')
})

test('getAvatarMonogram returns a placeholder for empty labels', () => {
  assert.equal(getAvatarMonogram('   '), '??')
})
