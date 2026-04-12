import type { GraphViewState } from '@/features/graph/render/graphViewState'
import type { GraphEdgeSegment } from '@/features/graph/render/graphSceneGeometry'
import type { GraphNodeScreenRadii } from '@/features/graph/render/nodeSizing'
import type { GraphRenderNode } from '@/features/graph/render/types'

export const EDGE_SOURCE_PADDING_PX = 3
export const EDGE_TARGET_PADDING_PX = 2
export const ARROW_TARGET_COMPENSATION_PX = 3

export type VisibleGeometryContext = {
  nodeByPubkey: ReadonlyMap<string, GraphRenderNode>
  nodeScreenRadii: GraphNodeScreenRadii
  nodeSizeFactor: number
  viewState: Pick<GraphViewState, 'zoom'>
}

const adjustSegmentEndpoint = ({
  from,
  to,
  paddingWorld,
}: {
  from: readonly [number, number]
  to: readonly [number, number]
  paddingWorld: number
}): [number, number] => {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return [to[0], to[1]]
  }

  return [to[0] - (dx / length) * paddingWorld, to[1] - (dy / length) * paddingWorld]
}

export const getVisibleNodeRadius = ({
  pubkey,
  fallbackRadius,
  nodeScreenRadii,
  nodeSizeFactor,
}: {
  pubkey: string
  fallbackRadius: number
  nodeScreenRadii: GraphNodeScreenRadii
  nodeSizeFactor: number
}) => (nodeScreenRadii.get(pubkey) ?? fallbackRadius) * nodeSizeFactor

export const getVisibleEdgeEndpoints = ({
  segment,
  context,
}: {
  segment: GraphEdgeSegment
  context: VisibleGeometryContext
}) => {
  const { nodeByPubkey, nodeScreenRadii, nodeSizeFactor, viewState } = context
  const viewScale = Math.max(Number.MIN_VALUE, Math.pow(2, viewState.zoom))
  let sourcePosition = segment.sourcePosition
  let targetPosition = segment.targetPosition

  if (segment.progressStart === 0) {
    const sourceNode = nodeByPubkey.get(segment.source)

    if (sourceNode) {
      sourcePosition = adjustSegmentEndpoint({
        from: segment.targetPosition,
        to: sourceNode.position,
        paddingWorld:
          (getVisibleNodeRadius({
            pubkey: sourceNode.pubkey,
            fallbackRadius: sourceNode.radius,
            nodeScreenRadii,
            nodeSizeFactor,
          }) +
            EDGE_SOURCE_PADDING_PX) /
          viewScale,
      })
    }
  }

  if (segment.progressEnd === 1) {
    const targetNode = nodeByPubkey.get(segment.target)

    if (targetNode) {
      targetPosition = adjustSegmentEndpoint({
        from: segment.sourcePosition,
        to: targetNode.position,
        paddingWorld:
          (getVisibleNodeRadius({
            pubkey: targetNode.pubkey,
            fallbackRadius: targetNode.radius,
            nodeScreenRadii,
            nodeSizeFactor,
          }) +
            EDGE_TARGET_PADDING_PX) /
          viewScale,
      })
    }
  }

  return { sourcePosition, targetPosition }
}

export const getVisibleArrowPlacement = ({
  segment,
  context,
}: {
  segment: GraphEdgeSegment
  context: VisibleGeometryContext
}) => {
  const { sourcePosition, targetPosition } = getVisibleEdgeEndpoints({
    segment,
    context,
  })
  const viewScale = Math.max(Number.MIN_VALUE, Math.pow(2, context.viewState.zoom))
  const dx = targetPosition[0] - sourcePosition[0]
  const dy = targetPosition[1] - sourcePosition[1]
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return {
      angle: 0,
      position: targetPosition,
    }
  }

  return {
    angle: ((-Math.atan2(dy, dx) * 180) / Math.PI),
    position: [
      targetPosition[0] + (dx / length) * (ARROW_TARGET_COMPENSATION_PX / viewScale),
      targetPosition[1] + (dy / length) * (ARROW_TARGET_COMPENSATION_PX / viewScale),
    ] as [number, number],
  }
}
