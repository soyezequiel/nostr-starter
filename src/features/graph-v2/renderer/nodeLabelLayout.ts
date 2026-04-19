import type {
  LayoutLinesResult,
  PreparedTextWithSegments,
} from '@chenglou/pretext'
import {
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
} from '@chenglou/pretext'

const DEFAULT_MAX_NODE_LABEL_LAYOUTS = 2_000
const KEY_SEPARATOR = '\u0000'
const DEFAULT_MAX_LINES = 2
const LINE_HEIGHT_FACTOR = 1.1
const MIN_LABEL_WIDTH = 72
const MAX_LABEL_WIDTH = 180
const LABEL_WIDTH_NODE_SIZE_FACTOR = 10
const ELLIPSIS = '...'

type SegmenterConstructor = new (
  locale: string | string[] | undefined,
  options: { granularity: 'grapheme' },
) => {
  segment: (text: string) => Iterable<{ segment: string }>
}

interface PretextLayoutApi {
  prepareWithSegments: (
    text: string,
    font: string,
  ) => PreparedTextWithSegments
  layoutWithLines: (
    prepared: PreparedTextWithSegments,
    maxWidth: number,
    lineHeight: number,
  ) => LayoutLinesResult
  measureNaturalWidth: (prepared: PreparedTextWithSegments) => number
}

export interface NodeLabelLayoutLine {
  text: string
  width: number
}

export interface NodeLabelLayout {
  lines: NodeLabelLayoutLine[]
  width: number
  height: number
  lineHeight: number
  truncated: boolean
  usedPretext: boolean
}

export interface NodeLabelLayoutInput {
  label: string
  font: string
  labelSize: number
  nodeSize: number
  measureTextWidth: (label: string, font: string) => number
  maxLines?: number
  maxWidth?: number
}

const defaultPretextLayoutApi: PretextLayoutApi = {
  prepareWithSegments,
  layoutWithLines,
  measureNaturalWidth,
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const normalizeWidth = (value: number) =>
  Math.max(1, Math.round(value * 10) / 10)

const touchCacheEntry = <T>(entries: Map<string, T>, key: string) => {
  const value = entries.get(key)
  if (value !== undefined) {
    entries.delete(key)
    entries.set(key, value)
  }
  return value
}

const setCacheEntry = <T>(
  entries: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
) => {
  entries.set(key, value)

  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    entries.delete(oldestKey)
  }
}

const hasIntlSegmenter = () => {
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: SegmenterConstructor
  }
  return typeof intlWithSegmenter.Segmenter === 'function'
}

const canMeasureWithPretext = () =>
  hasIntlSegmenter() &&
  (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined')

let graphemeSegmenter: InstanceType<SegmenterConstructor> | null = null

const splitGraphemes = (text: string) => {
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: SegmenterConstructor
  }

  if (typeof intlWithSegmenter.Segmenter === 'function') {
    graphemeSegmenter ??= new intlWithSegmenter.Segmenter(undefined, {
      granularity: 'grapheme',
    })
    return Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
  }

  return Array.from(text)
}

export const resolveNodeLabelLineHeight = (labelSize: number) =>
  normalizeWidth(labelSize * LINE_HEIGHT_FACTOR)

export const resolveNodeLabelMaxWidth = (nodeSize: number) =>
  normalizeWidth(
    clampNumber(
      Number.isFinite(nodeSize)
        ? nodeSize * LABEL_WIDTH_NODE_SIZE_FACTOR
        : MIN_LABEL_WIDTH,
      MIN_LABEL_WIDTH,
      MAX_LABEL_WIDTH,
    ),
  )

export const truncateTextToWidth = (
  text: string,
  maxWidth: number,
  measureTextWidth: (label: string) => number,
) => {
  const trimmedText = text.trimEnd()
  const currentWidth = measureTextWidth(trimmedText)

  if (currentWidth <= maxWidth) {
    return {
      text: trimmedText,
      width: currentWidth,
      truncated: false,
    }
  }

  const ellipsisWidth = measureTextWidth(ELLIPSIS)
  if (ellipsisWidth > maxWidth) {
    return {
      text: '',
      width: 0,
      truncated: true,
    }
  }

  const graphemes = splitGraphemes(trimmedText)
  let low = 0
  let high = graphemes.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = `${graphemes.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`
    if (measureTextWidth(candidate) <= maxWidth) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  const textPrefix = graphemes.slice(0, low).join('').trimEnd()
  const truncatedText = `${textPrefix}${ELLIPSIS}`

  return {
    text: truncatedText,
    width: measureTextWidth(truncatedText),
    truncated: true,
  }
}

export class NodeLabelLayoutCache {
  private readonly prepared = new Map<string, PreparedTextWithSegments>()

  private readonly layouts = new Map<string, NodeLabelLayout>()

  private readonly maxEntries: number

  private readonly pretextApi: PretextLayoutApi

  private readonly isPretextAvailable: () => boolean

  public constructor(
    maxEntries = DEFAULT_MAX_NODE_LABEL_LAYOUTS,
    pretextApi = defaultPretextLayoutApi,
    isPretextAvailable = canMeasureWithPretext,
  ) {
    this.maxEntries = maxEntries
    this.pretextApi = pretextApi
    this.isPretextAvailable = isPretextAvailable
  }

  public resolve(input: NodeLabelLayoutInput): NodeLabelLayout {
    const label = input.label.trim()
    const maxLines = Math.max(1, Math.floor(input.maxLines ?? DEFAULT_MAX_LINES))
    const maxWidth = input.maxWidth ?? resolveNodeLabelMaxWidth(input.nodeSize)
    const lineHeight = resolveNodeLabelLineHeight(input.labelSize)
    const measureTextWidth = (text: string) =>
      input.measureTextWidth(text, input.font)

    if (!label) {
      return {
        lines: [],
        width: 0,
        height: 0,
        lineHeight,
        truncated: false,
        usedPretext: false,
      }
    }

    if (!this.isPretextAvailable()) {
      return this.createFallbackLayout(
        label,
        maxWidth,
        maxLines,
        lineHeight,
        measureTextWidth,
      )
    }

    const layoutKey = [
      input.font,
      label,
      maxWidth,
      maxLines,
      lineHeight,
    ].join(KEY_SEPARATOR)
    const cachedLayout = touchCacheEntry(this.layouts, layoutKey)
    if (cachedLayout) {
      return cachedLayout
    }

    try {
      const preparedText = this.getPreparedText(label, input.font)
      const naturalWidth = this.pretextApi.measureNaturalWidth(preparedText)

      if (naturalWidth <= maxWidth) {
        const layout = this.createSingleLineLayout(
          label,
          naturalWidth,
          lineHeight,
          true,
        )
        setCacheEntry(this.layouts, layoutKey, layout, this.maxEntries)
        return layout
      }

      const result = this.pretextApi.layoutWithLines(
        preparedText,
        maxWidth,
        lineHeight,
      )
      const layout = this.createPretextLayout(
        result,
        maxWidth,
        maxLines,
        lineHeight,
        measureTextWidth,
      )

      setCacheEntry(this.layouts, layoutKey, layout, this.maxEntries)
      return layout
    } catch {
      return this.createFallbackLayout(
        label,
        maxWidth,
        maxLines,
        lineHeight,
        measureTextWidth,
      )
    }
  }

  public clear() {
    this.prepared.clear()
    this.layouts.clear()
  }

  public get size() {
    return this.layouts.size
  }

  private getPreparedText(label: string, font: string) {
    const preparedKey = `${font}${KEY_SEPARATOR}${label}`
    const cached = touchCacheEntry(this.prepared, preparedKey)
    if (cached) {
      return cached
    }

    const preparedText = this.pretextApi.prepareWithSegments(label, font)
    setCacheEntry(this.prepared, preparedKey, preparedText, this.maxEntries)
    return preparedText
  }

  private createSingleLineLayout(
    label: string,
    width: number,
    lineHeight: number,
    usedPretext: boolean,
  ): NodeLabelLayout {
    return {
      lines: [{ text: label, width }],
      width,
      height: lineHeight,
      lineHeight,
      truncated: false,
      usedPretext,
    }
  }

  private createFallbackLayout(
    label: string,
    maxWidth: number,
    maxLines: number,
    lineHeight: number,
    measureTextWidth: (label: string) => number,
  ): NodeLabelLayout {
    const line = truncateTextToWidth(label, maxWidth, measureTextWidth)
    return {
      lines: [{ text: line.text, width: line.width }],
      width: line.width,
      height: lineHeight,
      lineHeight,
      truncated: line.truncated || maxLines < 1,
      usedPretext: false,
    }
  }

  private createPretextLayout(
    result: LayoutLinesResult,
    maxWidth: number,
    maxLines: number,
    lineHeight: number,
    measureTextWidth: (label: string) => number,
  ): NodeLabelLayout {
    const visibleLines = result.lines.slice(0, maxLines)
    const truncatedByLineCount = result.lineCount > maxLines
    let truncatedByWidth = false
    const lines = visibleLines.map((line, index) => {
      const text = line.text.trimEnd()
      const isLastVisibleLine = index === visibleLines.length - 1

      if (isLastVisibleLine && truncatedByLineCount) {
        const truncatedLine = truncateTextToWidth(
          text,
          maxWidth,
          measureTextWidth,
        )
        return {
          text: truncatedLine.text,
          width: truncatedLine.width,
        }
      }

      const width = measureTextWidth(text)
      if (width > maxWidth) {
        truncatedByWidth = true
        const truncatedLine = truncateTextToWidth(
          text,
          maxWidth,
          measureTextWidth,
        )
        return {
          text: truncatedLine.text,
          width: truncatedLine.width,
        }
      }

      return {
        text,
        width,
      }
    })

    const width = lines.reduce(
      (maxWidthSoFar, line) => Math.max(maxWidthSoFar, line.width),
      0,
    )

    return {
      lines,
      width,
      height: lines.length * lineHeight,
      lineHeight,
      truncated: truncatedByLineCount || truncatedByWidth,
      usedPretext: true,
    }
  }
}

export const nodeLabelLayoutCache = new NodeLabelLayoutCache()
