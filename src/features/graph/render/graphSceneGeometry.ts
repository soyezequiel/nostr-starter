import {
  GRAPH_CURVED_EDGE_OFFSET_FACTOR,
  GRAPH_CURVED_EDGE_OFFSET_MAX,
  GRAPH_CURVED_EDGE_OFFSET_MIN,
  GRAPH_CURVED_EDGE_SAMPLE_STEPS,
} from '@/features/graph/render/constants'
import type { GraphRenderEdge } from '@/features/graph/render/types'

type Point = [number, number]

export type GraphEdgeSegment = {
  id: string
  source: string
  target: string
  sourcePosition: Point
  targetPosition: Point
  relation: GraphRenderEdge['relation']
  weight: number
  isPriority: boolean
  targetSharedByExpandedCount: number
  progressStart: number
  progressEnd: number
}

type EdgeEndpoints = {
  sourcePosition: Point
  targetPosition: Point
}

const EDGE_SOURCE_PADDING_PX = 3
const EDGE_TARGET_PADDING_PX = 4

const compareEdgesById = <T extends { id: string }>(left: T, right: T) =>
  left.id.localeCompare(right.id)

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const hashString = (value: string) => {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }

  return hash
}

const graphSceneGeometryCache = new Map<
  string,
  {
    segments: GraphEdgeSegment[]
  }
>()

const adjustEdgeEndpoint = ({
  from,
  to,
  padding,
}: {
  from: Point
  to: Point
  padding: number
}): Point => {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return to
  }

  return [to[0] - (dx / length) * padding, to[1] - (dy / length) * padding]
}

const getEdgeEndpoints = (edge: GraphRenderEdge): EdgeEndpoints => ({
  sourcePosition: adjustEdgeEndpoint({
    from: edge.targetPosition,
    to: edge.sourcePosition,
    padding: edge.sourceRadius + EDGE_SOURCE_PADDING_PX,
  }),
  targetPosition: adjustEdgeEndpoint({
    from: edge.sourcePosition,
    to: edge.targetPosition,
    padding: edge.targetRadius + EDGE_TARGET_PADDING_PX,
  }),
})

const compareConvergingEdges = (
  left: GraphRenderEdge,
  right: GraphRenderEdge,
) => {
  const leftAngle = Math.atan2(
    left.sourcePosition[1] - left.targetPosition[1],
    left.sourcePosition[0] - left.targetPosition[0],
  )
  const rightAngle = Math.atan2(
    right.sourcePosition[1] - right.targetPosition[1],
    right.sourcePosition[0] - right.targetPosition[0],
  )

  if (leftAngle !== rightAngle) {
    return leftAngle - rightAngle
  }

  return left.id.localeCompare(right.id)
}

export const createGraphSceneGeometrySignature = (
  edges: readonly GraphRenderEdge[],
) => {
  let hash = 2166136261

  const feedString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }

  const feedNumber = (value: number) => {
    feedString(Number.isFinite(value) ? value.toString() : 'NaN')
  }

  for (const edge of edges) {
    feedString(edge.id)
    feedString(edge.source)
    feedString(edge.target)
    feedString(edge.relation)
    feedNumber(edge.weight)
    feedNumber(edge.sourcePosition[0])
    feedNumber(edge.sourcePosition[1])
    feedNumber(edge.targetPosition[0])
    feedNumber(edge.targetPosition[1])
    feedNumber(edge.sourceRadius)
    feedNumber(edge.targetRadius)
    feedNumber(edge.targetSharedByExpandedCount)
    feedString(edge.isPriority ? '1' : '0')
  }

  return `${edges.length}e:${(hash >>> 0).toString(36)}`
}

const resolveLaneOffsets = (count: number, targetPubkey: string) => {
  const midpoint = (count - 1) / 2
  const centerLaneSign = hashString(targetPubkey) % 2 === 0 ? -1 : 1

  return Array.from({ length: count }, (_, index) => {
    const lane = index - midpoint
    return lane === 0 ? centerLaneSign * 0.5 : lane
  })
}

const sampleQuadraticBezierPath = ({
  start,
  control,
  end,
}: {
  start: Point
  control: Point
  end: Point
}): Point[] =>
  Array.from({ length: GRAPH_CURVED_EDGE_SAMPLE_STEPS + 1 }, (_, step) => {
    const t = step / GRAPH_CURVED_EDGE_SAMPLE_STEPS
    const inverseT = 1 - t

    return [
      inverseT * inverseT * start[0] +
        2 * inverseT * t * control[0] +
        t * t * end[0],
      inverseT * inverseT * start[1] +
        2 * inverseT * t * control[1] +
        t * t * end[1],
    ]
  })

const buildSegmentsFromPath = (
  edge: GraphRenderEdge,
  path: Point[],
): GraphEdgeSegment[] => {
  const segments: GraphEdgeSegment[] = []
  
  for (let index = 0; index < path.length - 1; index++) {
    segments.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourcePosition: path[index],
      targetPosition: path[index + 1],
      relation: edge.relation,
      weight: edge.weight,
      isPriority: edge.isPriority,
      targetSharedByExpandedCount: edge.targetSharedByExpandedCount,
      progressStart: index / (path.length - 1),
      progressEnd: (index + 1) / (path.length - 1),
    })
  }

  return segments
}

const buildCurvedEdgeSegments = (
  edge: GraphRenderEdge,
  laneOffset: number,
): GraphEdgeSegment[] | null => {
  const { sourcePosition, targetPosition } = getEdgeEndpoints(edge)
  const dx = targetPosition[0] - sourcePosition[0]
  const dy = targetPosition[1] - sourcePosition[1]
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return null
  }

  const normalX = -dy / length
  const normalY = dx / length
  const offsetStep = clampNumber(
    length * GRAPH_CURVED_EDGE_OFFSET_FACTOR,
    GRAPH_CURVED_EDGE_OFFSET_MIN,
    GRAPH_CURVED_EDGE_OFFSET_MAX,
  )
  const control: Point = [
    (sourcePosition[0] + targetPosition[0]) / 2 +
      normalX * laneOffset * offsetStep,
    (sourcePosition[1] + targetPosition[1]) / 2 +
      normalY * laneOffset * offsetStep,
  ]

  const path = sampleQuadraticBezierPath({
    start: sourcePosition,
    control,
    end: targetPosition,
  })

  return buildSegmentsFromPath(edge, path)
}

const buildStraightEdgeSegments = (edge: GraphRenderEdge): GraphEdgeSegment[] => {
  const { sourcePosition, targetPosition } = getEdgeEndpoints(edge)
  const path = Array.from({ length: GRAPH_CURVED_EDGE_SAMPLE_STEPS + 1 }, (_, step) => {
    const t = step / GRAPH_CURVED_EDGE_SAMPLE_STEPS
    return [
      sourcePosition[0] * (1 - t) + targetPosition[0] * t,
      sourcePosition[1] * (1 - t) + targetPosition[1] * t,
    ] as Point
  })

  return buildSegmentsFromPath(edge, path)
}

export const buildGraphSceneGeometry = (
  edges: readonly GraphRenderEdge[],
  signature?: string,
) => {
  const cacheKey = signature ?? createGraphSceneGeometrySignature(edges)
  const cachedGeometry = graphSceneGeometryCache.get(cacheKey)

  if (cachedGeometry) {
    return cachedGeometry
  }

  const segments: GraphEdgeSegment[] = []
  const convergingFollowEdges = new Map<string, GraphRenderEdge[]>()
  const sortedEdges = [...edges].sort(compareEdgesById)

  for (const edge of sortedEdges) {
    if (edge.relation !== 'follow') {
      segments.push(...buildStraightEdgeSegments(edge))
      continue
    }

    const targetEdges = convergingFollowEdges.get(edge.target) ?? []
    targetEdges.push(edge)
    convergingFollowEdges.set(edge.target, targetEdges)
  }

  const orderedTargets = [...convergingFollowEdges.keys()].sort()

  for (const targetPubkey of orderedTargets) {
    const group = convergingFollowEdges.get(targetPubkey)!

    if (group.length < 2) {
      segments.push(...buildStraightEdgeSegments(group[0]))
      continue
    }

    const orderedGroup = [...group].sort(compareConvergingEdges)
    const laneOffsets = resolveLaneOffsets(orderedGroup.length, targetPubkey)

    for (const [index, edge] of orderedGroup.entries()) {
      const curvedSegments = buildCurvedEdgeSegments(edge, laneOffsets[index])

      if (!curvedSegments) {
        segments.push(...buildStraightEdgeSegments(edge))
        continue
      }

      segments.push(...curvedSegments)
    }
  }

  const geometry = { segments }
  graphSceneGeometryCache.set(cacheKey, geometry)

  return geometry
}
