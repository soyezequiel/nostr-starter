import type Graph from 'graphology-types'

export interface DragNeighborhoodConfig {
  readonly maxDepth: number
  readonly weightsByDepth: Readonly<Record<number, number>>
}

export const DEFAULT_DRAG_NEIGHBORHOOD_CONFIG: DragNeighborhoodConfig = {
  maxDepth: 2,
  weightsByDepth: {
    0: 1,
    1: 0.45,
    2: 0.18,
  },
}

export const buildDragNeighborhoodWeights = (
  graph: Graph,
  sourcePubkey: string,
  config: DragNeighborhoodConfig = DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
) => {
  const weights = new Map<string, number>()

  if (!graph.hasNode(sourcePubkey)) {
    return weights
  }

  const maxDepth = Math.max(0, Math.floor(config.maxDepth))
  const pending: Array<{ pubkey: string; depth: number }> = [
    { pubkey: sourcePubkey, depth: 0 },
  ]
  const visited = new Set<string>([sourcePubkey])

  while (pending.length > 0) {
    const current = pending.shift()

    if (!current) {
      continue
    }

    const weight = config.weightsByDepth[current.depth]
    if (typeof weight === 'number' && weight > 0) {
      weights.set(current.pubkey, weight)
    }

    if (current.depth >= maxDepth) {
      continue
    }

    graph.forEachNeighbor(current.pubkey, (neighborPubkey) => {
      if (visited.has(neighborPubkey)) {
        return
      }

      visited.add(neighborPubkey)
      pending.push({
        pubkey: neighborPubkey,
        depth: current.depth + 1,
      })
    })
  }

  return weights
}
