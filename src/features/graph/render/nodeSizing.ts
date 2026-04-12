import type { UiLayer } from '@/features/graph/app/store/types'
import {
  projectGraphPointToScreen,
  type GraphViewState,
} from '@/features/graph/render/graphViewState'
import type { GraphRenderNode } from '@/features/graph/render/types'

const GRAPH_NODE_SCREEN_SCALE_SETTINGS = {
  densityPaddingFactor: 0.18,
  densityPaddingMax: 3,
  densityPaddingMin: 1.5,
  densityScaleMax: 1.12,
  densityScaleMin: 1.02,
  maxScale: 5.0,
  minScale: 0.92,
  rootMaxRadiusPx: 82,
  rootMinRadiusPx: 24,
  visibleDensityFactor: 0.03,
  // zoomExponent is 0 because zoom scaling is now handled by deck.gl world units.
  // The sizing pipeline produces a base pixel radius; deck.gl scales it with the camera.
  zoomExponent: 0,
  nodeMaxRadiusPx: 72,
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
  scaleMin: 0.88,
  spacingCapGapPx: 0.5,
} as const

const GRAPH_NODE_KEYWORD_EMPHASIS_SETTINGS = {
  maxScaleBoost: 0.6,
  minScaleBoost: 0.3,
  scaleLogFactor: 0.18,
} as const

const GRAPH_NODE_PROMINENCE_SETTINGS = {
  capBoostFactor: 0.22,
  connectionsCapBoostFactor: 0.52,
  commonFollowBoost: 0.06,
  connectionsDegreeBoostCap: 0.72,
  connectionsDegreeBoostLogFactor: 0.22,
  connectionsDegreeBoostRelativeFactor: 0.35,
  connectionsLayerBoost: 0.08,
  connectionsScaleCap: 1.72,
  connectionsScaleMin: 0.72,
  degreeBoostCap: 0.34,
  degreeBoostLogFactor: 0.1,
  expandedBoost: 0.08,
  floorBoostFactor: 0.34,
  pathEndpointBoost: 0.18,
  pathNodeBoost: 0.1,
  prominenceLegibilityFloorBoost: 0.18,
  rootBoost: 0.08,
  scaleCap: 1.38,
  selectedBoost: 0.22,
  sharedBoostCap: 0.14,
  sharedBoostLogFactor: 0.05,
} as const

const GRAPH_NODE_RELATIVE_SIZE_SETTINGS = {
  exponent: 1.08,
  maxScale: 1.32,
  minScale: 0.82,
  spreadThreshold: 1.25,
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
  keywordHits: number
  isRoot: boolean
  isViewportAdjacent: boolean
  nearestNeighborWorldDist?: number
  prominenceScale: number
}

type VisibleNodeRadiusStats = {
  minBaseRadius: number
  maxBaseRadius: number
  maxVisibleDegree: number
}

const getKeywordMatchScreenScale = ({
  activeLayer,
  keywordHits,
}: {
  activeLayer: UiLayer
  keywordHits: number
}) => {
  if (activeLayer !== 'keywords' || keywordHits <= 0) {
    return 1
  }

  return 1 + Math.min(
    GRAPH_NODE_KEYWORD_EMPHASIS_SETTINGS.maxScaleBoost,
    GRAPH_NODE_KEYWORD_EMPHASIS_SETTINGS.minScaleBoost +
      Math.log2(keywordHits + 1) *
        GRAPH_NODE_KEYWORD_EMPHASIS_SETTINGS.scaleLogFactor,
  )
}

const getNodeProminenceScale = ({
  node,
  activeLayer,
  maxVisibleDegree,
}: {
  node: GraphRenderNode
  activeLayer: UiLayer
  maxVisibleDegree: number
}) => {
  let boost = 0

  if (node.isSelected) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.selectedBoost
  }

  if (node.isPathEndpoint) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.pathEndpointBoost
  } else if (node.isPathNode) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.pathNodeBoost
  }

  if (node.isExpanded) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.expandedBoost
  }

  if (node.isCommonFollow) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.commonFollowBoost
  }

  if (node.sharedByExpandedCount > 1) {
    boost += Math.min(
      GRAPH_NODE_PROMINENCE_SETTINGS.sharedBoostCap,
      Math.log2(node.sharedByExpandedCount + 1) *
        GRAPH_NODE_PROMINENCE_SETTINGS.sharedBoostLogFactor,
    )
  }

  if (activeLayer === 'connections' && !node.isRoot && node.visibleDegree > 0) {
    boost += Math.min(
      GRAPH_NODE_PROMINENCE_SETTINGS.connectionsDegreeBoostCap,
      Math.log2(node.visibleDegree + 1) *
        GRAPH_NODE_PROMINENCE_SETTINGS.connectionsDegreeBoostLogFactor +
        (maxVisibleDegree > 1
          ? (node.visibleDegree / maxVisibleDegree) *
            GRAPH_NODE_PROMINENCE_SETTINGS.connectionsDegreeBoostRelativeFactor
          : 0),
    )
  } else {
    if (node.visibleDegree > 1) {
      boost += Math.min(
        GRAPH_NODE_PROMINENCE_SETTINGS.degreeBoostCap,
        Math.log2(node.visibleDegree + 1) *
          GRAPH_NODE_PROMINENCE_SETTINGS.degreeBoostLogFactor,
      )
    }

    if (activeLayer === 'connections' && !node.isRoot) {
      boost += GRAPH_NODE_PROMINENCE_SETTINGS.connectionsLayerBoost
    }
  }

  if (node.isRoot) {
    boost += GRAPH_NODE_PROMINENCE_SETTINGS.rootBoost
  }

  const cap = activeLayer === 'connections'
    ? GRAPH_NODE_PROMINENCE_SETTINGS.connectionsScaleCap
    : GRAPH_NODE_PROMINENCE_SETTINGS.scaleCap

  return clampNumber(
    1 + boost,
    1,
    cap,
  )
}

const resolveNodeGlobalScreenRadius = ({
  node,
  activeLayer,
  visibleNodeCount,
  zoomLevel,
  radiusStats,
}: {
  node: GraphRenderNode
  activeLayer: UiLayer
  visibleNodeCount: number
  zoomLevel: number
  radiusStats: VisibleNodeRadiusStats
}) => {
  const globalRadius = resolveGraphNodeScreenRadius({
    baseRadius: node.radius,
    isRoot: node.isRoot,
    visibleNodeCount,
    zoomLevel,
  })
  const keywordScale = getKeywordMatchScreenScale({
    activeLayer,
    keywordHits: node.keywordHits,
  })
  const prominenceScale = getNodeProminenceScale({
    node,
    activeLayer,
    maxVisibleDegree: radiusStats.maxVisibleDegree,
  })
  const radiusSpread = radiusStats.maxBaseRadius - radiusStats.minBaseRadius
  const relativeSizeScale =
    radiusSpread < GRAPH_NODE_RELATIVE_SIZE_SETTINGS.spreadThreshold
      ? 1
      : clampNumber(
          GRAPH_NODE_RELATIVE_SIZE_SETTINGS.minScale +
            Math.pow(
              (node.radius - radiusStats.minBaseRadius) / radiusSpread,
              GRAPH_NODE_RELATIVE_SIZE_SETTINGS.exponent,
            ) *
              (GRAPH_NODE_RELATIVE_SIZE_SETTINGS.maxScale -
                GRAPH_NODE_RELATIVE_SIZE_SETTINGS.minScale),
          GRAPH_NODE_RELATIVE_SIZE_SETTINGS.minScale,
          GRAPH_NODE_RELATIVE_SIZE_SETTINGS.maxScale,
        )
  const { minRadius, maxRadius } = getGraphNodeScreenRadiusBounds(node.isRoot)

  return {
    prominenceScale,
    radius: roundRadius(
      clampNumber(
        globalRadius * keywordScale * prominenceScale * relativeSizeScale,
        minRadius,
        maxRadius,
      ),
    ),
  }
}

const resolveVisibleNodeRadiusStats = (
  nodes: readonly GraphRenderNode[],
): VisibleNodeRadiusStats => {
  let minBaseRadius = Number.POSITIVE_INFINITY
  let maxBaseRadius = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    if (node.isRoot) {
      continue
    }

    minBaseRadius = Math.min(minBaseRadius, node.radius)
    maxBaseRadius = Math.max(maxBaseRadius, node.radius)
  }

  if (!Number.isFinite(minBaseRadius) || !Number.isFinite(maxBaseRadius)) {
    return {
      minBaseRadius: 0,
      maxBaseRadius: 0,
      maxVisibleDegree: 0,
    }
  }

  return {
    minBaseRadius,
    maxBaseRadius,
    maxVisibleDegree: nodes.reduce(
      (maxDegree, node) => Math.max(maxDegree, node.visibleDegree),
      0,
    ),
  }
}

// ─── Connections-mode direct sizing ───────────────────────────────────────────
// All other modes go through the world-radius + legibility pipeline; connections
// uses a direct visibleDegree → screen-px mapping so the hierarchy is never
// compressed out by the legibility cap or multi-factor radius chain.
const CONNECTIONS_SIZING = {
  // Pixel radius for a node with zero visible connections.
  minPx: 10,
  // Pixel radius for the most-connected node.
  maxPx: 42,
  // Selected / expanded override (always prominent).
  selectedPx: 38,
  // zoomExponent is 0 because zoom scaling is now handled by deck.gl world units.
  zoomExponent: 0,
} as const

const resolveConnectionsNodeScreenRadii = ({
  nodes,
  viewState,
}: {
  nodes: readonly GraphRenderNode[]
  viewState: GraphViewState
}): GraphNodeScreenRadii => {
  const maxDegree = nodes.reduce(
    (max, n) => (n.isRoot ? max : Math.max(max, n.visibleDegree)),
    0,
  )
  // Apply a gentle zoom factor so the graph reads well at all zoom levels.
  const zoomBias = clampNumber(
    Math.pow(2, viewState.zoom * CONNECTIONS_SIZING.zoomExponent),
    0.72,
    5.0,
  )

  return new Map(
    nodes.map((node) => {
      const { minRadius, maxRadius } = getGraphNodeScreenRadiusBounds(node.isRoot)

      if (node.isRoot) {
        return [
          node.pubkey,
          roundRadius(clampNumber(30 * zoomBias, minRadius, maxRadius)),
        ]
      }

      // Prominence override: selected / path-endpoint nodes always appear large.
      if (node.isSelected || node.isPathEndpoint === true) {
        return [
          node.pubkey,
          roundRadius(
            clampNumber(CONNECTIONS_SIZING.selectedPx * zoomBias, minRadius, maxRadius),
          ),
        ]
      }

      // Perceptual (sqrt) mapping so area is proportional to degree.
      const degreeRatio = maxDegree > 0 ? node.visibleDegree / maxDegree : 0
      const perceptual = Math.sqrt(degreeRatio)
      const rawPx =
        CONNECTIONS_SIZING.minPx +
        perceptual * (CONNECTIONS_SIZING.maxPx - CONNECTIONS_SIZING.minPx)

      return [
        node.pubkey,
        roundRadius(clampNumber(rawPx * zoomBias, minRadius, maxRadius)),
      ]
    }),
  )
}
// ────────────────────────────────────────────────────────────────────────────

export const resolveGraphNodeScreenRadiiFast = ({
  nodes,
  activeLayer,
  viewState,
  visibleNodeCount,
}: {
  nodes: readonly GraphRenderNode[]
  activeLayer: UiLayer
  viewState: GraphViewState
  visibleNodeCount: number
}): GraphNodeScreenRadii => {
  if (activeLayer === 'connections') {
    return resolveConnectionsNodeScreenRadii({ nodes, viewState })
  }

  const radiusStats = resolveVisibleNodeRadiusStats(nodes)

  return new Map(
    nodes.map((node) => {
      const resolved = resolveNodeGlobalScreenRadius({
        node,
        activeLayer,
        visibleNodeCount,
        zoomLevel: viewState.zoom,
        radiusStats,
      })

      return [
        node.pubkey,
        resolved.radius,
      ]
    }),
  )
}

const buildCellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

const buildProjectedNodeMetrics = ({
  nodes,
  activeLayer,
  viewState,
  width,
  height,
  visibleNodeCount,
  radiusStats,
}: {
  nodes: readonly GraphRenderNode[]
  activeLayer: UiLayer
  viewState: GraphViewState
  width: number
  height: number
  visibleNodeCount: number
  radiusStats: VisibleNodeRadiusStats
}) => {
  return nodes.map((node) => {
    const [screenX, screenY] = projectGraphPointToScreen({
      height,
      position: node.position,
      viewState,
      width,
    })
    const resolved = resolveNodeGlobalScreenRadius({
      node,
      activeLayer,
      visibleNodeCount,
      zoomLevel: viewState.zoom,
      radiusStats,
    })
    const bleed = resolved.radius + GRAPH_NODE_LEGIBILITY_SETTINGS.offscreenBleedPx

    return {
      pubkey: node.pubkey,
      screenX,
      screenY,
      globalRadius: resolved.radius,
      keywordHits: node.keywordHits,
      isRoot: node.isRoot,
      isViewportAdjacent:
        screenX >= -bleed &&
        screenX <= width + bleed &&
        screenY >= -bleed &&
        screenY <= height + bleed,
      nearestNeighborWorldDist: node.nearestNeighborWorldDist,
      prominenceScale: resolved.prominenceScale,
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
  prominenceScale,
  activeLayer,
}: {
  globalRadius: number
  nearestDistance: number
  isRoot: boolean
  prominenceScale: number
  activeLayer: UiLayer
}) => {
  const baseScaleMin = isRoot
    ? GRAPH_NODE_LEGIBILITY_SETTINGS.rootScaleMin
    : activeLayer === 'connections'
      ? GRAPH_NODE_PROMINENCE_SETTINGS.connectionsScaleMin
      : GRAPH_NODE_LEGIBILITY_SETTINGS.scaleMin
  const scaleMax = isRoot
    ? GRAPH_NODE_LEGIBILITY_SETTINGS.rootScaleMax
    : GRAPH_NODE_LEGIBILITY_SETTINGS.scaleMax
  const scaleMin = clampNumber(
    baseScaleMin +
      (prominenceScale - 1) *
        GRAPH_NODE_PROMINENCE_SETTINGS.prominenceLegibilityFloorBoost,
    baseScaleMin,
    scaleMax,
  )

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
  prominenceScale,
  activeLayer,
}: {
  nearestDistance: number
  maxRadius: number
  minRadius: number
  prominenceScale: number
  activeLayer: UiLayer
}) => {
  if (!Number.isFinite(nearestDistance)) {
    return maxRadius
  }

  const capBoostFactor =
    activeLayer === 'connections'
      ? GRAPH_NODE_PROMINENCE_SETTINGS.connectionsCapBoostFactor
      : GRAPH_NODE_PROMINENCE_SETTINGS.capBoostFactor
  const capFactor =
    0.5 + (prominenceScale - 1) * capBoostFactor

  return Math.max(
    minRadius,
    Math.min(
      maxRadius,
      nearestDistance * capFactor - GRAPH_NODE_LEGIBILITY_SETTINGS.spacingCapGapPx,
    ),
  )
}

export const resolveGraphNodeScreenRadii = ({
  nodes,
  activeLayer,
  viewState,
  width,
  height,
  visibleNodeCount,
  autoSizeNodes = false,
}: {
  nodes: readonly GraphRenderNode[]
  activeLayer: UiLayer
  viewState: GraphViewState
  width: number
  height: number
  visibleNodeCount: number
  autoSizeNodes?: boolean
}): GraphNodeScreenRadii => {
  if (width <= 0 || height <= 0 || nodes.length === 0) {
    return new Map()
  }

  // Connections mode: bypass the world-radius + legibility pipeline entirely.
  // Use a direct visibleDegree → screen-px mapping so size hierarchy is
  // never compressed out by the multi-factor chain (see resolveConnectionsNodeScreenRadii).
  if (activeLayer === 'connections') {
    return resolveConnectionsNodeScreenRadii({ nodes, viewState })
  }

  const projectedMetrics = buildProjectedNodeMetrics({
    nodes,
    activeLayer,
    viewState,
    width,
    height,
    visibleNodeCount,
    radiusStats: resolveVisibleNodeRadiusStats(nodes),
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
        const preservedRadius = clampNumber(
          Math.max(metric.globalRadius, autoIdeal),
          minRadius,
          maxRadius,
        )
        return [
          metric.pubkey,
          roundRadius(preservedRadius),
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
        prominenceScale: metric.prominenceScale,
        activeLayer,
      })
      const legibilityCap = resolveLegibilityCap({
        nearestDistance,
        maxRadius,
        minRadius,
        prominenceScale: metric.prominenceScale,
        activeLayer,
      })
      const prominenceFloor = clampNumber(
        metric.globalRadius *
          (1 + (metric.prominenceScale - 1) * GRAPH_NODE_PROMINENCE_SETTINGS.floorBoostFactor),
        minRadius,
        maxRadius,
      )

      return [
        metric.pubkey,
        roundRadius(
          Math.max(
            prominenceFloor,
            clampNumber(
              metric.globalRadius * legibilityScale,
              minRadius,
              legibilityCap,
            ),
          ),
        ),
      ]
    }),
  )
}
