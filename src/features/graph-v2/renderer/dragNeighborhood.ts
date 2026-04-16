import type Graph from 'graphology-types'

export interface DragNeighborhoodConfig {
  readonly maxHopDistance: number
}

export const DEFAULT_DRAG_NEIGHBORHOOD_CONFIG: DragNeighborhoodConfig = {
  // Generous enough to include distant neighbors so physics decay is natural
  // instead of a hard cutoff. Nodes beyond this are still anchored by FA2.
  maxHopDistance: 12,
}

/**
 * Returns the shortest hop distance from `sourcePubkey` to every reachable
 * node within `maxHopDistance`. The source itself has distance `0`.
 *
 * Unlike the previous weighted/BFS approach, there is no weight cutoff: the
 * drag influence layer handles falloff continuously via spring dynamics.
 */
export const buildDragHopDistances = (
  graph: Graph,
  sourcePubkey: string,
  config: DragNeighborhoodConfig = DEFAULT_DRAG_NEIGHBORHOOD_CONFIG,
) => {
  const distances = new Map<string, number>()

  if (!graph.hasNode(sourcePubkey)) {
    return distances
  }

  const maxHopDistance = Math.max(0, Math.floor(config.maxHopDistance))
  const queue: Array<{ pubkey: string; depth: number }> = [
    { pubkey: sourcePubkey, depth: 0 },
  ]

  distances.set(sourcePubkey, 0)

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current) {
      continue
    }

    if (current.depth >= maxHopDistance) {
      continue
    }

    const nextDepth = current.depth + 1

    graph.forEachNeighbor(current.pubkey, (neighborPubkey) => {
      if (distances.has(neighborPubkey)) {
        return
      }

      distances.set(neighborPubkey, nextDepth)
      queue.push({ pubkey: neighborPubkey, depth: nextDepth })
    })
  }

  return distances
}
