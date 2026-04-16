import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export interface DragNeighborhoodInfluenceNodeState {
  anchorOffsetX: number
  anchorOffsetY: number
  velocityX: number
  velocityY: number
  weight: number
}

export interface DragNeighborhoodInfluenceState {
  readonly nodes: Map<string, DragNeighborhoodInfluenceNodeState>
}

export interface DragNeighborhoodInfluenceStepResult {
  active: boolean
  translated: boolean
}

export interface DragNeighborhoodInfluenceConfig {
  frameMs: number
  maxDeltaMs: number
  baseStiffness: number
  stiffnessByWeight: number
  baseDamping: number
  dampingByWeight: number
  maxVelocityPerFrame: number
  maxTranslationPerFrame: number
  stopSpeedThreshold: number
  stopDistanceThreshold: number
}

export const DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG: DragNeighborhoodInfluenceConfig = {
  frameMs: 16,
  maxDeltaMs: 32,
  baseStiffness: 0.03,
  stiffnessByWeight: 1.05,
  baseDamping: 0.78,
  dampingByWeight: 0.12,
  maxVelocityPerFrame: 10,
  maxTranslationPerFrame: 12,
  stopSpeedThreshold: 0.035,
  stopDistanceThreshold: 0.12,
}

export const clampInfluenceDelta = (delta: number, weight: number) => {
  const weightedDelta = delta * weight

  if (
    weightedDelta >
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame
  ) {
    return DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame
  }

  if (
    weightedDelta <
    -DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame
  ) {
    return -DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame
  }

  return weightedDelta
}

const toFrameScale = (
  deltaMs: number,
  config: DragNeighborhoodInfluenceConfig,
) =>
  clamp(
    deltaMs / config.frameMs,
    0,
    config.maxDeltaMs / config.frameMs,
  )

export const createDragNeighborhoodInfluenceState = (
  projectionStore: GraphologyProjectionStore,
  draggedNodePubkey: string,
  dragNeighborhoodWeights: ReadonlyMap<string, number>,
  previousState: DragNeighborhoodInfluenceState | null = null,
): DragNeighborhoodInfluenceState => {
  const draggedNodePosition = projectionStore.getNodePosition(draggedNodePubkey)
  const nodes = new Map<string, DragNeighborhoodInfluenceNodeState>()

  if (!draggedNodePosition) {
    return { nodes }
  }

  for (const [pubkey, weight] of dragNeighborhoodWeights) {
    if (pubkey === draggedNodePubkey || weight <= 0) {
      continue
    }

    const position = projectionStore.getNodePosition(pubkey)

    if (!position) {
      continue
    }

    const previousNodeState = previousState?.nodes.get(pubkey)
    nodes.set(pubkey, {
      anchorOffsetX:
        previousNodeState?.anchorOffsetX ??
        position.x - draggedNodePosition.x,
      anchorOffsetY:
        previousNodeState?.anchorOffsetY ??
        position.y - draggedNodePosition.y,
      velocityX: previousNodeState?.velocityX ?? 0,
      velocityY: previousNodeState?.velocityY ?? 0,
      weight,
    })
  }

  return { nodes }
}

export const stepDragNeighborhoodInfluence = (
  projectionStore: GraphologyProjectionStore,
  draggedNodePubkey: string,
  influenceState: DragNeighborhoodInfluenceState,
  deltaMs: number,
  config: DragNeighborhoodInfluenceConfig = DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
): DragNeighborhoodInfluenceStepResult => {
  const draggedNodePosition = projectionStore.getNodePosition(draggedNodePubkey)

  if (!draggedNodePosition) {
    return {
      active: false,
      translated: false,
    }
  }

  const frameScale = toFrameScale(deltaMs, config)

  if (frameScale === 0) {
    return {
      active: false,
      translated: false,
    }
  }

  let active = false
  let translated = false

  for (const [pubkey, nodeState] of influenceState.nodes) {
    if (nodeState.weight <= 0 || projectionStore.isNodeFixed(pubkey)) {
      continue
    }

    const position = projectionStore.getNodePosition(pubkey)

    if (!position) {
      continue
    }

    const stiffness =
      config.baseStiffness +
      nodeState.weight * nodeState.weight * config.stiffnessByWeight
    const damping = clamp(
      config.baseDamping + nodeState.weight * config.dampingByWeight,
      0,
      0.96,
    )
    const weightScale = clamp(0.2 + nodeState.weight * 1.8, 0.3, 1)
    const targetX = draggedNodePosition.x + nodeState.anchorOffsetX
    const targetY = draggedNodePosition.y + nodeState.anchorOffsetY
    const residualX = targetX - position.x
    const residualY = targetY - position.y
    const nextVelocityX = clamp(
      (nodeState.velocityX + residualX * stiffness * frameScale) *
        Math.pow(damping, frameScale),
      -config.maxVelocityPerFrame * weightScale,
      config.maxVelocityPerFrame * weightScale,
    )
    const nextVelocityY = clamp(
      (nodeState.velocityY + residualY * stiffness * frameScale) *
        Math.pow(damping, frameScale),
      -config.maxVelocityPerFrame * weightScale,
      config.maxVelocityPerFrame * weightScale,
    )
    const translatedX = clamp(
      nextVelocityX * frameScale,
      -config.maxTranslationPerFrame * weightScale,
      config.maxTranslationPerFrame * weightScale,
    )
    const translatedY = clamp(
      nextVelocityY * frameScale,
      -config.maxTranslationPerFrame * weightScale,
      config.maxTranslationPerFrame * weightScale,
    )

    nodeState.velocityX = nextVelocityX
    nodeState.velocityY = nextVelocityY

    if (translatedX !== 0 || translatedY !== 0) {
      projectionStore.translateNodePosition(pubkey, translatedX, translatedY)
      translated = true
    }

    const nextResidualX = residualX - translatedX
    const nextResidualY = residualY - translatedY

    if (
      Math.hypot(nextResidualX, nextResidualY) > config.stopDistanceThreshold ||
      Math.hypot(nextVelocityX, nextVelocityY) > config.stopSpeedThreshold
    ) {
      active = true
    }
  }

  return {
    active,
    translated,
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
