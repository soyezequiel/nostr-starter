import type { RenderConfig } from '@/features/graph/app/store/types'
import type { GraphEdgeSegment } from '@/features/graph/render/graphSceneGeometry'

export type ArrowMarkerIcon =
  | 'triangle'
  | 'triangle-bidirectional'
  | 'chevron'
  | 'chevron-bidirectional'

export type ArrowMarkerDatum = GraphEdgeSegment & {
  arrowIcon: ArrowMarkerIcon
}

export const buildArrowMarkerData = ({
  segments,
  arrowType,
}: {
  segments: readonly GraphEdgeSegment[]
  arrowType: RenderConfig['arrowType']
}): ArrowMarkerDatum[] => {
  const directionalArrowIcon = arrowType === 'triangle' ? 'triangle' : 'chevron'
  const bidirectionalArrowIcon =
    arrowType === 'triangle'
      ? 'triangle-bidirectional'
      : 'chevron-bidirectional'

  const seenMiddle = new Set<string>()
  const seenEnd = new Set<string>()
  const result: ArrowMarkerDatum[] = []

  for (const segment of segments) {
    const pairKey = [segment.source, segment.target].sort().join(':')

    if (
      segment.isBidirectional === true &&
      segment.progressStart <= 0.5 &&
      segment.progressEnd > 0.5
    ) {
      if (!seenMiddle.has(pairKey)) {
        seenMiddle.add(pairKey)
        result.push({
          ...segment,
          arrowIcon: bidirectionalArrowIcon,
        })
      }
      continue
    }

    // Only add directional arrow if it's NOT a bidirectional edge
    // and we haven't seen an end arrow for this specific direction.
    if (!segment.isBidirectional && segment.progressEnd === 1) {
      const directionKey = `${segment.source}->${segment.target}`
      if (!seenEnd.has(directionKey)) {
        seenEnd.add(directionKey)
        result.push({
          ...segment,
          arrowIcon: directionalArrowIcon,
        })
      }
    }
  }

  return result
}
