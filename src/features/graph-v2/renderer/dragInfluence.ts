import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const DRAG_INFLUENCE_MAX_TRANSLATION_PER_FRAME = 12

export const clampInfluenceDelta = (delta: number, weight: number) => {
  const weightedDelta = delta * weight

  if (weightedDelta > DRAG_INFLUENCE_MAX_TRANSLATION_PER_FRAME) {
    return DRAG_INFLUENCE_MAX_TRANSLATION_PER_FRAME
  }

  if (weightedDelta < -DRAG_INFLUENCE_MAX_TRANSLATION_PER_FRAME) {
    return -DRAG_INFLUENCE_MAX_TRANSLATION_PER_FRAME
  }

  return weightedDelta
}

export const applyDragNeighborhoodInfluence = (
  projectionStore: GraphologyProjectionStore,
  draggedNodePubkey: string,
  dragNeighborhoodWeights: ReadonlyMap<string, number>,
  dx: number,
  dy: number,
  weightScale = 1,
) => {
  for (const [pubkey, weight] of dragNeighborhoodWeights) {
    if (pubkey === draggedNodePubkey || weight <= 0) {
      continue
    }

    if (projectionStore.isNodeFixed(pubkey)) {
      continue
    }

    const translatedX = clampInfluenceDelta(dx, weight * weightScale)
    const translatedY = clampInfluenceDelta(dy, weight * weightScale)

    if (translatedX === 0 && translatedY === 0) {
      continue
    }

    projectionStore.translateNodePosition(pubkey, translatedX, translatedY)
  }
}

export const releaseDraggedNode = (
  projectionStore: GraphologyProjectionStore,
  draggedNodePubkey: string,
  pinnedPubkeys: readonly string[],
) => {
  projectionStore.setNodeFixed(
    draggedNodePubkey,
    pinnedPubkeys.includes(draggedNodePubkey),
  )
}
