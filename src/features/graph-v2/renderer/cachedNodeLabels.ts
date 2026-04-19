import type {
  NodeHoverDrawingFunction,
  NodeLabelDrawingFunction,
} from 'sigma/rendering'

import type {
  RenderEdgeAttributes,
  RenderNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import {
  nodeLabelLayoutCache,
  type NodeLabelLayout,
} from '@/features/graph-v2/renderer/nodeLabelLayout'
import { measureNodeLabelTextWidth } from '@/features/graph-v2/renderer/textMetricsCache'

const HOVER_LABEL_PADDING = 2
const NODE_LABEL_SIZE_FACTOR = 1.05
const MIN_NODE_LABEL_SIZE = 10
const MAX_NODE_LABEL_SIZE = 24
const NODE_LABEL_LAYOUT_TRIGGER_LENGTH = 18

type LabelLayoutCandidate = Omit<Partial<RenderNodeAttributes>, 'label'> & {
  label?: string | null
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const resolveProportionalNodeLabelSize = (
  nodeSize: number,
  fallbackLabelSize: number,
) => {
  const proportionalSize = Number.isFinite(nodeSize)
    ? nodeSize * NODE_LABEL_SIZE_FACTOR
    : fallbackLabelSize

  const clampedSize = clampNumber(
    proportionalSize,
    Math.min(MIN_NODE_LABEL_SIZE, fallbackLabelSize),
    Math.max(MAX_NODE_LABEL_SIZE, fallbackLabelSize),
  )

  return Math.round(clampedSize * 10) / 10
}

const shouldUseCachedLabelLayout = (data: LabelLayoutCandidate) =>
  typeof data.label === 'string' &&
  (data.label.length >= NODE_LABEL_LAYOUT_TRIGGER_LENGTH ||
    data.forceLabel === true ||
    data.highlighted === true ||
    data.isRoot === true ||
    data.isSelected === true ||
    data.isNeighbor === true)

const resolveCachedLabelLayout = (
  context: CanvasRenderingContext2D,
  label: string,
  font: string,
  labelSize: number,
  nodeSize: number,
) =>
  nodeLabelLayoutCache.resolve({
    label,
    font,
    labelSize,
    nodeSize,
    measureTextWidth: (text, textFont) =>
      measureNodeLabelTextWidth(context, text, textFont),
  })

const drawLabelLine = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) => {
  context.strokeText(text, x, y)
  context.fillText(text, x, y)
}

const drawLabelLayout = (
  context: CanvasRenderingContext2D,
  layout: NodeLabelLayout,
  x: number,
  centerY: number,
  labelSize: number,
) => {
  const firstLineY =
    centerY - ((layout.lines.length - 1) * layout.lineHeight) / 2 + labelSize / 3

  layout.lines.forEach((line, index) => {
    if (!line.text) {
      return
    }
    drawLabelLine(context, line.text, x, firstLineY + index * layout.lineHeight)
  })
}

export const drawCachedDiscNodeLabel: NodeLabelDrawingFunction<
  RenderNodeAttributes,
  RenderEdgeAttributes
> = (context, data, settings) => {
  if (!data.label) {
    return
  }

  const labelSize = resolveProportionalNodeLabelSize(
    data.size,
    settings.labelSize,
  )
  const font = settings.labelFont
  const weight = settings.labelWeight
  const color = settings.labelColor.attribute
    ? data[settings.labelColor.attribute] || settings.labelColor.color || '#000'
    : settings.labelColor.color

  const labelFont = `${weight} ${labelSize}px ${font}`
  context.font = labelFont
  const labelX = data.x + data.size + Math.max(3, labelSize * 0.22)
  const labelY = data.y + labelSize / 3
  const layout = shouldUseCachedLabelLayout(data)
    ? resolveCachedLabelLayout(
        context,
        data.label,
        labelFont,
        labelSize,
        data.size,
      )
    : null

  // Cheap dark outline (strokeText) instead of shadowBlur - readability on
  // dark background without the per-pixel blur cost that tanks FPS at
  // hundreds of nodes.
  context.lineWidth = 3
  context.lineJoin = 'round'
  context.strokeStyle = 'rgba(5, 10, 18, 0.85)'
  context.fillStyle = color

  if (layout && layout.lines.length > 0) {
    drawLabelLayout(context, layout, labelX, data.y, labelSize)
    return
  }

  drawLabelLine(context, data.label, labelX, labelY)
}

export const drawCachedDiscNodeHover: NodeHoverDrawingFunction<
  RenderNodeAttributes,
  RenderEdgeAttributes
> = (context, data, settings) => {
  const labelSize = resolveProportionalNodeLabelSize(
    data.size,
    settings.labelSize,
  )
  const font = settings.labelFont
  const weight = settings.labelWeight
  const labelFont = `${weight} ${labelSize}px ${font}`

  context.font = labelFont
  context.fillStyle = '#FFF'
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 8
  context.shadowColor = '#000'

  if (typeof data.label === 'string') {
    const layout = resolveCachedLabelLayout(
      context,
      data.label,
      labelFont,
      labelSize,
      data.size,
    )
    const textWidth =
      layout.lines.length > 0
        ? layout.width
        : measureNodeLabelTextWidth(context, data.label, labelFont)
    const textHeight = layout.lines.length > 0 ? layout.height : labelSize
    const boxWidth = Math.round(textWidth + 5)
    const boxHeight = Math.round(textHeight + 2 * HOVER_LABEL_PADDING)
    const radius = Math.max(data.size, labelSize / 2) + HOVER_LABEL_PADDING
    const angleRadian = Math.asin(
      clampNumber(boxHeight / 2 / radius, -1, 1),
    )
    const xDeltaCoord = Math.sqrt(
      Math.abs(radius ** 2 - (boxHeight / 2) ** 2),
    )

    context.beginPath()
    context.moveTo(data.x + xDeltaCoord, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2)
    context.lineTo(data.x + xDeltaCoord, data.y - boxHeight / 2)
    context.arc(data.x, data.y, radius, angleRadian, -angleRadian)
    context.closePath()
    context.fill()
  } else {
    context.beginPath()
    context.arc(
      data.x,
      data.y,
      data.size + HOVER_LABEL_PADDING,
      0,
      Math.PI * 2,
    )
    context.closePath()
    context.fill()
  }

  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 0
  drawCachedDiscNodeLabel(context, data, settings)
}
