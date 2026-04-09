import {
  GRAPH_FIT_PADDING_PX,
  GRAPH_MAX_ZOOM,
  GRAPH_MIN_SETTLED_ZOOM,
  GRAPH_MIN_ZOOM,
} from '@/features/graph/render/constants'
import type { GraphBounds } from '@/features/graph/render/types'

export interface GraphViewState {
  target: [number, number, number]
  zoom: number
  minZoom: number
  maxZoom: number
}

type GraphViewStateInput = {
  target?: [number, number, number] | [number, number]
  zoom?: number | [number, number]
  minZoom?: number
  maxZoom?: number
}

const normalizeTarget = (
  target: [number, number, number] | [number, number] | undefined,
): [number, number, number] => {
  if (!target) {
    return [0, 0, 0]
  }

  if (target.length === 3) {
    return [target[0], target[1], target[2]]
  }

  return [target[0], target[1], 0]
}

export const sanitizeGraphViewState = (
  viewState: GraphViewStateInput | undefined,
): GraphViewState => {
  const rawZoom = Array.isArray(viewState?.zoom)
    ? viewState.zoom[0]
    : viewState?.zoom

  return {
    target: normalizeTarget(viewState?.target),
    zoom: Math.min(
      GRAPH_MAX_ZOOM,
      Math.max(GRAPH_MIN_ZOOM, rawZoom ?? GRAPH_MIN_SETTLED_ZOOM),
    ),
    minZoom: GRAPH_MIN_ZOOM,
    maxZoom: GRAPH_MAX_ZOOM,
  }
}

export const createGraphFitSignature = ({
  topologySignature,
  width,
  height,
}: {
  topologySignature: string
  width: number
  height: number
}) => `${topologySignature}:${width}:${height}`

export const createFittedGraphViewState = ({
  bounds,
  width,
  height,
}: {
  bounds: GraphBounds
  width: number
  height: number
}): GraphViewState => {
  const availableWidth = Math.max(1, width - GRAPH_FIT_PADDING_PX * 2)
  const availableHeight = Math.max(1, height - GRAPH_FIT_PADDING_PX * 2)
  const extentX = Math.max(1, bounds.maxX - bounds.minX)
  const extentY = Math.max(1, bounds.maxY - bounds.minY)
  const fitScale = Math.min(availableWidth / extentX, availableHeight / extentY)
  const fitZoom = Math.log2(Math.max(fitScale, Number.MIN_VALUE))

  return sanitizeGraphViewState({
    target: [
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      0,
    ],
    zoom: fitZoom,
  })
}
