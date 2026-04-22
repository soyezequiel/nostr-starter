import type { CanonicalEdge } from '@/features/graph-v2/domain/types'

const relationPriority: Record<CanonicalEdge['relation'], number> = {
  follow: 3,
  inbound: 2,
  zap: 1,
}

const originPriority: Record<CanonicalEdge['origin'], number> = {
  graph: 3,
  inbound: 2,
  connections: 1,
}

export const getDirectedPairKey = (edge: CanonicalEdge) =>
  `${edge.source}->${edge.target}`

const compareEdges = (left: CanonicalEdge, right: CanonicalEdge) =>
  left.id.localeCompare(right.id)

const shouldReplaceDirectedPairEdge = (
  current: CanonicalEdge,
  candidate: CanonicalEdge,
) => {
  const relationDelta =
    relationPriority[candidate.relation] - relationPriority[current.relation]
  if (relationDelta !== 0) return relationDelta > 0

  const originDelta =
    originPriority[candidate.origin] - originPriority[current.origin]
  if (originDelta !== 0) return originDelta > 0

  return candidate.id.localeCompare(current.id) < 0
}

export const sortAndDedupeDirectedEdges = (
  edges: readonly CanonicalEdge[],
) => {
  const edgesById = new Map<string, CanonicalEdge>()

  for (const edge of edges) {
    edgesById.set(edge.id, edge)
  }

  const edgesByDirectedPair = new Map<string, CanonicalEdge>()

  for (const edge of edgesById.values()) {
    const pairKey = getDirectedPairKey(edge)
    const current = edgesByDirectedPair.get(pairKey)

    if (!current || shouldReplaceDirectedPairEdge(current, edge)) {
      edgesByDirectedPair.set(pairKey, edge)
    }
  }

  return Array.from(edgesByDirectedPair.values()).sort(compareEdges)
}
