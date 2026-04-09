import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force'

import type { DiscoveredGraphAnalysisState } from '@/features/graph/analysis/types'
import type { GraphLink, GraphNode, ZapLayerEdge } from '@/features/graph/app/store/types'

import {
  FOLLOW_NODE_RADIUS,
  GRAPH_EDGE_BUDGET,
  GRAPH_LABEL_NODE_BUDGET,
  ROOT_NODE_COLOR,
  ROOT_NODE_RADIUS,
  ZAP_NODE_COLOR,
  ZAP_NODE_RADIUS,
} from '@/features/graph/render/constants'
import { isSafeAvatarUrl } from '@/features/graph/render/avatar'
import { getNodeDisplayLabel } from '@/features/graph/render/labels'
import type {
  AccessibleNodeSummary,
  BuildGraphRenderModelInput,
  GraphBounds,
  GraphRenderEdge,
  GraphRenderLabel,
  GraphRenderModel,
  GraphRenderNode,
} from '@/features/graph/render/types'

type ForceLayoutNode = {
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

type ForceLayoutLink = {
  id: string
  source: string | ForceLayoutNode
  target: string | ForceLayoutNode
  relation: GraphLink['relation'] | ZapLayerEdge['relation']
}

type NodeRadiusContext = {
  activeLayer: BuildGraphRenderModelInput['activeLayer']
  visibleNodeCount: number
  averageVisibleDegree: number
  maxVisibleDegree: number
  maxKeywordHits: number
}

const GRAPH_FORCE_SETTINGS = {
  alphaDecay: 0.04,
  chargeStrength: -220,
  chargeTheta: 1.2,
  chargeDistanceMax: 800,
  collisionPadding: 10,
  ticks: 90,
  velocityDecay: 0.35,
  linkStrength: 0.28,
  sharedLinkStrengthLogFactor: 0.12,
  sharedLinkStrengthCap: 0.52,
  rootLinkDistance: 110,
  siblingLinkDistance: 56,
  sharedLinkDistanceReductionPerLog2: 10,
  sharedLinkDistanceReductionCap: 18,
} as const

const GRAPH_RADIUS_SETTINGS = {
  avatarBoost: 2.4,
  averageDegreePenalty: 0.035,
  contextScaleMax: 1.14,
  contextScaleMin: 0.76,
  densityLogFactor: 0.28,
  followMaxRadius: 22,
  followMinRadius: 8,
  keywordBoostCap: 5.2,
  degreeBoostCap: 4.1,
  sharedBoostCap: 3.8,
  sharedBoostFactor: 1.8,
  rootMaxRadius: 34,
  rootMinRadius: ROOT_NODE_RADIUS,
  rootSparseBoostFactor: 12,
  zapMaxRadius: 24,
  zapMinRadius: 9,
} as const

const COMMUNITY_PALETTE = [
  [74, 222, 128, 236],
  [56, 189, 248, 236],
  [251, 191, 36, 236],
  [244, 114, 182, 236],
  [129, 140, 248, 236],
  [45, 212, 191, 236],
  [248, 113, 113, 236],
  [163, 230, 53, 236],
] as const

const COMMUNITY_NEUTRAL_COLOR = [100, 116, 139, 214] as const
const COMMUNITY_MUTED_COLOR = [94, 106, 124, 188] as const
const COMMUNITY_STROKE_COLOR = [226, 232, 240, 118] as const
const ROOT_STROKE_COLOR = [255, 224, 178, 220] as const
const EMPTY_GRAPH_ANALYSIS: DiscoveredGraphAnalysisState = {
  status: 'idle',
  isStale: false,
  analysisKey: null,
  message: null,
  result: null,
}

const blendChannel = (left: number, right: number, ratio: number) =>
  Math.round(left * (1 - ratio) + right * ratio)

const blendColor = (
  source: readonly [number, number, number, number],
  target: readonly [number, number, number, number],
  ratio: number,
): [number, number, number, number] => [
  blendChannel(source[0], target[0], ratio),
  blendChannel(source[1], target[1], ratio),
  blendChannel(source[2], target[2], ratio),
  blendChannel(source[3], target[3], ratio),
]

const createLinkId = (
  source: string,
  target: string,
  relation: GraphLink['relation'] | ZapLayerEdge['relation'],
) => `${source}->${target}:${relation}`

const compareNodes = (
  left: GraphNode,
  right: GraphNode,
  rootNodePubkey: string | null,
) => {
  const leftRank =
    left.pubkey === rootNodePubkey
      ? -1
      : (left.discoveredAt ?? Number.MAX_SAFE_INTEGER)
  const rightRank =
    right.pubkey === rootNodePubkey
      ? -1
      : (right.discoveredAt ?? Number.MAX_SAFE_INTEGER)

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  return left.pubkey.localeCompare(right.pubkey)
}

const compareEdges = (left: GraphRenderEdge, right: GraphRenderEdge) =>
  left.id.localeCompare(right.id)

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const getInitialNodePosition = (index: number) => {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const radius = 56 + Math.sqrt(index + 1) * 24
  const angle = index * goldenAngle

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

const buildVisibleDegreeByPubkey = ({
  renderedLinks,
  visiblePubkeys,
}: {
  renderedLinks: readonly (GraphLink | ZapLayerEdge)[]
  visiblePubkeys: ReadonlySet<string>
}) => {
  const degreeByPubkey = new Map<string, number>()

  for (const pubkey of visiblePubkeys) {
    degreeByPubkey.set(pubkey, 0)
  }

  for (const link of renderedLinks) {
    if (!visiblePubkeys.has(link.source) || !visiblePubkeys.has(link.target)) {
      continue
    }

    degreeByPubkey.set(link.source, (degreeByPubkey.get(link.source) ?? 0) + 1)
    degreeByPubkey.set(link.target, (degreeByPubkey.get(link.target) ?? 0) + 1)
  }

  return degreeByPubkey
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const roundRadius = (value: number) => Math.round(value * 10) / 10

const getContextScale = ({
  visibleNodeCount,
  averageVisibleDegree,
}: Pick<NodeRadiusContext, 'visibleNodeCount' | 'averageVisibleDegree'>) =>
  clampNumber(
    1.22 -
      Math.log10(visibleNodeCount + 1) *
        GRAPH_RADIUS_SETTINGS.densityLogFactor -
      Math.max(0, averageVisibleDegree - 2) *
        GRAPH_RADIUS_SETTINGS.averageDegreePenalty,
    GRAPH_RADIUS_SETTINGS.contextScaleMin,
    GRAPH_RADIUS_SETTINGS.contextScaleMax,
  )

const getDegreeBoost = ({
  visibleDegree,
  maxVisibleDegree,
}: {
  visibleDegree: number
  maxVisibleDegree: number
}) => {
  if (visibleDegree <= 0) {
    return 0
  }

  const absoluteBoost = Math.log2(visibleDegree + 1) * 0.95
  const relativeBoost =
    maxVisibleDegree > 1 ? (visibleDegree / maxVisibleDegree) * 1.35 : 0

  return Math.min(
    GRAPH_RADIUS_SETTINGS.degreeBoostCap,
    absoluteBoost + relativeBoost,
  )
}

const getKeywordBoost = ({
  keywordHits,
  maxKeywordHits,
  activeLayer,
}: Pick<NodeRadiusContext, 'activeLayer' | 'maxKeywordHits'> & {
  keywordHits: number
}) => {
  if (activeLayer !== 'keywords' || keywordHits <= 0) {
    return 0
  }

  const absoluteBoost = Math.log2(keywordHits + 1) * 1.05
  const relativeBoost =
    maxKeywordHits > 1 ? (keywordHits / maxKeywordHits) * 1.9 : 1.15

  return Math.min(
    GRAPH_RADIUS_SETTINGS.keywordBoostCap,
    absoluteBoost + relativeBoost,
  )
}

const getSharedExpandedBoost = (sharedByExpandedCount: number) => {
  if (sharedByExpandedCount < 2) {
    return 0
  }

  return Math.min(
    GRAPH_RADIUS_SETTINGS.sharedBoostCap,
    Math.log2(sharedByExpandedCount) * GRAPH_RADIUS_SETTINGS.sharedBoostFactor,
  )
}

const getNodeRadius = (
  node: GraphNode,
  isRoot: boolean,
  visibleDegree: number,
  sharedByExpandedCount: number,
  context: NodeRadiusContext,
) => {
  const contextScale = getContextScale(context)

  if (isRoot) {
    const sparseBoost =
      Math.max(0, contextScale - 1) *
      GRAPH_RADIUS_SETTINGS.rootSparseBoostFactor

    return roundRadius(
      clampNumber(
        ROOT_NODE_RADIUS + sparseBoost,
        GRAPH_RADIUS_SETTINGS.rootMinRadius,
        GRAPH_RADIUS_SETTINGS.rootMaxRadius,
      ),
    )
  }

  const baseRadius =
    node.source === 'zap' ? ZAP_NODE_RADIUS : FOLLOW_NODE_RADIUS
  const degreeBoost = getDegreeBoost({
    visibleDegree,
    maxVisibleDegree: context.maxVisibleDegree,
  })
  const keywordBoost = getKeywordBoost({
    keywordHits: node.keywordHits,
    maxKeywordHits: context.maxKeywordHits,
    activeLayer: context.activeLayer,
  })
  const avatarBoost = isSafeAvatarUrl(node.picture)
    ? GRAPH_RADIUS_SETTINGS.avatarBoost
    : 0
  const sharedBoost = getSharedExpandedBoost(sharedByExpandedCount)
  const minRadius =
    node.source === 'zap'
      ? GRAPH_RADIUS_SETTINGS.zapMinRadius
      : GRAPH_RADIUS_SETTINGS.followMinRadius
  const maxRadius =
    node.source === 'zap'
      ? GRAPH_RADIUS_SETTINGS.zapMaxRadius
      : GRAPH_RADIUS_SETTINGS.followMaxRadius

  return roundRadius(
    clampNumber(
      baseRadius * contextScale +
        degreeBoost +
        keywordBoost +
        avatarBoost +
        sharedBoost,
      minRadius,
      maxRadius,
    ),
  )
}

const buildSharedByExpandedCount = ({
  links,
  expandedNodePubkeys,
}: Pick<BuildGraphRenderModelInput, 'expandedNodePubkeys' | 'links'>) => {
  const sharedSourcesByTarget = new Map<string, Set<string>>()

  for (const link of links) {
    if (
      link.relation !== 'follow' ||
      !expandedNodePubkeys.has(link.source) ||
      link.source === link.target
    ) {
      continue
    }

    const currentSources = sharedSourcesByTarget.get(link.target)

    if (currentSources) {
      currentSources.add(link.source)
      continue
    }

    sharedSourcesByTarget.set(link.target, new Set([link.source]))
  }

  return new Map(
    Array.from(sharedSourcesByTarget.entries()).map(([target, sources]) => [
      target,
      sources.size,
    ]),
  )
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

const resolveSharedLinkStrength = ({
  link,
  sharedByExpandedCount,
}: {
  link: ForceLayoutLink
  sharedByExpandedCount: ReadonlyMap<string, number>
}) => {
  if (link.relation !== 'follow') {
    return GRAPH_FORCE_SETTINGS.linkStrength
  }

  const targetPubkey = (link.target as ForceLayoutNode).pubkey
  const sharedCount = sharedByExpandedCount.get(targetPubkey) ?? 1

  if (sharedCount <= 1) {
    return GRAPH_FORCE_SETTINGS.linkStrength
  }

  return clampNumber(
    GRAPH_FORCE_SETTINGS.linkStrength +
      Math.log2(sharedCount) * GRAPH_FORCE_SETTINGS.sharedLinkStrengthLogFactor,
    GRAPH_FORCE_SETTINGS.linkStrength,
    GRAPH_FORCE_SETTINGS.sharedLinkStrengthCap,
  )
}

const resolveLinkDistance = ({
  link,
  rootNodePubkey,
  sharedByExpandedCount,
  renderConfig,
}: {
  link: ForceLayoutLink
  rootNodePubkey: string | null
  sharedByExpandedCount: ReadonlyMap<string, number>
  renderConfig: BuildGraphRenderModelInput['renderConfig']
}) => {
  const sourceNode = link.source as ForceLayoutNode
  const targetNode = link.target as ForceLayoutNode
  const minimumDistance = sourceNode.radius + targetNode.radius + 20
  const baseDistance =
    sourceNode.pubkey === rootNodePubkey || targetNode.pubkey === rootNodePubkey
      ? GRAPH_FORCE_SETTINGS.rootLinkDistance
      : GRAPH_FORCE_SETTINGS.siblingLinkDistance
  const resolvedBaseDistance = Math.max(
    baseDistance * renderConfig.nodeSpacingFactor,
    minimumDistance,
  )

  if (link.relation !== 'follow') {
    return resolvedBaseDistance
  }

  const sharedCount = sharedByExpandedCount.get(targetNode.pubkey) ?? 1
  if (sharedCount <= 1) {
    return resolvedBaseDistance
  }

  const reduction = Math.min(
    Math.log2(sharedCount) *
      GRAPH_FORCE_SETTINGS.sharedLinkDistanceReductionPerLog2,
    GRAPH_FORCE_SETTINGS.sharedLinkDistanceReductionCap,
  )

  return Math.max(resolvedBaseDistance - reduction, minimumDistance)
}

const runLayoutSimulation = ({
  nodes,
  links,
  rootNodePubkey,
  sharedByExpandedCount,
  renderConfig,
  ticks = GRAPH_FORCE_SETTINGS.ticks,
}: {
  nodes: ForceLayoutNode[]
  links: ForceLayoutLink[]
  rootNodePubkey: string | null
  sharedByExpandedCount: ReadonlyMap<string, number>
  renderConfig: BuildGraphRenderModelInput['renderConfig']
  ticks?: number
}) => {
  const simulation = forceSimulation(nodes)
    .randomSource(
      createSeededRandom(
        createFastSeed(rootNodePubkey, nodes.length, links.length),
      ),
    )
    .alpha(1)
    .alphaDecay(GRAPH_FORCE_SETTINGS.alphaDecay)
    .velocityDecay(GRAPH_FORCE_SETTINGS.velocityDecay)
    .force(
      'charge',
      forceManyBody<ForceLayoutNode>()
        .strength(GRAPH_FORCE_SETTINGS.chargeStrength)
        .distanceMax(GRAPH_FORCE_SETTINGS.chargeDistanceMax)
        .theta(GRAPH_FORCE_SETTINGS.chargeTheta),
    )
    .force(
      'collision',
      forceCollide<ForceLayoutNode>()
        .radius((node) => node.radius + GRAPH_FORCE_SETTINGS.collisionPadding)
        .strength(0.9)
        .iterations(2),
    )
    .force(
      'link',
      forceLink<ForceLayoutNode, ForceLayoutLink>(links)
        .id((node) => node.id)
        .distance((link: ForceLayoutLink) =>
          resolveLinkDistance({
            link,
            rootNodePubkey,
            sharedByExpandedCount,
            renderConfig,
          }),
        )
        .strength((link: ForceLayoutLink) =>
          resolveSharedLinkStrength({
            link,
            sharedByExpandedCount,
          }),
        ),
    )
    .stop()

  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.tick()
  }

  simulation.stop()
}

const thinCandidateEdges = ({
  candidateEdges,
  rootNodePubkey,
  selectedNodePubkey,
}: {
  candidateEdges: GraphRenderEdge[]
  rootNodePubkey: string | null
  selectedNodePubkey: string | null
}) => {
  const prioritizedEdges = candidateEdges.filter(
    (edge) =>
      edge.source === rootNodePubkey ||
      edge.target === rootNodePubkey ||
      edge.source === selectedNodePubkey ||
      edge.target === selectedNodePubkey,
  )
  const nonPriorityEdges = candidateEdges.filter((edge) => !edge.isPriority)

  if (nonPriorityEdges.length === 0) {
    return {
      edges: prioritizedEdges.sort(compareEdges),
      edgesThinned: false,
      thinnedEdgeCount: 0,
    }
  }

  const remainingBudget = Math.max(
    0,
    GRAPH_EDGE_BUDGET - prioritizedEdges.length,
  )
  if (nonPriorityEdges.length <= remainingBudget) {
    return {
      edges: [...prioritizedEdges, ...nonPriorityEdges].sort(compareEdges),
      edgesThinned: false,
      thinnedEdgeCount: 0,
    }
  }

  if (remainingBudget === 0) {
    return {
      edges: prioritizedEdges.sort(compareEdges),
      edgesThinned: true,
      thinnedEdgeCount: nonPriorityEdges.length,
    }
  }

  const sortedNonPriorityEdges = nonPriorityEdges.sort(compareEdges)
  const stride = Math.ceil(sortedNonPriorityEdges.length / remainingBudget)
  const keptNonPriorityEdges = sortedNonPriorityEdges
    .filter((_, index) => index % stride === 0)
    .slice(0, remainingBudget)

  return {
    edges: [...prioritizedEdges, ...keptNonPriorityEdges].sort(compareEdges),
    edgesThinned: true,
    thinnedEdgeCount:
      sortedNonPriorityEdges.length - keptNonPriorityEdges.length,
  }
}

const resolveGraphBounds = (nodes: readonly GraphRenderNode[]): GraphBounds => {
  if (nodes.length === 0) {
    return {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    const [x, y] = node.position
    minX = Math.min(minX, x - node.radius)
    maxX = Math.max(maxX, x + node.radius)
    minY = Math.min(minY, y - node.radius)
    maxY = Math.max(maxY, y + node.radius)
  }

  return { minX, maxX, minY, maxY }
}

const createTopologySignature = (
  nodes: readonly GraphRenderNode[],
  edges: readonly GraphRenderEdge[],
  activeLayer: BuildGraphRenderModelInput['activeLayer'],
) => {
  let hash = 2166136261

  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }

  feed(activeLayer)

  for (const node of nodes) {
    feed(node.id)
  }

  hash ^= 0xff
  hash = Math.imul(hash, 16777619)

  for (const edge of edges) {
    feed(edge.id)
  }

  return `${activeLayer}:${nodes.length}n:${edges.length}e:${(hash >>> 0).toString(36)}`
}

const buildLayoutKey = (
  visiblePubkeys: ReadonlySet<string>,
  renderedLinks: readonly (GraphLink | ZapLayerEdge)[],
  activeLayer: BuildGraphRenderModelInput['activeLayer'],
  sharedByExpandedCount: ReadonlyMap<string, number>,
  comparedNodePubkeys: ReadonlySet<string>,
  nodeSpacingFactor: number,
) => {
  let hash = 2166136261

  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }

  feed(activeLayer)
  feed(nodeSpacingFactor.toString())

  // Sorted so order doesn't matter
  const sortedPubkeys = Array.from(visiblePubkeys).sort()
  for (const pubkey of sortedPubkeys) {
    feed(pubkey)
  }

  hash ^= renderedLinks.length
  hash = Math.imul(hash, 16777619)

  const sortedSharedEntries = Array.from(sharedByExpandedCount.entries())
    .filter(([, count]) => count > 1)
    .sort(([leftPubkey], [rightPubkey]) =>
      leftPubkey.localeCompare(rightPubkey),
    )
  for (const [pubkey, count] of sortedSharedEntries) {
    feed(pubkey)
    hash ^= count
    hash = Math.imul(hash, 16777619)
  }

  const sortedCompared = Array.from(comparedNodePubkeys).sort()
  for (const pubkey of sortedCompared) {
    feed(pubkey)
  }

  return `${activeLayer}:${visiblePubkeys.size}n:${renderedLinks.length}e:${(hash >>> 0).toString(36)}`
}

const buildCommunityColorMap = (
  graphAnalysis: DiscoveredGraphAnalysisState,
) => {
  if (!graphAnalysis.result) {
    return new Map<string, [number, number, number, number]>()
  }

  const sortedCommunities = graphAnalysis.result.communities
    .filter((community) => community.size >= 3)
    .sort((left, right) => left.id.localeCompare(right.id))

  return new Map(
    sortedCommunities.map((community, index) => [
      community.id,
      [...COMMUNITY_PALETTE[index % COMMUNITY_PALETTE.length]] as [
        number,
        number,
        number,
        number,
      ],
    ]),
  )
}

const createAnalysisOverlay = ({
  graphAnalysis,
  communityColorMap,
}: {
  graphAnalysis: DiscoveredGraphAnalysisState
  communityColorMap: ReadonlyMap<string, [number, number, number, number]>
}) => {
  if (!graphAnalysis.result) {
    return {
      status: graphAnalysis.status,
      isStale: graphAnalysis.isStale,
      mode: null,
      confidence: null,
      badgeLabel:
        graphAnalysis.status === 'loading'
          ? 'Analizando'
          : graphAnalysis.status === 'error'
            ? 'Sin analisis'
            : null,
      summary: graphAnalysis.message,
      detail: null,
      legendItems: [],
    }
  }

  const highlightedCommunities = graphAnalysis.result.communities
    .filter((community) => community.size >= 3)
    .sort((left, right) =>
      right.size === left.size
        ? left.id.localeCompare(right.id)
        : right.size - left.size,
    )
    .slice(0, 4)
    .map((community) => ({
      id: community.id,
      label: `Grupo ${community.id.slice(0, 6)}`,
      nodeCount: community.size,
      color:
        communityColorMap.get(community.id) ??
        ([...COMMUNITY_NEUTRAL_COLOR] as [number, number, number, number]),
      isNeutral: false,
    }))
  const smallGroupNodeCount = graphAnalysis.result.communities
    .filter((community) => community.size < 3)
    .reduce((sum, community) => sum + community.size, 0)

  const legendItems =
    smallGroupNodeCount > 0
      ? [
          ...highlightedCommunities,
          {
            id: 'small-discovered-group',
            label: 'Grupo pequeno',
            nodeCount: smallGroupNodeCount,
            color: [...COMMUNITY_NEUTRAL_COLOR] as [
              number,
              number,
              number,
              number,
            ],
            isNeutral: true,
          },
        ]
      : highlightedCommunities

  return {
    status: graphAnalysis.status,
    isStale: graphAnalysis.isStale,
    mode: graphAnalysis.result.mode,
    confidence: graphAnalysis.result.confidence,
    badgeLabel:
      graphAnalysis.result.mode === 'heuristic'
        ? 'Agrupacion tentativa'
        : graphAnalysis.result.confidence === 'high'
          ? 'Buena confianza'
          : graphAnalysis.result.confidence === 'medium'
            ? 'Confianza media'
            : 'Baja confianza',
    summary: graphAnalysis.message,
    detail: 'Tamano de nodo = liderazgo descubierto.',
    legendItems,
  }
}

const buildCommunitySeedPositions = ({
  orderedNodes,
  rootNodePubkey,
  graphAnalysis,
}: {
  orderedNodes: readonly GraphNode[]
  rootNodePubkey: string | null
  graphAnalysis: DiscoveredGraphAnalysisState
}) => {
  const positions = new Map<string, { x: number; y: number }>()
  const analysisByPubkey = graphAnalysis.result?.nodeAnalysis ?? {}
  const membersByCommunity = new Map<string, string[]>()

  for (const node of orderedNodes) {
    if (node.pubkey === rootNodePubkey) {
      continue
    }

    const nodeAnalysis = analysisByPubkey[node.pubkey]
    if (
      !nodeAnalysis ||
      nodeAnalysis.useNeutralFill ||
      !nodeAnalysis.communityId ||
      nodeAnalysis.communitySize < 3
    ) {
      continue
    }

    const members = membersByCommunity.get(nodeAnalysis.communityId) ?? []
    members.push(node.pubkey)
    membersByCommunity.set(nodeAnalysis.communityId, members)
  }

  const communityIds = [...membersByCommunity.keys()].sort()
  if (communityIds.length === 0) {
    return positions
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const centerRadius = 152 + communityIds.length * 8

  for (const [communityIndex, communityId] of communityIds.entries()) {
    const memberPubkeys = membersByCommunity.get(communityId) ?? []
    const centerAngle =
      communityIds.length === 1
        ? Math.PI / 2
        : (communityIndex / communityIds.length) * Math.PI * 2
    const centerX = Math.cos(centerAngle) * centerRadius
    const centerY = Math.sin(centerAngle) * centerRadius

    memberPubkeys.forEach((pubkey, memberIndex) => {
      const localRadius = 28 + Math.sqrt(memberIndex + 1) * 18
      const localAngle = memberIndex * goldenAngle
      positions.set(pubkey, {
        x: centerX + Math.cos(localAngle) * localRadius,
        y: centerY + Math.sin(localAngle) * localRadius,
      })
    })
  }

  return positions
}

const resolveNodeVisuals = ({
  node,
  rootNodePubkey,
  graphAnalysis,
  communityColorMap,
}: {
  node: GraphNode
  rootNodePubkey: string | null
  graphAnalysis: DiscoveredGraphAnalysisState
  communityColorMap: ReadonlyMap<string, [number, number, number, number]>
}) => {
  if (node.pubkey === rootNodePubkey) {
    return {
      fillColor: [...ROOT_NODE_COLOR] as [number, number, number, number],
      lineColor: [...ROOT_STROKE_COLOR] as [number, number, number, number],
      bridgeHaloColor: null,
      analysisCommunityId: null,
    }
  }

  const nodeAnalysis = graphAnalysis.result?.nodeAnalysis[node.pubkey]
  const baseColor =
    node.source === 'zap'
      ? ([...blendColor(ZAP_NODE_COLOR, COMMUNITY_NEUTRAL_COLOR, 0.45)] as [
          number,
          number,
          number,
          number,
        ])
      : nodeAnalysis?.communityId && communityColorMap.has(nodeAnalysis.communityId)
        ? ([
            ...communityColorMap.get(nodeAnalysis.communityId)!,
          ] as [number, number, number, number])
        : ([...COMMUNITY_NEUTRAL_COLOR] as [number, number, number, number])
  const fillColor =
    nodeAnalysis?.useNeutralFill === true
      ? blendColor(baseColor, COMMUNITY_MUTED_COLOR, 0.42)
      : baseColor

  return {
    fillColor,
    lineColor: [...COMMUNITY_STROKE_COLOR] as [number, number, number, number],
    bridgeHaloColor: null,
    analysisCommunityId: nodeAnalysis?.communityId ?? null,
  }
}

export const buildGraphRenderModel = ({
  nodes,
  links,
  zapEdges,
  activeLayer,
  rootNodePubkey,
  selectedNodePubkey,
  expandedNodePubkeys,
  comparedNodePubkeys = new Set<string>(),
  graphAnalysis = EMPTY_GRAPH_ANALYSIS,
  renderConfig,
  previousPositions,
  previousLayoutKey,
}: BuildGraphRenderModelInput): GraphRenderModel => {
  const renderedLinks =
    activeLayer === 'zaps' ? [...links, ...zapEdges] : [...links]
  const visiblePubkeys = new Set<string>()

  if (rootNodePubkey) {
    visiblePubkeys.add(rootNodePubkey)
  }

  if (selectedNodePubkey) {
    visiblePubkeys.add(selectedNodePubkey)
  }

  for (const pubkey of expandedNodePubkeys) {
    visiblePubkeys.add(pubkey)
  }

  for (const link of renderedLinks) {
    visiblePubkeys.add(link.source)
    visiblePubkeys.add(link.target)
  }

  const orderedNodes = Object.values(nodes)
    .filter((node) => visiblePubkeys.has(node.pubkey))
    .sort((left, right) => compareNodes(left, right, rootNodePubkey))
  const communityColorMap = buildCommunityColorMap(graphAnalysis)
  const analysisOverlay = createAnalysisOverlay({
    graphAnalysis,
    communityColorMap,
  })
  const visibleDegreeByPubkey = buildVisibleDegreeByPubkey({
    renderedLinks,
    visiblePubkeys,
  })
  const degreeValues = Array.from(visibleDegreeByPubkey.values())
  const sharedByExpandedCount = buildSharedByExpandedCount({
    links,
    expandedNodePubkeys,
  })
  const averageVisibleDegree =
    degreeValues.length > 0
      ? degreeValues.reduce((sum, degree) => sum + degree, 0) /
        degreeValues.length
      : 0
  const nodeRadiusContext: NodeRadiusContext = {
    activeLayer,
    visibleNodeCount: orderedNodes.length,
    averageVisibleDegree,
    maxVisibleDegree: degreeValues.reduce(
      (maxDegree, degree) => Math.max(maxDegree, degree),
      0,
    ),
    maxKeywordHits:
      activeLayer === 'keywords'
        ? orderedNodes.reduce(
            (maxHits, node) => Math.max(maxHits, node.keywordHits),
            0,
          )
        : 0,
  }

  const layoutKey = buildLayoutKey(
    visiblePubkeys,
    renderedLinks,
    activeLayer,
    sharedByExpandedCount,
    comparedNodePubkeys,
    renderConfig.nodeSpacingFactor,
  )
  const topologyUnchanged =
    previousLayoutKey === layoutKey &&
    previousPositions !== undefined &&
    previousPositions.size > 0

  const layoutNodes: ForceLayoutNode[] = []
  let nonRootIndex = 0
  let warmStartedCount = 0
  const communitySeedPositions = buildCommunitySeedPositions({
    orderedNodes,
    rootNodePubkey,
    graphAnalysis,
  })

  for (const node of orderedNodes) {
    const isRoot = node.pubkey === rootNodePubkey
    const baseRadius = getNodeRadius(
      node,
      isRoot,
      visibleDegreeByPubkey.get(node.pubkey) ?? 0,
      sharedByExpandedCount.get(node.pubkey) ?? 0,
      nodeRadiusContext,
    )
    const analysisNode = graphAnalysis.result?.nodeAnalysis[node.pubkey]
    const analysisRadiusMultiplier = isRoot
      ? 1
      : 1 +
        Math.min(
          0.55,
          (analysisNode?.leaderQuantile ?? 0) * 0.35,
        )
    const radius = roundRadius(baseRadius * analysisRadiusMultiplier)
    const previousPosition = previousPositions?.get(node.pubkey)
    const startPosition = isRoot
      ? { x: 0, y: 0 }
      : previousPosition
        ? { x: previousPosition[0], y: previousPosition[1] }
        : communitySeedPositions.get(node.pubkey) ??
          getInitialNodePosition(nonRootIndex)

    if (previousPosition && !isRoot) {
      warmStartedCount += 1
    }

    layoutNodes.push({
      id: node.pubkey,
      pubkey: node.pubkey,
      radius,
      isRoot,
      x: startPosition.x,
      y: startPosition.y,
      ...(isRoot
        ? {
            fx: 0,
            fy: 0,
          }
        : {}),
    })

    if (!isRoot) {
      nonRootIndex += 1
    }
  }

  const layoutNodeByPubkey = new Map(
    layoutNodes.map((node) => [node.pubkey, node]),
  )
  const layoutLinks: ForceLayoutLink[] = renderedLinks
    .filter(
      (link) =>
        layoutNodeByPubkey.has(link.source) &&
        layoutNodeByPubkey.has(link.target),
    )
    .map((link) => ({
      id: createLinkId(link.source, link.target, link.relation),
      source: link.source,
      target: link.target,
      relation: link.relation,
    }))

  if (layoutNodes.length > 0 && !topologyUnchanged) {
    const isWarmStart =
      warmStartedCount > 0 &&
      warmStartedCount >= Math.floor(layoutNodes.length * 0.5)

    runLayoutSimulation({
      nodes: layoutNodes,
      links: layoutLinks,
      rootNodePubkey,
      sharedByExpandedCount,
      renderConfig,
      ticks: isWarmStart ? 50 : GRAPH_FORCE_SETTINGS.ticks,
    })
  }

  const comparedArray = Array.from(comparedNodePubkeys)
  const commonFollowPubkeys = new Set<string>()

  if (comparedArray.length >= 2) {
    const followsBySource = new Map<string, Set<string>>()
    
    // Group follows by their expanded source
    for (const link of links) {
      if (link.relation === 'follow' && comparedNodePubkeys.has(link.source)) {
        const set = followsBySource.get(link.source) ?? new Set()
        set.add(link.target)
        followsBySource.set(link.source, set)
      }
    }

    // Intersection of all available sets (must have at least 2 to be a comparison)
    if (followsBySource.size >= 2) {
      const sets = Array.from(followsBySource.values())
      const firstSet = sets[0]
      
      for (const target of firstSet) {
        let isCommon = true
        for (let i = 1; i < sets.length; i++) {
          if (!sets[i].has(target)) {
            isCommon = false
            break
          }
        }
        if (isCommon) {
           commonFollowPubkeys.add(target)
        }
      }
    }
  }

  const renderNodes: GraphRenderNode[] = orderedNodes.map((node) => {
    const layoutNode = layoutNodeByPubkey.get(node.pubkey)
    const position = {
      x: layoutNode?.x ?? 0,
      y: layoutNode?.y ?? 0,
    }
    const nodeVisuals = resolveNodeVisuals({
      node,
      rootNodePubkey,
      graphAnalysis,
      communityColorMap,
    })

    return {
      id: node.pubkey,
      pubkey: node.pubkey,
      displayLabel: getNodeDisplayLabel(node),
      pictureUrl: isSafeAvatarUrl(node.picture) ? node.picture : null,
      position: [position.x, position.y],
      radius:
        layoutNode?.radius ??
        getNodeRadius(
          node,
          false,
          0,
          sharedByExpandedCount.get(node.pubkey) ?? 0,
          nodeRadiusContext,
        ),
      isRoot: node.pubkey === rootNodePubkey,
      isExpanded: expandedNodePubkeys.has(node.pubkey),
      isSelected: node.pubkey === selectedNodePubkey,
      isCommonFollow: commonFollowPubkeys.has(node.pubkey),
      source: node.source,
      discoveredAt: node.discoveredAt,
      sharedByExpandedCount: sharedByExpandedCount.get(node.pubkey) ?? 0,
      fillColor: nodeVisuals.fillColor,
      lineColor: nodeVisuals.lineColor,
      bridgeHaloColor: nodeVisuals.bridgeHaloColor,
      analysisCommunityId: nodeVisuals.analysisCommunityId,
    }
  })

  if (renderConfig.autoSizeNodes) {
    let globalMinWorldDist = Number.POSITIVE_INFINITY
    
    for (let i = 0; i < renderNodes.length; i++) {
      let minDist = Number.POSITIVE_INFINITY
      const posA = renderNodes[i].position
      
      for (let j = 0; j < renderNodes.length; j++) {
        if (i === j) continue
        const posB = renderNodes[j].position
        const dist = Math.hypot(posA[0] - posB[0], posA[1] - posB[1])
        if (dist < minDist) {
          minDist = dist
        }
      }
      
      renderNodes[i].nearestNeighborWorldDist = minDist
      if (minDist < globalMinWorldDist) {
        globalMinWorldDist = minDist
      }
    }

    // "diferencia entre uno y otro no sea mayor al 50%"
    // Clamp the allowed distance up to 50% larger than the absolute tightest gap globally
    const maxAllowedDist = Number.isFinite(globalMinWorldDist) ? globalMinWorldDist * 1.5 : Number.POSITIVE_INFINITY
    
    for (const node of renderNodes) {
      if (node.nearestNeighborWorldDist !== undefined) {
        node.nearestNeighborWorldDist = Math.min(node.nearestNeighborWorldDist, maxAllowedDist)
      }
    }
  }

  const nodeByPubkey = new Map(renderNodes.map((node) => [node.pubkey, node]))
  const candidateEdges = renderedLinks
    .filter(
      (link) => nodeByPubkey.has(link.source) && nodeByPubkey.has(link.target),
    )
    .map((link) => {
      const sourceNode = nodeByPubkey.get(link.source)!
      const targetNode = nodeByPubkey.get(link.target)!
      const isPriority =
        sourceNode.pubkey === rootNodePubkey ||
        targetNode.pubkey === rootNodePubkey ||
        sourceNode.pubkey === selectedNodePubkey ||
        targetNode.pubkey === selectedNodePubkey

      return {
        id: createLinkId(link.source, link.target, link.relation),
        source: link.source,
        target: link.target,
        relation: link.relation,
        weight: link.relation === 'zap' ? (link.weight ?? 0) : 0,
        sourcePosition: sourceNode.position,
        targetPosition: targetNode.position,
        sourceRadius: sourceNode.radius,
        targetRadius: targetNode.radius,
        isPriority,
        targetSharedByExpandedCount: targetNode.sharedByExpandedCount,
      } satisfies GraphRenderEdge
    })

  const { edges, edgesThinned, thinnedEdgeCount } = thinCandidateEdges({
    candidateEdges,
    rootNodePubkey,
    selectedNodePubkey,
  })
  const labelsSuppressedByBudget = renderNodes.length > GRAPH_LABEL_NODE_BUDGET
  const degradedReasons = [
    ...(edgesThinned ? (['edge-thinning'] as const) : []),
    ...(labelsSuppressedByBudget ? (['labels-suppressed'] as const) : []),
  ]
  const labels: GraphRenderLabel[] = renderNodes.map((node) => ({
    id: `${node.id}:label`,
    pubkey: node.pubkey,
    text: node.displayLabel,
    position: node.position,
    radius: node.radius,
    isRoot: node.isRoot,
    isSelected: node.isSelected,
  }))
  const accessibleNodes: AccessibleNodeSummary[] = renderNodes.map((node) => ({
    id: node.id,
    pubkey: node.pubkey,
    displayLabel: node.displayLabel,
    isRoot: node.isRoot,
    source: node.source,
  }))

  return {
    nodes: renderNodes,
    edges,
    labels,
    accessibleNodes,
    bounds: resolveGraphBounds(renderNodes),
    topologySignature: createTopologySignature(renderNodes, edges, activeLayer),
    layoutKey,
    lod: {
      labelPolicy: labelsSuppressedByBudget
        ? 'hover-selected-only'
        : 'hover-selected-or-zoom',
      labelsSuppressedByBudget,
      edgesThinned,
      thinnedEdgeCount,
      candidateEdgeCount: candidateEdges.length,
      visibleEdgeCount: edges.length,
      visibleNodeCount: renderNodes.length,
      degradedReasons: [...degradedReasons],
    },
    analysisOverlay,
    activeLayer,
    renderConfig,
  }
}
