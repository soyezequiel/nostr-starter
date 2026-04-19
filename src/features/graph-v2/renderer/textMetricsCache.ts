const DEFAULT_MAX_TEXT_METRICS = 2_000
const KEY_SEPARATOR = '\u0000'

export class TextMetricsWidthCache {
  private readonly entries = new Map<string, number>()

  public constructor(private readonly maxEntries = DEFAULT_MAX_TEXT_METRICS) {}

  public measureTextWidth(
    context: CanvasRenderingContext2D,
    label: string,
    font = context.font,
  ) {
    const key = `${font}${KEY_SEPARATOR}${label}`
    const cached = this.entries.get(key)

    if (cached !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }

    const width = context.measureText(label).width
    this.entries.set(key, width)

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.entries.delete(oldestKey)
    }

    return width
  }

  public clear() {
    this.entries.clear()
  }

  public get size() {
    return this.entries.size
  }
}

export const nodeLabelTextMetricsCache = new TextMetricsWidthCache()

export const measureNodeLabelTextWidth = (
  context: CanvasRenderingContext2D,
  label: string,
  font = context.font,
) => nodeLabelTextMetricsCache.measureTextWidth(context, label, font)
