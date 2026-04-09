import type { GraphLink } from '@/features/graph/app/store/types'

export interface DirectedEvidenceEdge {
  source: string
  target: string
}

export interface DirectedEvidenceSnapshot {
  combinedAdjacency: Record<string, string[]>
  inboundAdjacency: Record<string, string[]>
  inboundEdges: DirectedEvidenceEdge[]
  mutualAdjacency: Record<string, string[]>
  mutualPairs: DirectedEvidenceEdge[]
}

const SORT_OPTIONS = { numeric: false, sensitivity: 'base' } as const

const comparePubkeys = (left: string, right: string) =>
  left.localeCompare(right, undefined, SORT_OPTIONS)

const createEdgeKey = (source: string, target: string) => `${source}->${target}`

const buildSortedRecord = (input: Map<string, Set<string>>) =>
  Object.fromEntries(
    Array.from(input.entries())
      .sort(([leftPubkey], [rightPubkey]) =>
        comparePubkeys(leftPubkey, rightPubkey),
      )
      .map(([pubkey, neighbors]) => [
        pubkey,
        Array.from(neighbors).sort(comparePubkeys),
      ]),
  )

export function deriveDirectedEvidence(input: {
  links: readonly GraphLink[]
  inboundLinks: readonly GraphLink[]
}): DirectedEvidenceSnapshot {
  const combinedAdjacency = new Map<string, Set<string>>()
  const inboundAdjacency = new Map<string, Set<string>>()
  const inboundEdgesByKey = new Map<string, DirectedEvidenceEdge>()

  const addDirectedEdge = (
    adjacency: Map<string, Set<string>>,
    source: string,
    target: string,
  ) => {
    const neighbors = adjacency.get(source) ?? new Set<string>()
    neighbors.add(target)
    adjacency.set(source, neighbors)
  }

  for (const link of input.links) {
    if (link.relation !== 'follow') {
      continue
    }

    addDirectedEdge(combinedAdjacency, link.source, link.target)
  }

  for (const link of input.inboundLinks) {
    if (link.relation !== 'inbound') {
      continue
    }

    addDirectedEdge(combinedAdjacency, link.source, link.target)

    const followers = inboundAdjacency.get(link.target) ?? new Set<string>()
    followers.add(link.source)
    inboundAdjacency.set(link.target, followers)

    const edgeKey = createEdgeKey(link.source, link.target)
    if (!inboundEdgesByKey.has(edgeKey)) {
      inboundEdgesByKey.set(edgeKey, {
        source: link.source,
        target: link.target,
      })
    }
  }

  const mutualAdjacency = new Map<string, Set<string>>()
  const mutualPairs: DirectedEvidenceEdge[] = []

  for (const [source, targets] of combinedAdjacency.entries()) {
    for (const target of targets) {
      if (!combinedAdjacency.get(target)?.has(source)) {
        continue
      }

      const sourceMutuals = mutualAdjacency.get(source) ?? new Set<string>()
      sourceMutuals.add(target)
      mutualAdjacency.set(source, sourceMutuals)

      const targetMutuals = mutualAdjacency.get(target) ?? new Set<string>()
      targetMutuals.add(source)
      mutualAdjacency.set(target, targetMutuals)

      if (comparePubkeys(source, target) < 0) {
        mutualPairs.push({ source, target })
      }
    }
  }

  return {
    combinedAdjacency: buildSortedRecord(combinedAdjacency),
    inboundAdjacency: buildSortedRecord(inboundAdjacency),
    inboundEdges: Array.from(inboundEdgesByKey.values()).sort((left, right) => {
      if (left.source !== right.source) {
        return comparePubkeys(left.source, right.source)
      }

      return comparePubkeys(left.target, right.target)
    }),
    mutualAdjacency: buildSortedRecord(mutualAdjacency),
    mutualPairs: mutualPairs.sort((left, right) => {
      if (left.source !== right.source) {
        return comparePubkeys(left.source, right.source)
      }

      return comparePubkeys(left.target, right.target)
    }),
  }
}
