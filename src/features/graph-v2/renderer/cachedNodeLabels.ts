import type {
  NodeHoverDrawingFunction,
  NodeLabelDrawingFunction,
} from 'sigma/rendering'

import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import { measureNodeLabelTextWidth } from '@/features/graph-v2/renderer/textMetricsCache'

const HOVER_LABEL_PADDING = 2
const NODE_LABEL_SIZE_FACTOR = 1.05
const MIN_NODE_LABEL_SIZE = 10
const MAX_NODE_LABEL_SIZE = 24

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

export const drawCachedDiscNodeLabel: NodeLabelDrawingFunction<
  SigmaNodeAttributes,
  SigmaEdgeAttributes
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

  context.fillStyle = color
  context.font = `${weight} ${labelSize}px ${font}`
  context.fillText(
    data.label,
    data.x + data.size + Math.max(3, labelSize * 0.22),
    data.y + labelSize / 3,
  )
}

export const drawCachedDiscNodeHover: NodeHoverDrawingFunction<
  SigmaNodeAttributes,
  SigmaEdgeAttributes
> = (context, data, settings) => {
  const labelSize = resolveProportionalNodeLabelSize(
    data.size,
    settings.labelSize,
  )
  const font = settings.labelFont
  const weight = settings.labelWeight

  context.font = `${weight} ${labelSize}px ${font}`
  context.fillStyle = '#FFF'
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 8
  context.shadowColor = '#000'

  if (typeof data.label === 'string') {
    const textWidth = measureNodeLabelTextWidth(context, data.label)
    const boxWidth = Math.round(textWidth + 5)
    const boxHeight = Math.round(labelSize + 2 * HOVER_LABEL_PADDING)
    const radius = Math.max(data.size, labelSize / 2) + HOVER_LABEL_PADDING
    const angleRadian = Math.asin(boxHeight / 2 / radius)
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
