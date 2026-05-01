import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CONNECTION_VISUAL_CONFIG,
  normalizeConnectionVisualConfig,
} from '@/features/graph-v2/connectionVisualConfig'

test('connection visual config defaults match the curated starting look', () => {
  assert.deepEqual(DEFAULT_CONNECTION_VISUAL_CONFIG, {
    opacity: 0.58,
    thicknessScale: 0.55,
    colorMode: 'calm',
    focusStyle: 'balanced',
  })
})

test('connection visual config normalizes invalid modes to curated defaults', () => {
  const config = normalizeConnectionVisualConfig({
    opacity: 0.65,
    thicknessScale: 1.25,
    colorMode: 'wrong' as 'semantic',
    focusStyle: 'nope' as 'balanced',
  })

  assert.deepEqual(config, {
    opacity: 0.65,
    thicknessScale: 1.25,
    colorMode: DEFAULT_CONNECTION_VISUAL_CONFIG.colorMode,
    focusStyle: DEFAULT_CONNECTION_VISUAL_CONFIG.focusStyle,
  })
})

test('connection visual config clamps opacity and thickness scale', () => {
  const config = normalizeConnectionVisualConfig({
    opacity: -4,
    thicknessScale: 99,
  })

  assert.equal(config.opacity, 0.1)
  assert.equal(config.thicknessScale, 1.75)
})

test('connection visual config allows very fine resting edges', () => {
  const config = normalizeConnectionVisualConfig({
    thicknessScale: 0.1,
  })

  assert.equal(config.thicknessScale, 0.35)
})

test('connection visual config survives JSON roundtrip with stable normalized values', () => {
  const original = normalizeConnectionVisualConfig({
    opacity: 0.45,
    thicknessScale: 1.4,
    colorMode: 'calm',
    focusStyle: 'dramatic',
  })

  const roundtrip = normalizeConnectionVisualConfig(
    JSON.parse(JSON.stringify(original)) as Partial<typeof original>,
  )

  assert.deepEqual(roundtrip, original)
})
