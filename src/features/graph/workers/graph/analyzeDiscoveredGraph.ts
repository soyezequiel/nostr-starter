import { summarizeRelayHealth } from '@/features/graph/analysis/analysisKey'
import type {
  DiscoveredGraphAnalysisConfidence,
  DiscoveredGraphAnalysisFlag,
  DiscoveredGraphAnalysisResult,
} from '@/features/graph/analysis/types'
import type {
  AnalyzeDiscoveredGraphRequest,
  AnalyzeDiscoveredGraphNodeInput,
} from '@/features/graph/workers/graph/contracts'

type WeightedAdjacency = Map<string, Map<string, number>>
type DirectedAdjacency = Map<string, string[]>

const LOUVAIN_EPSILON = 1e-9
const LOUVAIN_MAX_PASSES = 12
const PAGERANK_ALPHA = 0.2
const PAGERANK_MAX_ITERATIONS = 40
const ANALYSIS_BUDGET_NODE_THRESHOLD = 2_400
const MICRO_GROUP_SIZE = 3

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const roundMetric = (value: number) => Math.round(clamp01(value) * 10_000) / 10_000

const getSortedNodePubkeys = (
  nodes: readonly AnalyzeDiscoveredGraphNodeInput[],
  links: AnalyzeDiscoveredGraphRequest['links'],
) => {
  const pubkeys = new Set<string>()

  for (const node of nodes) {
    if (node.source !== 'zap') {
      pubkeys.add(node.pubkey)
    }
  }

  for (const link of links) {
    if (link.relation !== 'follow') {
      continue
    }

    pubkeys.add(link.source)
    pubkeys.add(link.target)
  }

  return [...pubkeys].sort()
}

const buildDirectedFollowAdjacency = (
  nodePubkeys: readonly string[],
  links: AnalyzeDiscoveredGraphRequest['links'],
) => {
  const adjacency: DirectedAdjacency = new Map(
    nodePubkeys.map((pubkey) => [pubkey, []]),
  )

  for (const link of links) {
    if (link.relation !== 'follow') {
      continue
    }

    const neighbors = adjacency.get(link.source)
    if (!neighbors || !adjacency.has(link.target)) {
      continue
    }

    neighbors.push(link.target)
  }

  for (const [pubkey, neighbors] of adjacency.entries()) {
    adjacency.set(pubkey, [...new Set(neighbors)].sort())
  }

  return adjacency
}

const buildUndirectedProjection = (directedAdjacency: DirectedAdjacency) => {
  const pairWeights = new Map<string, { left: string; right: string; weight: number }>()

  for (const [source, targets] of directedAdjacency.entries()) {
    for (const target of targets) {
      const [left, right] =
        source.localeCompare(target) <= 0 ? [source, target] : [target, source]
      const key = `${left}|${right}`
      const reciprocal = directedAdjacency.get(target)?.includes(source) ?? false
      pairWeights.set(key, {
        left,
        right,
        weight: reciprocal ? 2 : 1,
      })
    }
  }

  const adjacency: WeightedAdjacency = new Map(
    [...directedAdjacency.keys()].map((pubkey) => [pubkey, new Map()]),
  )
  const degrees = new Map<string, number>(
    [...directedAdjacency.keys()].map((pubkey) => [pubkey, 0]),
  )
  let totalWeight = 0

  for (const { left, right, weight } of [...pairWeights.values()].sort((a, b) =>
    a.left === b.left
      ? a.right.localeCompare(b.right)
      : a.left.localeCompare(b.left),
  )) {
    adjacency.get(left)?.set(right, weight)
    adjacency.get(right)?.set(left, weight)
    degrees.set(left, (degrees.get(left) ?? 0) + weight)
    degrees.set(right, (degrees.get(right) ?? 0) + weight)
    totalWeight += weight
  }

  return {
    adjacency,
    degrees,
    totalWeight,
  }
}

const detectCommunities = ({
  nodePubkeys,
  adjacency,
  degrees,
  totalWeight,
}: {
  nodePubkeys: readonly string[]
  adjacency: WeightedAdjacency
  degrees: ReadonlyMap<string, number>
  totalWeight: number
}) => {
  if (totalWeight <= 0) {
    return new Map<string, string>()
  }

  const communityOf = new Map(nodePubkeys.map((pubkey) => [pubkey, pubkey]))
  const communityTotals = new Map(
    nodePubkeys.map((pubkey) => [pubkey, degrees.get(pubkey) ?? 0]),
  )

  for (let pass = 0; pass < LOUVAIN_MAX_PASSES; pass += 1) {
    let movedInPass = false

    for (const pubkey of nodePubkeys) {
      const currentCommunity = communityOf.get(pubkey) ?? pubkey
      const nodeDegree = degrees.get(pubkey) ?? 0
      const weightsByCommunity = new Map<string, number>()

      for (const [neighbor, weight] of adjacency.get(pubkey)?.entries() ?? []) {
        const neighborCommunity = communityOf.get(neighbor) ?? neighbor
        weightsByCommunity.set(
          neighborCommunity,
          (weightsByCommunity.get(neighborCommunity) ?? 0) + weight,
        )
      }

      communityTotals.set(
        currentCommunity,
        (communityTotals.get(currentCommunity) ?? 0) - nodeDegree,
      )

      let bestCommunity = currentCommunity
      let bestGain = 0

      for (const candidateCommunity of [...weightsByCommunity.keys()].sort()) {
        const weightToCommunity = weightsByCommunity.get(candidateCommunity) ?? 0
        const candidateTotal = communityTotals.get(candidateCommunity) ?? 0
        const gain =
          weightToCommunity -
          (candidateTotal * nodeDegree) / (2 * totalWeight)

        if (
          gain > bestGain + LOUVAIN_EPSILON ||
          (Math.abs(gain - bestGain) <= LOUVAIN_EPSILON &&
            gain > LOUVAIN_EPSILON &&
            candidateCommunity.localeCompare(bestCommunity) < 0)
        ) {
          bestGain = gain
          bestCommunity = candidateCommunity
        }
      }

      communityOf.set(pubkey, bestCommunity)
      communityTotals.set(
        bestCommunity,
        (communityTotals.get(bestCommunity) ?? 0) + nodeDegree,
      )

      if (bestCommunity !== currentCommunity) {
        movedInPass = true
      }
    }

    if (!movedInPass) {
      break
    }
  }

  const groupedMembers = new Map<string, string[]>()
  for (const pubkey of nodePubkeys) {
    const community = communityOf.get(pubkey) ?? pubkey
    const members = groupedMembers.get(community) ?? []
    members.push(pubkey)
    groupedMembers.set(community, members)
  }

  const canonicalCommunityId = new Map<string, string>()
  for (const [community, members] of groupedMembers.entries()) {
    canonicalCommunityId.set(community, members.sort()[0])
  }

  return new Map(
    nodePubkeys.map((pubkey) => {
      const rawCommunity = communityOf.get(pubkey) ?? pubkey
      return [pubkey, canonicalCommunityId.get(rawCommunity) ?? rawCommunity]
    }),
  )
}

const buildQuantiles = (scores: ReadonlyMap<string, number>) => {
  const ranked = [...scores.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1]
    }

    return left[0].localeCompare(right[0])
  })

  if (ranked.length <= 1) {
    return new Map(ranked.map(([pubkey]) => [pubkey, ranked.length === 1 ? 1 : 0]))
  }

  return new Map(
    ranked.map(([pubkey], index) => [pubkey, 1 - index / (ranked.length - 1)]),
  )
}

const calculatePersonalizedPageRank = ({
  nodePubkeys,
  directedAdjacency,
  rootNodePubkey,
}: {
  nodePubkeys: readonly string[]
  directedAdjacency: DirectedAdjacency
  rootNodePubkey: string | null
}) => {
  if (nodePubkeys.length === 0) {
    return new Map<string, number>()
  }

  const personalization = new Map<string, number>()
  if (rootNodePubkey && directedAdjacency.has(rootNodePubkey)) {
    for (const pubkey of nodePubkeys) {
      personalization.set(pubkey, pubkey === rootNodePubkey ? 1 : 0)
    }
  } else {
    const uniform = 1 / nodePubkeys.length
    for (const pubkey of nodePubkeys) {
      personalization.set(pubkey, uniform)
    }
  }

  let previous = new Map<string, number>(personalization)

  for (let iteration = 0; iteration < PAGERANK_MAX_ITERATIONS; iteration += 1) {
    const next = new Map(nodePubkeys.map((pubkey) => [pubkey, 0]))
    let danglingMass = 0

    for (const pubkey of nodePubkeys) {
      const score = previous.get(pubkey) ?? 0
      const outgoing = directedAdjacency.get(pubkey) ?? []

      if (outgoing.length === 0) {
        danglingMass += score
        continue
      }

      const contribution = ((1 - PAGERANK_ALPHA) * score) / outgoing.length
      for (const neighbor of outgoing) {
        next.set(neighbor, (next.get(neighbor) ?? 0) + contribution)
      }
    }

    let delta = 0
    for (const pubkey of nodePubkeys) {
      const restart = PAGERANK_ALPHA * (personalization.get(pubkey) ?? 0)
      const danglingContribution =
        (1 - PAGERANK_ALPHA) *
        danglingMass *
        (personalization.get(pubkey) ?? 0)
      const nextValue = restart + danglingContribution + (next.get(pubkey) ?? 0)
      delta += Math.abs(nextValue - (previous.get(pubkey) ?? 0))
      next.set(pubkey, nextValue)
    }

    previous = next

    if (delta <= LOUVAIN_EPSILON) {
      break
    }
  }

  return previous
}

const normalizeByMax = (scores: ReadonlyMap<string, number>) => {
  const maxScore = [...scores.values()].reduce(
    (currentMax, score) => Math.max(currentMax, score),
    0,
  )

  if (maxScore <= 0) {
    return new Map([...scores.keys()].map((pubkey) => [pubkey, 0]))
  }

  return new Map(
    [...scores.entries()].map(([pubkey, score]) => [pubkey, score / maxScore]),
  )
}

const buildInboundDegrees = (nodePubkeys: readonly string[], directedAdjacency: DirectedAdjacency) => {
  const inbound = new Map(nodePubkeys.map((pubkey) => [pubkey, 0]))

  for (const [source, targets] of directedAdjacency.entries()) {
    if (!inbound.has(source)) {
      continue
    }

    for (const target of targets) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1)
    }
  }

  return inbound
}

const buildMutualDegrees = (nodePubkeys: readonly string[], directedAdjacency: DirectedAdjacency) => {
  const mutualDegrees = new Map(nodePubkeys.map((pubkey) => [pubkey, 0]))

  for (const pubkey of nodePubkeys) {
    const outgoing = directedAdjacency.get(pubkey) ?? []
    let mutualCount = 0

    for (const neighbor of outgoing) {
      if (directedAdjacency.get(neighbor)?.includes(pubkey)) {
        mutualCount += 1
      }
    }

    mutualDegrees.set(pubkey, mutualCount)
  }

  return mutualDegrees
}

const calculateBridgeScores = ({
  nodePubkeys,
  undirectedAdjacency,
  communities,
}: {
  nodePubkeys: readonly string[]
  undirectedAdjacency: WeightedAdjacency
  communities: ReadonlyMap<string, string>
}) => {
  const crossCommunityWeights = new Map<string, number>()
  const participationByNode = new Map<string, number>()

  for (const pubkey of nodePubkeys) {
    const neighborWeightsByCommunity = new Map<string, number>()
    let totalWeight = 0
    let crossWeight = 0
    const ownCommunity = communities.get(pubkey) ?? null

    for (const [neighbor, weight] of undirectedAdjacency.get(pubkey)?.entries() ?? []) {
      totalWeight += weight
      const neighborCommunity = communities.get(neighbor) ?? null

      if (ownCommunity !== null && neighborCommunity !== ownCommunity) {
        crossWeight += weight
      }

      if (neighborCommunity !== null) {
        neighborWeightsByCommunity.set(
          neighborCommunity,
          (neighborWeightsByCommunity.get(neighborCommunity) ?? 0) + weight,
        )
      }
    }

    crossCommunityWeights.set(pubkey, crossWeight)

    if (totalWeight <= 0 || ownCommunity === null) {
      participationByNode.set(pubkey, 0)
      continue
    }

    let participation = 1
    for (const communityWeight of neighborWeightsByCommunity.values()) {
      const share = communityWeight / totalWeight
      participation -= share * share
    }
    participationByNode.set(pubkey, clamp01(participation))
  }

  const normalizedCrossWeights = normalizeByMax(crossCommunityWeights)

  return new Map(
    nodePubkeys.map((pubkey) => {
      const score =
        (participationByNode.get(pubkey) ?? 0) * 0.7 +
        (normalizedCrossWeights.get(pubkey) ?? 0) * 0.3

      return [pubkey, score]
    }),
  )
}

const calculateHeuristicBridgeScores = ({
  nodePubkeys,
  inboundDegrees,
  directedAdjacency,
  mutualDegrees,
}: {
  nodePubkeys: readonly string[]
  inboundDegrees: ReadonlyMap<string, number>
  directedAdjacency: DirectedAdjacency
  mutualDegrees: ReadonlyMap<string, number>
}) => {
  const rawScores = new Map<string, number>()

  for (const pubkey of nodePubkeys) {
    const inbound = inboundDegrees.get(pubkey) ?? 0
    const outbound = directedAdjacency.get(pubkey)?.length ?? 0
    const mutual = mutualDegrees.get(pubkey) ?? 0
    const dualDirectionBonus = inbound > 0 && outbound > 0 ? 1 : 0

    rawScores.set(pubkey, outbound + inbound * 0.8 + mutual * 1.2 + dualDirectionBonus)
  }

  return normalizeByMax(rawScores)
}

const classifyConfidence = ({
  mode,
  flags,
  healthyRelayCount,
  communityCount,
  analyzedNodeCount,
}: {
  mode: 'full' | 'heuristic'
  flags: readonly DiscoveredGraphAnalysisFlag[]
  healthyRelayCount: number
  communityCount: number
  analyzedNodeCount: number
}): DiscoveredGraphAnalysisConfidence => {
  if (
    mode === 'heuristic' ||
    flags.includes('budget-exceeded') ||
    flags.includes('relay-health-poor') ||
    analyzedNodeCount < 8
  ) {
    return 'low'
  }

  if (
    flags.length > 0 ||
    healthyRelayCount <= 1 ||
    communityCount <= 1
  ) {
    return 'medium'
  }

  return 'high'
}

export const analyzeDiscoveredGraph = (
  request: AnalyzeDiscoveredGraphRequest,
): DiscoveredGraphAnalysisResult => {
  const relayHealth = summarizeRelayHealth(request.relayHealth)
  const nodePubkeys = getSortedNodePubkeys(request.nodes, request.links)
  const directedAdjacency = buildDirectedFollowAdjacency(nodePubkeys, request.links)
  const inboundDegrees = buildInboundDegrees(nodePubkeys, directedAdjacency)
  const mutualDegrees = buildMutualDegrees(nodePubkeys, directedAdjacency)
  const { adjacency: undirectedAdjacency, degrees, totalWeight } =
    buildUndirectedProjection(directedAdjacency)

  const flags: DiscoveredGraphAnalysisFlag[] = []
  if (relayHealth.degradedRelayCount > 0) {
    flags.push('relay-health-mixed')
  }
  if (
    relayHealth.totalRelayCount > 0 &&
    relayHealth.healthyRelayCount <= relayHealth.degradedRelayCount + relayHealth.offlineRelayCount
  ) {
    flags.push('relay-health-poor')
  }
  if (request.capReached) {
    flags.push('cap-reached')
  }
  if (request.isGraphStale) {
    flags.push('stale-relay-override')
  }
  if (nodePubkeys.length > ANALYSIS_BUDGET_NODE_THRESHOLD) {
    flags.push('budget-exceeded')
  }
  if (totalWeight <= 0) {
    flags.push('isolated-topology')
  }
  if (nodePubkeys.length > 0 && totalWeight < Math.max(3, nodePubkeys.length * 0.6)) {
    flags.push('graph-sparse')
  }

  const mode: 'full' | 'heuristic' =
    flags.includes('budget-exceeded') ||
    flags.includes('relay-health-poor') ||
    flags.includes('cap-reached') ||
    flags.includes('graph-sparse') ||
    flags.includes('isolated-topology')
      ? 'heuristic'
      : 'full'

  const communities =
    mode === 'full'
      ? detectCommunities({
          nodePubkeys,
          adjacency: undirectedAdjacency,
          degrees,
          totalWeight,
        })
      : new Map<string, string>()

  const communityMembers = new Map<string, string[]>()
  for (const pubkey of nodePubkeys) {
    const communityId = communities.get(pubkey)
    if (!communityId) {
      continue
    }

    const members = communityMembers.get(communityId) ?? []
    members.push(pubkey)
    communityMembers.set(communityId, members)
  }

  const orderedCommunities = [...communityMembers.entries()]
    .map(([id, memberPubkeys]) => ({
      id,
      memberPubkeys: memberPubkeys.sort(),
    }))
    .sort((left, right) =>
      left.id === right.id
        ? left.memberPubkeys.length - right.memberPubkeys.length
        : left.id.localeCompare(right.id),
    )

  const ppr = calculatePersonalizedPageRank({
    nodePubkeys,
    directedAdjacency,
    rootNodePubkey: request.rootNodePubkey,
  })
  const normalizedPpr = normalizeByMax(ppr)
  const normalizedInbound = normalizeByMax(inboundDegrees)
  const normalizedMutual = normalizeByMax(mutualDegrees)
  const leaderScores = new Map<string, number>(
    nodePubkeys.map((pubkey) => [
      pubkey,
      roundMetric(
        (normalizedPpr.get(pubkey) ?? 0) * 0.6 +
          (normalizedInbound.get(pubkey) ?? 0) * 0.25 +
          (normalizedMutual.get(pubkey) ?? 0) * 0.15,
      ),
    ]),
  )

  const bridgeScores =
    mode === 'full'
      ? calculateBridgeScores({
          nodePubkeys,
          undirectedAdjacency,
          communities,
        })
      : calculateHeuristicBridgeScores({
          nodePubkeys,
          inboundDegrees,
          directedAdjacency,
          mutualDegrees,
        })

  const leaderQuantiles = buildQuantiles(leaderScores)
  const bridgeQuantiles = buildQuantiles(bridgeScores)
  const confidence = classifyConfidence({
    mode,
    flags,
    healthyRelayCount: relayHealth.healthyRelayCount,
    communityCount: orderedCommunities.length,
    analyzedNodeCount: nodePubkeys.length,
  })

  const communityConfidence: DiscoveredGraphAnalysisConfidence =
    confidence === 'high' ? 'high' : confidence === 'medium' ? 'medium' : 'low'

  const nodeSources = new Map(
    request.nodes.map((node) => [node.pubkey, node.source]),
  )
  const resultNodeAnalysis = Object.fromEntries(
    nodePubkeys.map((pubkey) => {
      const communityId = communities.get(pubkey) ?? null
      const communitySize = communityId
        ? (communityMembers.get(communityId)?.length ?? 0)
        : 0
      const source = nodeSources.get(pubkey) ?? 'follow'
      const lowEvidenceNode =
        source === 'inbound' ||
        source === 'zap' ||
        communitySize < MICRO_GROUP_SIZE ||
        confidence === 'low'
      const nodeConfidence: DiscoveredGraphAnalysisConfidence =
        confidence === 'high' && !lowEvidenceNode
          ? 'high'
          : confidence === 'medium' || !lowEvidenceNode
            ? 'medium'
            : 'low'

      return [
        pubkey,
        {
          pubkey,
          communityId,
          communitySize,
          leaderScore: leaderScores.get(pubkey) ?? 0,
          bridgeScore: roundMetric(bridgeScores.get(pubkey) ?? 0),
          leaderQuantile: roundMetric(leaderQuantiles.get(pubkey) ?? 0),
          bridgeQuantile: roundMetric(bridgeQuantiles.get(pubkey) ?? 0),
          confidence: nodeConfidence,
          useNeutralFill: mode === 'heuristic' || lowEvidenceNode,
          isLeader:
            (leaderQuantiles.get(pubkey) ?? 0) >= 0.85 &&
            (leaderScores.get(pubkey) ?? 0) > 0,
          isBridge:
            (bridgeQuantiles.get(pubkey) ?? 0) >= 0.88 &&
            (bridgeScores.get(pubkey) ?? 0) > 0,
        },
      ]
    }),
  )

  return {
    analysisKey: request.analysisKey,
    mode,
    confidence,
    nodeCount: request.nodes.length,
    analyzedNodeCount: nodePubkeys.length,
    communityCount: orderedCommunities.length,
    relayHealth,
    flags,
    communities: orderedCommunities.map((community) => ({
      id: community.id,
      size: community.memberPubkeys.length,
      confidence: communityConfidence,
      memberPubkeys: community.memberPubkeys,
    })),
    nodeAnalysis: resultNodeAnalysis,
  }
}
