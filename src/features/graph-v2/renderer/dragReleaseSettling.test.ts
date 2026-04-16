import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDragReleaseSettlingState,
  DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
  getSettlingSpeedMagnitude,
  stepDragReleaseSettling,
} from './dragReleaseSettling.ts'

test('decays speed monotonically across settling steps', () => {
  let state = createDragReleaseSettlingState(0.9, 0.4)
  const speeds: number[] = [getSettlingSpeedMagnitude(state)]

  for (let index = 0; index < 5; index += 1) {
    const result = stepDragReleaseSettling(state, 16)
    state = result.nextState
    speeds.push(result.speed)
  }

  for (let index = 1; index < speeds.length; index += 1) {
    assert.ok(speeds[index] <= speeds[index - 1])
  }
})

test('clamps initial speed and per-frame translation', () => {
  const state = createDragReleaseSettlingState(12, -9, {
    ...DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    maxInitialSpeed: 0.5,
    maxTranslationPerFrame: 3,
  })

  assert.ok(getSettlingSpeedMagnitude(state) <= 0.5 + 1e-9)

  const result = stepDragReleaseSettling(state, 32, {
    ...DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    maxInitialSpeed: 0.5,
    maxTranslationPerFrame: 3,
  })

  assert.ok(Math.abs(result.translationX) <= 3)
  assert.ok(Math.abs(result.translationY) <= 3)
})

test('stops once the threshold is crossed', () => {
  const config = {
    ...DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    stopSpeedThreshold: 0.02,
  }
  let state = createDragReleaseSettlingState(0.08, 0, config)
  let result = stepDragReleaseSettling(state, 16, config)

  while (!result.done) {
    state = result.nextState
    result = stepDragReleaseSettling(state, 16, config)
  }

  assert.ok(result.speed <= config.stopSpeedThreshold)
})

test('cannot accumulate infinite displacement', () => {
  const config = {
    ...DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
    maxDurationMs: 180,
    maxTranslationPerFrame: 4,
  }
  let state = createDragReleaseSettlingState(1.2, 0.6, config)
  let totalDisplacement = 0

  for (let index = 0; index < 60; index += 1) {
    const result = stepDragReleaseSettling(state, 16, config)
    totalDisplacement += Math.hypot(result.translationX, result.translationY)
    state = result.nextState

    if (result.done) {
      break
    }
  }

  const maxFrames = Math.ceil(config.maxDurationMs / 16)
  const maxPossibleDisplacement =
    maxFrames * Math.hypot(config.maxTranslationPerFrame, config.maxTranslationPerFrame)

  assert.ok(totalDisplacement <= maxPossibleDisplacement + 1e-9)
  assert.ok(state.elapsedMs <= config.maxDurationMs)
})
