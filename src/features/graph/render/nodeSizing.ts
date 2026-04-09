import { OrthographicViewport } from '@deck.gl/core'

import type { GraphViewState } from '@/features/graph/render/graphViewState'
import type { GraphRenderNode } from '@/features/graph/render/types'

const GRAPH_NODE_SCREEN_SCALE_SETTINGS = {
  densityPaddingFactor: 0.18,
  densityPaddingMax: 3,
  densityPaddingMin: 1.5,
  densityScaleMax: 1.12,
  densityScaleMin: 1.02,
  maxScale: 2.75,
  minScale: 0.92,
  rootMaxRadiusPx: 56,
  rootMinRadiusPx: 24,
  visibleDensityFactor: 0.03,
  zoomExponent: 0.34,
  nodeMaxRadiusPx: 44,
  nodeMinRadiusPx: 12,
} as const

const GRAPH_NODE_LEGIBILITY_SETTINGS = {
  cellSizePx: 72,
  comfortPaddingPx: 1.5,
  maxLookupRings: 3,
  offscreenBleedPx: 96,
  rootScaleMax: 1.3,
  rootScaleMin: 0.92,
  scaleMax: 1.52,
  scaleMin: 0.8,
  spacingCapGapPx: 0.5,
} as const

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const roundRadius = (value: number) => Math.round(value * 10) / 10

const getGraphNodeScreenRadiusBounds = (isRoot: boolean) => ({
  minRadius: isRoot
    ? GRAPH_NODE_SCREEN_SCALE_SETTINGS.rootMinRadiusPx
    : GRAPH_NODE_SCREEN_SCALE_SETTINGS.nodeMinRadiusPx,
  maxRadius: isRoot
    ? GRAPH_NODE_SCREEN_SCALE_SETTINGS.rootMaxRadiusPx
    : GRAPH_NODE_SCREEN_SCALE_SETTINGS.nodeMaxRadiusPx,
})

export const getGraphNodeScreenScale = ({
  zoomLevel,
  visibleNodeCount,
}: {
  zoomLevel: number
  visibleNodeCount: number
}) => {
  const zoomScale = clampNumber(
    Math.pow(2, zoomLevel * GRAPH_NODE_SCREEN_SCALE_SETTINGS.zoomExponent),
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.minScale,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.maxScale,
  )
  const densityScale = clampNumber(
    1.07 -
      Math.log10(Math.max(1, visibleNodeCount) + 1) *
        GRAPH_NODE_SCREEN_SCALE_SETTINGS.visibleDensityFactor,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.densityScaleMin,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.densityScaleMax,
  )

  return clampNumber(
    zoomScale * densityScale,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.minScale,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.maxScale,
  )
}

const getGraphNodeScreenPadding = (visibleNodeCount: number) =>
  clampNumber(
    3.1 -
      Math.log10(Math.max(1, visibleNodeCount) + 1) *
        GRAPH_NODE_SCREEN_SCALE_SETTINGS.densityPaddingFactor,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.densityPaddingMin,
    GRAPH_NODE_SCREEN_SCALE_SETTINGS.densityPaddingMax,
  )

export const resolveGraphNodeScreenRadius = ({
  baseRadius,
  isRoot,
  visibleNodeCount,
  zoomLevel,
}: {
  baseRadius: number
  isRoot: boolean
  visibleNodeCount: number
  zoomLevel: number
}) => {
  const scale = getGraphNodeScreenScale({
    zoomLevel,
    visibleNodeCount,
  })
  const densityPadding = getGraphNodeScreenPadding(visibleNodeCount)
  const { minRadius, maxRadius } = getGraphNodeScreenRadiusBounds(isRoot)

  return roundRadius(
    clampNumber(baseRadius * scale + densityPadding, minRadius, maxRadius),
  )
}

export type GraphNodeScreenRadii = ReadonlyMap<string, number>

type ProjectedNodeMetric = {
  pubkey: string
  screenX: number
  screenY: number
  globalRadius: number
  isRoot: boolean
  isViewportAdjacent: boolean
  nearestNeighborWorldDist?: number
}

const buildCellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

const buildProjectedNodeMetrics = ({
  nodes,
  viewState,
  width,
  height,
  visibleNodeCount,
}: {
  nodes: readonly GraphRenderNode[]
  viewState: GraphViewState
  width: number
  height: number
  visibleNodeCount: number
}) => {
  const viewport = new OrthographicViewport({
    width,
    height,
    target: viewState.target,
    zoom: viewState.zoom,
  })

  return nodes.map((node) => {
    const [screenX, screenY] = viewport.project([
      node.position[0],
      node.position[1],
      0,
    ])
    const globalRadius = resolveGraphNodeScreenRadius({
      baseRadius: node.radius,
      isRoot: node.isRoot,
      visibleNodeCount,
      zoomLevel: viewState.zoom,
    })
    const bleed = globalRadius + GRAPH_NODE_LEGIBILITY_SETTINGS.offscreenBleedPx

    return {
      pubkey: node.pubkey,
      screenX,
      screenY,
      globalRadius,
      isRoot: node.isRoot,
      isViewportAdjacent:
        screenX >= -bleed &&
        screenX <= width + bleed &&
        screenY >= -bleed &&
        screenY <= height + bleed,
      nearestNeighborWorldDist: node.nearestNeighborWorldDist,
    } satisfies ProjectedNodeMetric
  })
}

const buildProjectedNodeCells = (metrics: readonly ProjectedNodeMetric[]) => {
  const cells = new Map<string, ProjectedNodeMetric[]>()

  for (const metric of metrics) {

    const cellX = Math.floor(
      metric.screenX / GRAPH_NODE_LEGIBILITY_SETTINGS.cellSizePx,
    )
    const cellY = Math.floor(
      metric.screenY / GRAPH_NODE_LEGIBILITY_SETTINGS.cellSizePx,
    )
    const key = buildCellKey(cellX, cellY)
    const current = cells.get(key)

    if (current) {
      current.push(metric)
      continue
    }

    cells.set(key, [metric])
  }

  return cells
}

const getNearestNeighborDistance = ({
  metric,
  cells,
}: {
  metric: ProjectedNodeMetric
  cells: ReadonlyMap<string, readonly ProjectedNodeMetric[]>
}) => {
  const originCellX = Math.floor(
    metric.screenX / GRAPH_NODE_LEGIBILITY_SETTINGS.cellSizePx,
  )
  const originCellY = Math.floor(
    metric.screenY / GRAPH_NODE_LEGIBILITY_SETTINGS.cellSizePx,
  )
  let nearestDistance = Number.POSITIVE_INFINITY

  for (
    let ring = 0;
    ring <= GRAPH_NODE_LEGIBILITY_SETTINGS.maxLookupRings;
    ring += 1
  ) {
    for (let deltaX = -ring; deltaX <= ring; deltaX += 1) {
      for (let deltaY = -ring; deltaY <= ring; deltaY += 1) {
        if (ring > 0 && Math.max(Math.abs(deltaX), Math.abs(deltaY)) !== ring) {
          continue
        }

        const candidates = cells.get(
          buildCellKey(originCellX + deltaX, originCellY + deltaY),
        )

        if (!candidates) {
          continue
        }

        for (const candidate of candidates) {
          if (candidate.pubkey === metric.pubkey) {
            continue
          }

          const distance = Math.hypot(
            metric.screenX - candidate.screenX,
            metric.screenY - candidate.screenY,
          )

          if (distance < nearestDistance) {
            nearestDistance = distance
          }
        }
      }
    }
  }

  return nearestDistance
}

const resolveLegibilityScale = ({
  globalRadius,
  nearestDistance,
  isRoot,
}: {
  globalRadius: number
  nearestDistance: number
  isRoot: boolean
}) => {
  const scaleMin = isRoot
    ? GRAPH_NODE_LEGIBILITY_SETTINGS.rootScaleMin
    : GRAPH_NODE_LEGIBILITY_SETTINGS.scaleMin
  const scaleMax = isRoot
    ? GRAPH_NODE_LEGIBILITY_SETTINGS.rootScaleMax
    : GRAPH_NODE_LEGIBILITY_SETTINGS.scaleMax

  if (!Number.isFinite(nearestDistance)) {
    return scaleMax
  }

  return clampNumber(
    nearestDistance /
      Math.max(
        1,
        globalRadius * 2 + GRAPH_NODE_LEGIBILITY_SETTINGS.comfortPaddingPx,
      ),
    scaleMin,
    scaleMax,
  )
}

const resolveLegibilityCap = ({
  nearestDistance,
  maxRadius,
  minRadius,
}: {
  nearestDistance: number
  maxRadius: number
  minRadius: number
}) => {
  if (!Number.isFinite(nearestDistance)) {
    return maxRadius
  }

  return Math.max(
    minRadius,
    Math.min(
      maxRadius,
      nearestDistance * 0.5 - GRAPH_NODE_LEGIBILITY_SETTINGS.spacingCapGapPx,
    ),
  )
}

export const resolveGraphNodeScreenRadii = ({
  nodes,
  viewState,
  width,
  height,
  visibleNodeCount,
  autoSizeNodes = false,
}: {
  nodes: readonly GraphRenderNode[]
  viewState: GraphViewState
  width: number
  height: number
  visibleNodeCount: number
  autoSizeNodes?: boolean
}): GraphNodeScreenRadii => {
  if (width <= 0 || height <= 0 || nodes.length === 0) {
    return new Map()
  }

  const projectedMetrics = buildProjectedNodeMetrics({
    nodes,
    viewState,
    width,
    height,
    visibleNodeCount,
  })
  const cells = buildProjectedNodeCells(projectedMetrics)

  return new Map(
    projectedMetrics.map((metric) => {
      const { minRadius, maxRadius } = getGraphNodeScreenRadiusBounds(
        metric.isRoot,
      )

      if (autoSizeNodes && metric.nearestNeighborWorldDist !== undefined) {
        const viewScale = Math.pow(2, viewState.zoom)
        const nearestDistancePx = metric.nearestNeighborWorldDist * viewScale
        const autoIdeal = nearestDistancePx * 0.5 - GRAPH_NODE_LEGIBILITY_SETTINGS.comfortPaddingPx
        return [
          metric.pubkey,
          Math.max(minRadius, autoIdeal)
        ]
      }

      if (!metric.isViewportAdjacent) {
        return [metric.pubkey, metric.globalRadius]
      }

      const nearestDistance = getNearestNeighborDistance({ metric, cells })

      const legibilityScale = resolveLegibilityScale({
        globalRadius: metric.globalRadius,
        nearestDistance,
        isRoot: metric.isRoot,
      })
      const legibilityCap = resolveLegibilityCap({
        nearestDistance,
        maxRadius,
        minRadius,
      })

      return [
        metric.pubkey,
        roundRadius(
          clampNumber(
            metric.globalRadius * legibilityScale,
            minRadius,
            legibilityCap,
          ),
        ),
      ]
    }),
  )
}
