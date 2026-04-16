import type Graph from 'graphology-types'

import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export interface DragNeighborhoodInfluenceNodeState {
  initialX: number
  initialY: number
  velocityX: number
  velocityY: number
  hopDistance: number
  anchorStiffness: number
}

export interface DragNeighborhoodInfluenceEdgeState {
  sourcePubkey: string
  targetPubkey: string
  restLength: number
}

export interface DragNeighborhoodInfluenceState {
  readonly nodes: Map<string, DragNeighborhoodInfluenceNodeState>
  readonly edges: DragNeighborhoodInfluenceEdgeState[]
}

export interface DragNeighborhoodInfluenceStepResult {
  active: boolean
  translated: boolean
}

export interface DragNeighborhoodInfluenceConfig {
  frameMs: number
  maxDeltaMs: number
  edgeStiffness: number
  anchorStiffnessPerHop: number
  baseDamping: number
  maxVelocityPerFrame: number
  maxTranslationPerFrame: number
  stopSpeedThreshold: number
  stopDistanceThreshold: number
}

export const DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG: DragNeighborhoodInfluenceConfig = {
  frameMs: 16,
  maxDeltaMs: 32,
  // Spring stiffness for live graph edges. Propagates the drag through the
  // connected component in an elastic, Obsidian-like way.
  edgeStiffness: 0.05,
  // Per-hop anchor to the original position. Node at hop `h` is held by a
  // spring of strength `anchorStiffnessPerHop * h` toward its initial spot.
  // Close neighbors follow the drag freely; far nodes are progressively
  // anchored so influence decays continuously without a hop cutoff.
  anchorStiffnessPerHop: 0.008,
  baseDamping: 0.86,
  maxVelocityPerFrame: 10,
  maxTranslationPerFrame: 12,
  stopSpeedThreshold: 0.035,
  stopDistanceThreshold: 0.12,
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
  hopDistances: ReadonlyMap<string, number>,
  previousState: DragNeighborhoodInfluenceState | null = null,
): DragNeighborhoodInfluenceState => {
  const nodes = new Map<string, DragNeighborhoodInfluenceNodeState>()
  const edges: DragNeighborhoodInfluenceEdgeState[] = []
  const graph = projectionStore.getGraph()

  if (!graph.hasNode(draggedNodePubkey)) {
    return { nodes, edges }
  }

  const config = DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG

  for (const [pubkey, hopDistance] of hopDistances) {
    if (pubkey === draggedNodePubkey) {
      continue
    }

    const position = projectionStore.getNodePosition(pubkey)

    if (!position) {
      continue
    }

    const previousNodeState = previousState?.nodes.get(pubkey)
    nodes.set(pubkey, {
      initialX: previousNodeState?.initialX ?? position.x,
      initialY: previousNodeState?.initialY ?? position.y,
      velocityX: previousNodeState?.velocityX ?? 0,
      velocityY: previousNodeState?.velocityY ?? 0,
      hopDistance,
      anchorStiffness: config.anchorStiffnessPerHop * hopDistance,
    })
  }

  // Collect spring edges between the dragged node and its influence set.
  // Undirected: graphology exposes `forEachNeighbor` which covers both
  // incoming and outgoing neighbours, but edges are directed by id. We use
  // edge iteration to keep exactly one spring per pair.
  const includedPubkeys = new Set([draggedNodePubkey, ...nodes.keys()])
  const seenEdgeKeys = new Set<string>()

  const typedGraph = graph as Graph<SigmaNodeAttributes, SigmaEdgeAttributes>
  for (const pubkey of includedPubkeys) {
    typedGraph.forEachNeighbor(pubkey, (neighborPubkey) => {
      if (!includedPubkeys.has(neighborPubkey)) {
        return
      }

      const pairKey =
        pubkey < neighborPubkey
          ? `${pubkey}::${neighborPubkey}`
          : `${neighborPubkey}::${pubkey}`

      if (seenEdgeKeys.has(pairKey)) {
        return
      }

      seenEdgeKeys.add(pairKey)

      const sourcePosition = projectionStore.getNodePosition(pubkey)
      const targetPosition = projectionStore.getNodePosition(neighborPubkey)

      if (!sourcePosition || !targetPosition) {
        return
      }

      const restLength = Math.hypot(
        targetPosition.x - sourcePosition.x,
        targetPosition.y - sourcePosition.y,
      )

      edges.push({
        sourcePubkey: pubkey,
        targetPubkey: neighborPubkey,
        restLength,
      })
    })
  }

  return { nodes, edges }
}

interface ForceAccumulator {
  fx: number
  fy: number
}

const addForce = (
  forces: Map<string, ForceAccumulator>,
  pubkey: string,
  fx: number,
  fy: number,
) => {
  const existing = forces.get(pubkey)
  if (existing) {
    existing.fx += fx
    existing.fy += fy
    return
  }
  forces.set(pubkey, { fx, fy })
}

export const stepDragNeighborhoodInfluence = (
  projectionStore: GraphologyProjectionStore,
  draggedNodePubkey: string,
  influenceState: DragNeighborhoodInfluenceState,
  deltaMs: number,
  config: DragNeighborhoodInfluenceConfig = DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
): DragNeighborhoodInfluenceStepResult => {
  if (!projectionStore.getNodePosition(draggedNodePubkey)) {
    return { active: false, translated: false }
  }

  const frameScale = toFrameScale(deltaMs, config)

  if (frameScale === 0) {
    return { active: false, translated: false }
  }

  const forces = new Map<string, ForceAccumulator>()

  // Spring forces from live graph edges.
  for (const edge of influenceState.edges) {
    const sourcePosition = projectionStore.getNodePosition(edge.sourcePubkey)
    const targetPosition = projectionStore.getNodePosition(edge.targetPubkey)

    if (!sourcePosition || !targetPosition) {
      continue
    }

    const dx = targetPosition.x - sourcePosition.x
    const dy = targetPosition.y - sourcePosition.y
    const distance = Math.hypot(dx, dy)

    if (distance === 0) {
      continue
    }

    const displacement = distance - edge.restLength
    const magnitude = config.edgeStiffness * displacement
    const ux = dx / distance
    const uy = dy / distance

    // Force pulls source toward target when stretched, pushes apart when
    // compressed. Equal-and-opposite pairs.
    addForce(forces, edge.sourcePubkey, magnitude * ux, magnitude * uy)
    addForce(forces, edge.targetPubkey, -magnitude * ux, -magnitude * uy)
  }

  let active = false
  let translated = false

  for (const [pubkey, nodeState] of influenceState.nodes) {
    if (projectionStore.isNodeFixed(pubkey)) {
      continue
    }

    const position = projectionStore.getNodePosition(pubkey)

    if (!position) {
      continue
    }

    const edgeForce = forces.get(pubkey) ?? { fx: 0, fy: 0 }
    const anchorForceX =
      nodeState.anchorStiffness * (nodeState.initialX - position.x)
    const anchorForceY =
      nodeState.anchorStiffness * (nodeState.initialY - position.y)
    const totalForceX = edgeForce.fx + anchorForceX
    const totalForceY = edgeForce.fy + anchorForceY

    const nextVelocityX = clamp(
      (nodeState.velocityX + totalForceX * frameScale) *
        Math.pow(config.baseDamping, frameScale),
      -config.maxVelocityPerFrame,
      config.maxVelocityPerFrame,
    )
    const nextVelocityY = clamp(
      (nodeState.velocityY + totalForceY * frameScale) *
        Math.pow(config.baseDamping, frameScale),
      -config.maxVelocityPerFrame,
      config.maxVelocityPerFrame,
    )
    const translatedX = clamp(
      nextVelocityX * frameScale,
      -config.maxTranslationPerFrame,
      config.maxTranslationPerFrame,
    )
    const translatedY = clamp(
      nextVelocityY * frameScale,
      -config.maxTranslationPerFrame,
      config.maxTranslationPerFrame,
    )

    nodeState.velocityX = nextVelocityX
    nodeState.velocityY = nextVelocityY

    if (translatedX !== 0 || translatedY !== 0) {
      projectionStore.translateNodePosition(pubkey, translatedX, translatedY)
      translated = true
    }

    const speed = Math.hypot(nextVelocityX, nextVelocityY)
    const residualFromAnchor = Math.hypot(
      position.x + translatedX - nodeState.initialX,
      position.y + translatedY - nodeState.initialY,
    )

    if (
      speed > config.stopSpeedThreshold ||
      residualFromAnchor > config.stopDistanceThreshold
    ) {
      active = true
    }
  }

  return { active, translated }
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
