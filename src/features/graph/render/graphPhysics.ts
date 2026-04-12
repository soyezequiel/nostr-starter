import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'

import type { BuildGraphRenderModelInput } from '@/features/graph/render/types'

export type GraphPhysicsNode = {
  id: string
  pubkey: string
  radius: number
  isRoot: boolean
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

export type GraphPhysicsLink = {
  id: string
  source: string | GraphPhysicsNode
  target: string | GraphPhysicsNode
  relation: 'follow' | 'inbound' | 'zap'
}

const GRAPH_PHYSICS_SETTINGS = {
  alphaDecay: 0.16,
  nBodyStrength: -280,
  nBodyTheta: 1.2,
  nBodyDistanceMax: 900,
  collisionPadding: 10,
  connectionsCollisionPadding: 16,
  centerGravityStrength: 0.028,
  ticks: 90,
  velocityDecay: 0.35,
  linkStrength: 0.28,
  sharedLinkStrengthLogFactor: 0.12,
  sharedLinkStrengthCap: 0.52,
  rootLinkDistance: 110,
  siblingLinkDistance: 56,
  connectionsLinkDistance: 92,
  sharedLinkDistanceReductionPerLog2: 10,
  sharedLinkDistanceReductionCap: 18,
} as const

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const createFastSeed = (
  rootNodePubkey: string | null,
  nodeCount: number,
  linkCount: number,
) => {
  let hash = 2166136261
  const key = rootNodePubkey ?? 'none'

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  hash ^= nodeCount
  hash = Math.imul(hash, 16777619)
  hash ^= linkCount
  hash = Math.imul(hash, 16777619)

  return hash >>> 0
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const resolveSharedLinkStrength = ({
  link,
  sharedByExpandedCount,
}: {
  link: GraphPhysicsLink
  sharedByExpandedCount: ReadonlyMap<string, number>
}) => {
  if (link.relation !== 'follow') {
    return GRAPH_PHYSICS_SETTINGS.linkStrength
  }

  const targetPubkey = (link.target as GraphPhysicsNode).pubkey
  const sharedCount = sharedByExpandedCount.get(targetPubkey) ?? 1

  if (sharedCount <= 1) {
    return GRAPH_PHYSICS_SETTINGS.linkStrength
  }

  return clampNumber(
    GRAPH_PHYSICS_SETTINGS.linkStrength +
      Math.log2(sharedCount) * GRAPH_PHYSICS_SETTINGS.sharedLinkStrengthLogFactor,
    GRAPH_PHYSICS_SETTINGS.linkStrength,
    GRAPH_PHYSICS_SETTINGS.sharedLinkStrengthCap,
  )
}

const resolveLinkDistance = ({
  link,
  rootNodePubkey,
  sharedByExpandedCount,
  renderConfig,
  activeLayer,
}: {
  link: GraphPhysicsLink
  rootNodePubkey: string | null
  sharedByExpandedCount: ReadonlyMap<string, number>
  renderConfig: BuildGraphRenderModelInput['renderConfig']
  activeLayer: BuildGraphRenderModelInput['activeLayer']
}) => {
  const sourceNode = link.source as GraphPhysicsNode
  const targetNode = link.target as GraphPhysicsNode
  const minimumDistance =
    sourceNode.radius +
    targetNode.radius +
    (activeLayer === 'connections' ? 32 : 20)
  const baseDistance =
    activeLayer === 'connections'
      ? GRAPH_PHYSICS_SETTINGS.connectionsLinkDistance
      : sourceNode.pubkey === rootNodePubkey || targetNode.pubkey === rootNodePubkey
        ? GRAPH_PHYSICS_SETTINGS.rootLinkDistance
        : GRAPH_PHYSICS_SETTINGS.siblingLinkDistance
  const resolvedBaseDistance = Math.max(
    baseDistance * renderConfig.nodeSpacingFactor,
    minimumDistance,
  )

  if (activeLayer === 'connections' || link.relation !== 'follow') {
    return resolvedBaseDistance
  }

  const sharedCount = sharedByExpandedCount.get(targetNode.pubkey) ?? 1
  if (sharedCount <= 1) {
    return resolvedBaseDistance
  }

  const reduction = Math.min(
    Math.log2(sharedCount) *
      GRAPH_PHYSICS_SETTINGS.sharedLinkDistanceReductionPerLog2,
    GRAPH_PHYSICS_SETTINGS.sharedLinkDistanceReductionCap,
  )

  return Math.max(resolvedBaseDistance - reduction, minimumDistance)
}

export const runGraphPhysicsLayout = ({
  nodes,
  links,
  rootNodePubkey,
  sharedByExpandedCount,
  renderConfig,
  activeLayer,
  ticks = GRAPH_PHYSICS_SETTINGS.ticks,
}: {
  nodes: GraphPhysicsNode[]
  links: GraphPhysicsLink[]
  rootNodePubkey: string | null
  sharedByExpandedCount: ReadonlyMap<string, number>
  renderConfig: BuildGraphRenderModelInput['renderConfig']
  activeLayer: BuildGraphRenderModelInput['activeLayer']
  ticks?: number
}) => {
  const simulation = forceSimulation(nodes)
    .randomSource(
      createSeededRandom(
        createFastSeed(rootNodePubkey, nodes.length, links.length),
      ),
    )
    .alpha(1)
    .alphaDecay(GRAPH_PHYSICS_SETTINGS.alphaDecay)
    .velocityDecay(GRAPH_PHYSICS_SETTINGS.velocityDecay)
    .force(
      'nBody',
      forceManyBody<GraphPhysicsNode>()
        .strength(GRAPH_PHYSICS_SETTINGS.nBodyStrength)
        .distanceMax(GRAPH_PHYSICS_SETTINGS.nBodyDistanceMax)
        .theta(GRAPH_PHYSICS_SETTINGS.nBodyTheta),
    )
    .force(
      'collision',
      forceCollide<GraphPhysicsNode>()
        .radius((node) =>
          node.radius +
          (activeLayer === 'connections'
            ? GRAPH_PHYSICS_SETTINGS.connectionsCollisionPadding
            : GRAPH_PHYSICS_SETTINGS.collisionPadding),
        )
        .strength(0.9)
        .iterations(2),
    )
    .force(
      'link',
      forceLink<GraphPhysicsNode, GraphPhysicsLink>(links)
        .id((node) => node.id)
        .distance((link: GraphPhysicsLink) =>
          resolveLinkDistance({
            link,
            rootNodePubkey,
            sharedByExpandedCount,
            renderConfig,
            activeLayer,
          }),
        )
        .strength((link: GraphPhysicsLink) =>
          resolveSharedLinkStrength({
            link,
            sharedByExpandedCount,
          }),
        ),
    )
    .force('center', forceCenter(0, 0))
    .force(
      'gravityX',
      forceX<GraphPhysicsNode>(0).strength(
        GRAPH_PHYSICS_SETTINGS.centerGravityStrength,
      ),
    )
    .force(
      'gravityY',
      forceY<GraphPhysicsNode>(0).strength(
        GRAPH_PHYSICS_SETTINGS.centerGravityStrength,
      ),
    )
    .stop()

  // Separate the physics loop from the render model assembly so layout tuning
  // stays isolated from the visual node/edge construction.
  const ALPHA_CONVERGENCE_THRESHOLD = 0.002
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.tick()
    if (simulation.alpha() < ALPHA_CONVERGENCE_THRESHOLD) break
  }

  simulation.stop()
}
