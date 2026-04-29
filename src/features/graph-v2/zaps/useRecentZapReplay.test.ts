import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  clampRecentZapReplayLookbackHours,
  formatRecentZapReplayWindowLabel,
} from './useRecentZapReplay'

test('clamps recent zap replay lookback to the supported hour range', () => {
  assert.equal(clampRecentZapReplayLookbackHours(-3), 1)
  assert.equal(clampRecentZapReplayLookbackHours(0), 1)
  assert.equal(clampRecentZapReplayLookbackHours(1), 1)
  assert.equal(clampRecentZapReplayLookbackHours(24), 24)
  assert.equal(clampRecentZapReplayLookbackHours(48), 24)
})

test('rejects non-integer or non-finite recent zap replay lookback values', () => {
  assert.equal(
    clampRecentZapReplayLookbackHours(1.5),
    RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  )
  assert.equal(
    clampRecentZapReplayLookbackHours(Number.NaN),
    RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  )
  assert.equal(
    clampRecentZapReplayLookbackHours(Number.POSITIVE_INFINITY),
    RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  )
})

test('formats recent zap replay window labels in singular and plural', () => {
  assert.equal(formatRecentZapReplayWindowLabel(1), 'ultima hora')
  assert.equal(formatRecentZapReplayWindowLabel(24), 'ultimas 24 horas')
})

test('tracks the applied lookback hours in the replay effect dependencies', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/graph-v2/zaps/useRecentZapReplay.ts'),
    'utf8',
  )

  assert.match(source, /\[\s*enabled,\s*appliedLookbackHours,/)
})
