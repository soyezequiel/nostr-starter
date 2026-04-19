import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  LayoutLinesResult,
  PreparedTextWithSegments,
} from '@chenglou/pretext'

import {
  NodeLabelLayoutCache,
  resolveNodeLabelMaxWidth,
  truncateTextToWidth,
} from '@/features/graph-v2/renderer/nodeLabelLayout'

const preparedText = {} as PreparedTextWithSegments

const measureTextWidth = (label: string) => label.length * 10

test('resolves bounded graph label widths from rendered node size', () => {
  assert.equal(resolveNodeLabelMaxWidth(2), 72)
  assert.equal(resolveNodeLabelMaxWidth(12), 120)
  assert.equal(resolveNodeLabelMaxWidth(80), 180)
})

test('truncates text to fit the requested width', () => {
  const result = truncateTextToWidth(
    'extraordinary-label',
    80,
    measureTextWidth,
  )

  assert.equal(result.text, 'extra...')
  assert.equal(result.width, 80)
  assert.equal(result.truncated, true)
})

test('caches prepared pretext handles and resolved layouts', () => {
  let prepareCalls = 0
  let layoutCalls = 0

  const cache = new NodeLabelLayoutCache(
    4,
    {
      prepareWithSegments: () => {
        prepareCalls += 1
        return preparedText
      },
      measureNaturalWidth: () => 160,
      layoutWithLines: () => {
        layoutCalls += 1
        return {
          lineCount: 2,
          height: 26.4,
          lines: [
            {
              text: 'Alice ',
              width: 60,
              start: { segmentIndex: 0, graphemeIndex: 0 },
              end: { segmentIndex: 1, graphemeIndex: 0 },
            },
            {
              text: 'Wonderland',
              width: 100,
              start: { segmentIndex: 1, graphemeIndex: 0 },
              end: { segmentIndex: 2, graphemeIndex: 0 },
            },
          ],
        } satisfies LayoutLinesResult
      },
    },
    () => true,
  )

  const input = {
    label: 'Alice Wonderland',
    font: '500 12px Inter',
    labelSize: 12,
    nodeSize: 8,
    maxWidth: 80,
    measureTextWidth: (label: string) => measureTextWidth(label),
  }

  assert.equal(cache.resolve(input).width, 80)
  assert.equal(cache.resolve(input).width, 80)
  assert.equal(prepareCalls, 1)
  assert.equal(layoutCalls, 1)
})

test('falls back to deterministic single-line truncation when pretext is unavailable', () => {
  const cache = new NodeLabelLayoutCache(
    4,
    {
      prepareWithSegments: () => preparedText,
      measureNaturalWidth: () => 160,
      layoutWithLines: () => {
        throw new Error('should not run')
      },
    },
    () => false,
  )

  const layout = cache.resolve({
    label: 'Alice Wonderland',
    font: '500 12px Inter',
    labelSize: 12,
    nodeSize: 8,
    maxWidth: 80,
    measureTextWidth: (label: string) => measureTextWidth(label),
  })

  assert.deepEqual(layout.lines, [{ text: 'Alice...', width: 80 }])
  assert.equal(layout.usedPretext, false)
  assert.equal(layout.truncated, true)
})

test('caps pretext output to the configured line count', () => {
  const cache = new NodeLabelLayoutCache(
    4,
    {
      prepareWithSegments: () => preparedText,
      measureNaturalWidth: () => 220,
      layoutWithLines: () =>
        ({
          lineCount: 3,
          height: 39.6,
          lines: [
            {
              text: 'Alice',
              width: 50,
              start: { segmentIndex: 0, graphemeIndex: 0 },
              end: { segmentIndex: 1, graphemeIndex: 0 },
            },
            {
              text: 'Longlastname',
              width: 120,
              start: { segmentIndex: 1, graphemeIndex: 0 },
              end: { segmentIndex: 2, graphemeIndex: 0 },
            },
            {
              text: 'Ignored',
              width: 70,
              start: { segmentIndex: 2, graphemeIndex: 0 },
              end: { segmentIndex: 3, graphemeIndex: 0 },
            },
          ],
        }) satisfies LayoutLinesResult,
    },
    () => true,
  )

  const layout = cache.resolve({
    label: 'Alice Longlastname Ignored',
    font: '500 12px Inter',
    labelSize: 12,
    nodeSize: 8,
    maxWidth: 90,
    maxLines: 2,
    measureTextWidth: (label: string) => measureTextWidth(label),
  })

  assert.deepEqual(layout.lines, [
    { text: 'Alice', width: 50 },
    { text: 'Longl...', width: 90 },
  ])
  assert.equal(layout.truncated, true)
  assert.equal(layout.usedPretext, true)
})
