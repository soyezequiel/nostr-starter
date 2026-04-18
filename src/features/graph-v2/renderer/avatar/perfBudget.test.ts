import assert from 'node:assert/strict'
import test from 'node:test'

import { PerfBudget } from '@/features/graph-v2/renderer/avatar/perfBudget'

test('PerfBudget starts at declared tier', () => {
  const budget = new PerfBudget('mid', () => 0)
  const snap = budget.snapshot()
  assert.equal(snap.tier, 'mid')
  assert.equal(snap.budget.drawAvatars, true)
  assert.equal(snap.budget.concurrency, 4)
})

test('PerfBudget downgrades tier after sustained high frame time', () => {
  let now = 0
  const budget = new PerfBudget('high', () => now)
  // Warm EMA so it crosses the 40ms threshold.
  for (let i = 0; i < 30; i += 1) {
    now += 50
    budget.recordFrame(50)
  }
  assert.equal(budget.snapshot().tier, 'high')
  // Hold above threshold past the downgrade window.
  for (let i = 0; i < 60; i += 1) {
    now += 50
    budget.recordFrame(50)
  }
  assert.equal(budget.snapshot().tier, 'mid')
})

test('PerfBudget lowers per-frame image caps on downgrade', () => {
  let now = 0
  const budget = new PerfBudget('high', () => now)
  const initial = budget.snapshot().budget
  for (let i = 0; i < 90; i += 1) {
    now += 50
    budget.recordFrame(50)
  }
  const downgraded = budget.snapshot().budget
  assert.ok(downgraded.maxAvatarDrawsPerFrame < initial.maxAvatarDrawsPerFrame)
  assert.ok(downgraded.maxImageDrawsPerFrame < initial.maxImageDrawsPerFrame)
})

test('PerfBudget does not downgrade on brief spikes', () => {
  let now = 0
  const budget = new PerfBudget('high', () => now)
  now += 16
  budget.recordFrame(60)
  now += 16
  budget.recordFrame(16)
  const snap = budget.snapshot()
  assert.equal(snap.tier, 'high')
})

test('PerfBudget upgrades back after sustained healthy frames', () => {
  let now = 0
  const budget = new PerfBudget('high', () => now)
  for (let i = 0; i < 60; i += 1) {
    now += 50
    budget.recordFrame(50)
  }
  assert.equal(budget.snapshot().tier, 'mid')
  for (let i = 0; i < 400; i += 1) {
    now += 14
    budget.recordFrame(14)
  }
  assert.equal(budget.snapshot().tier, 'high')
})

test('PerfBudget disable sets drawAvatars false', () => {
  const budget = new PerfBudget('high', () => 0)
  budget.disable()
  assert.equal(budget.getBudget().drawAvatars, false)
  budget.enable()
  assert.equal(budget.getBudget().drawAvatars, true)
})

test('PerfBudget ignores non-finite deltas', () => {
  const budget = new PerfBudget('mid', () => 0)
  budget.recordFrame(Number.NaN)
  budget.recordFrame(-5)
  budget.recordFrame(0)
  assert.equal(budget.snapshot().emaFrameMs, 16)
})
