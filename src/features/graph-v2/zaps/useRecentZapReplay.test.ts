import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  buildRecentZapReplayCollectionViewModel,
  clearRecentZapReplayCoverageStorage,
  clampRecentZapReplayLookbackHours,
  findZapReplaySeekIndex,
  formatRecentZapReplayWindowLabel,
} from './useRecentZapReplay'

test('clamps recent zap replay lookback to the supported hour range', () => {
  assert.equal(clampRecentZapReplayLookbackHours(-3), 1)
  assert.equal(clampRecentZapReplayLookbackHours(0), 1)
  assert.equal(clampRecentZapReplayLookbackHours(1), 1)
  assert.equal(clampRecentZapReplayLookbackHours(24), 24)
  assert.equal(clampRecentZapReplayLookbackHours(48), 24)
})

test('uses 24 hours as the default recent zap replay window', () => {
  assert.equal(RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS, 24)
  assert.equal(
    formatRecentZapReplayWindowLabel(RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS),
    'ultimas 24 horas',
  )
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

test('clears only recent zap replay coverage metadata', () => {
  const keys = [
    'sigma.recentZapReplayCoverage.v1:abc',
    'sigma.initialCameraZoom',
    'sigma.recentZapReplayCoverage.v1:def',
  ]
  const removed: string[] = []
  const storage = {
    get length() {
      return keys.length
    },
    key(index: number) {
      return keys[index] ?? null
    },
    removeItem(key: string) {
      removed.push(key)
    },
  }

  assert.equal(clearRecentZapReplayCoverageStorage(storage), 2)
  assert.deepEqual(removed, [
    'sigma.recentZapReplayCoverage.v1:abc',
    'sigma.recentZapReplayCoverage.v1:def',
  ])
})

test('tracks the applied lookback hours in the replay effect dependencies', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/graph-v2/zaps/useRecentZapReplay.ts'),
    'utf8',
  )

  assert.match(source, /\[\s*enabled,\s*appliedLookbackHours,/)
})

test('tracks playbackPaused in hook dependencies so pause state cannot go stale', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/graph-v2/zaps/useRecentZapReplay.ts'),
    'utf8',
  )

  assert.match(source, /playbackPaused\s*=\s*false/)
  assert.match(source, /\[\s*playbackPaused\s*\]/)
  assert.match(source, /\[\s*enabled,[\s\S]*playbackPaused,[\s\S]*stopReplayTimer,\s*\]/)
  assert.match(source, /scheduleReplayPausedSnapshot\(true\)/)
})

test('finds the first replay zap at or after a requested seek time', () => {
  const zaps = [
    { createdAt: 100, eventId: 'a' },
    { createdAt: 200, eventId: 'b' },
    { createdAt: 300, eventId: 'c' },
  ]

  assert.equal(findZapReplaySeekIndex(zaps, 50), 0)
  assert.equal(findZapReplaySeekIndex(zaps, 200), 1)
  assert.equal(findZapReplaySeekIndex(zaps, 250), 2)
  assert.equal(findZapReplaySeekIndex(zaps, 999), 2)
  assert.equal(findZapReplaySeekIndex([], 100), -1)
})

test('builds collection progress from real replay batch coverage', () => {
  const viewModel = buildRecentZapReplayCollectionViewModel({
    phase: 'loading',
    stage: 'collecting',
    batchCount: 4,
    completedBatchCount: 2,
    timedOutBatchCount: 0,
  })

  assert.equal(viewModel.status, 'collecting')
  assert.equal(viewModel.progress, 0.5)
  assert.equal(viewModel.isIndeterminate, true)
})

test('marks collection partial after timeouts and complete coverage', () => {
  const viewModel = buildRecentZapReplayCollectionViewModel({
    phase: 'playing',
    stage: 'playing',
    batchCount: 4,
    completedBatchCount: 4,
    timedOutBatchCount: 1,
  })

  assert.equal(viewModel.status, 'partial')
  assert.equal(viewModel.progress, 1)
  assert.equal(viewModel.isIndeterminate, false)
})

test('builds collection states for cache-only and no-batch snapshots', () => {
  const cacheOnly = buildRecentZapReplayCollectionViewModel({
    phase: 'done',
    stage: 'done',
    batchCount: 0,
    completedBatchCount: 0,
    timedOutBatchCount: 0,
  })
  const idle = buildRecentZapReplayCollectionViewModel({
    phase: 'idle',
    stage: 'idle',
    batchCount: 0,
    completedBatchCount: 0,
    timedOutBatchCount: 0,
  })

  assert.deepEqual(cacheOnly, {
    progress: 1,
    status: 'done',
    isIndeterminate: false,
  })
  assert.deepEqual(idle, {
    progress: 0,
    status: 'idle',
    isIndeterminate: false,
  })
})
