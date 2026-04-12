import type {
  GraphLink,
  GraphNodeSource,
  UiLayer,
  ZapLayerEdge,
  RenderConfig,
} from '@/features/graph/app/store/types'
import { buildGraphRenderModel } from '@/features/graph/render/buildGraphRenderModel'
import {
  deserializeBuildGraphRenderModelInput,
  type BuildRenderModelNodeInput,
  type BuildRenderModelRequest,
} from '@/features/graph/render/renderModelPayload'
import { analyzeDiscoveredGraph } from '@/features/graph/workers/graph/analyzeDiscoveredGraph'
import type {
  DiscoveredGraphAnalysisFlag,
  DiscoveredGraphAnalysisState,
} from '@/features/graph/analysis/types'
import type {
  AnalyzeDiscoveredGraphNodeInput,
  AnalyzeDiscoveredGraphRequest,
  CalcDegreesRequest,
  CalcDegreesResult,
  FindPathRequest,
  FindPathResult,
  GraphLinkInput,
  GraphWorkerActionMap,
} from '@/features/graph/workers/graph/contracts'
import { WorkerProtocolError } from '@/features/graph/workers/shared/protocol'
import type { WorkerHandlerRegistry } from '@/features/graph/workers/shared/runtime'
import {
  expectArray,
  expectFiniteNumber,
  expectRecord,
  expectString,
  normalizePubkey,
} from '@/features/graph/workers/shared/validation'

type NormalizedAdjacency = Record<string, string[]>

function validateAdjacency(input: unknown, path: string): Record<string, string[]> {
  const adjacency = expectRecord(input, path)

  return Object.fromEntries(
    Object.entries(adjacency).map(([pubkey, neighbors]) => {
      if (!Array.isArray(neighbors) || neighbors.some((neighbor) => typeof neighbor !== 'string')) {
        throw new WorkerProtocolError(
          'INVALID_PAYLOAD',
          `${path}.${pubkey} must be an array of pubkeys.`,
          { path: `${path}.${pubkey}` },
        )
      }

      return [
        normalizePubkey(pubkey, `${path}.${pubkey}`),
        neighbors.map((neighbor, index) =>
          normalizePubkey(neighbor, `${path}.${pubkey}[${index}]`),
        ),
      ]
    }),
  )
}

function validateFindPathRequest(payload: unknown): FindPathRequest {
  const request = expectRecord(payload, 'payload')
  const rawAlgorithm = request.algorithm

  if (
    typeof rawAlgorithm !== 'undefined' &&
    rawAlgorithm !== 'bfs' &&
    rawAlgorithm !== 'dijkstra'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      'payload.algorithm must be bfs or dijkstra when provided.',
    )
  }

  return {
    sourcePubkey: normalizePubkey(request.sourcePubkey, 'payload.sourcePubkey'),
    targetPubkey: normalizePubkey(request.targetPubkey, 'payload.targetPubkey'),
    adjacency: validateAdjacency(request.adjacency, 'payload.adjacency'),
    algorithm: rawAlgorithm,
  }
}

function validateGraphLink(input: unknown, index: number): GraphLinkInput {
  const link = expectRecord(input, `payload.links[${index}]`)

  return {
    sourcePubkey: normalizePubkey(link.sourcePubkey, `payload.links[${index}].sourcePubkey`),
    targetPubkey: normalizePubkey(link.targetPubkey, `payload.links[${index}].targetPubkey`),
  }
}

function validateGraphAnalysisNode(
  input: unknown,
  index: number,
): AnalyzeDiscoveredGraphNodeInput {
  const node = expectRecord(input, `payload.nodes[${index}]`)

  return {
    pubkey: normalizePubkey(node.pubkey, `payload.nodes[${index}].pubkey`),
    source: validateGraphNodeSource(node.source, `payload.nodes[${index}].source`),
  }
}

function validateRelayHealthStatus(
  value: unknown,
  path: string,
): 'unknown' | 'connected' | 'partial' | 'degraded' | 'offline' {
  if (
    value !== 'unknown' &&
    value !== 'connected' &&
    value !== 'partial' &&
    value !== 'degraded' &&
    value !== 'offline'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be a supported relay health status.`,
      { path },
    )
  }

  return value
}

function validateAnalyzeDiscoveredGraphRequest(
  payload: unknown,
): AnalyzeDiscoveredGraphRequest {
  const request = expectRecord(payload, 'payload')
  const relayHealth = expectRecord(request.relayHealth, 'payload.relayHealth')

  return {
    jobKind:
      request.jobKind === 'ANALYZE_DISCOVERED_GRAPH'
        ? 'ANALYZE_DISCOVERED_GRAPH'
        : 'ANALYZE_DISCOVERED_GRAPH',
    jobKey: expectString(request.jobKey, 'payload.jobKey'),
    analysisKey: expectString(request.analysisKey, 'payload.analysisKey'),
    nodes: expectArray(request.nodes, 'payload.nodes').map((node, index) =>
      validateGraphAnalysisNode(node, index),
    ),
    links: expectArray(request.links, 'payload.links').map((link, index) =>
      validateGraphLinkForRender(link, `payload.links[${index}]`),
    ),
    rootNodePubkey:
      request.rootNodePubkey === null
        ? null
        : normalizePubkey(request.rootNodePubkey, 'payload.rootNodePubkey'),
    capReached: request.capReached === true,
    isGraphStale: request.isGraphStale === true,
    relayHealth: Object.fromEntries(
      Object.entries(relayHealth).map(([relayUrl, health]) => {
        const snapshot = expectRecord(health, `payload.relayHealth.${relayUrl}`)
        return [
          relayUrl,
          {
            status: validateRelayHealthStatus(
              snapshot.status,
              `payload.relayHealth.${relayUrl}.status`,
            ),
          },
        ]
      }),
    ),
  }
}

function validateCalcDegreesRequest(payload: unknown): CalcDegreesRequest {
  const request = expectRecord(payload, 'payload')
  const adjacency = request.adjacency
  const links = request.links

  if (typeof adjacency === 'undefined' && typeof links === 'undefined') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      'payload must contain adjacency or links.',
    )
  }

  return {
    adjacency: typeof adjacency === 'undefined' ? undefined : validateAdjacency(adjacency, 'payload.adjacency'),
    links:
      typeof links === 'undefined'
        ? undefined
        : expectArray(links, 'payload.links').map((link, index) => validateGraphLink(link, index)),
  }
}

function validateNullableString(value: unknown, path: string): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must be a string or null.`, {
      path,
    })
  }

  return value
}

function validateNullableFiniteNumber(
  value: unknown,
  path: string,
): number | null {
  if (value === null) {
    return null
  }

  return expectFiniteNumber(value, path)
}

function validateGraphNodeSource(
  value: unknown,
  path: string,
): GraphNodeSource {
  if (
    value !== 'root' &&
    value !== 'follow' &&
    value !== 'inbound' &&
    value !== 'zap'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be one of root, follow, inbound or zap.`,
      { path },
    )
  }

  return value
}

function validateUiLayer(value: unknown, path: string): UiLayer {
  if (
    value !== 'graph' &&
    value !== 'connections' &&
    value !== 'following' &&
    value !== 'following-non-followers' &&
    value !== 'mutuals' &&
    value !== 'followers' &&
    value !== 'nonreciprocal-followers' &&
    value !== 'keywords' &&
    value !== 'zaps' &&
    value !== 'pathfinding'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be a supported ui layer.`,
      { path },
    )
  }

  return value
}

function validateNullablePositionTuple(
  value: unknown,
  path: string,
): [number, number] {
  const tuple = expectArray(value, path)

  if (tuple.length !== 2) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must contain exactly 2 coordinates.`,
      { path },
    )
  }

  return [
    expectFiniteNumber(tuple[0], `${path}[0]`),
    expectFiniteNumber(tuple[1], `${path}[1]`),
  ]
}

function validateGraphAnalysisConfidence(
  value: unknown,
  path: string,
): 'low' | 'medium' | 'high' {
  if (value !== 'low' && value !== 'medium' && value !== 'high') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be low, medium or high.`,
      { path },
    )
  }

  return value
}

function validateGraphAnalysisFlag(
  value: unknown,
  path: string,
): DiscoveredGraphAnalysisFlag {
  if (
    value !== 'relay-health-mixed' &&
    value !== 'relay-health-poor' &&
    value !== 'graph-sparse' &&
    value !== 'cap-reached' &&
    value !== 'stale-relay-override' &&
    value !== 'budget-exceeded' &&
    value !== 'isolated-topology'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be a supported analysis flag.`,
      { path },
    )
  }

  return value
}

function validateGraphAnalysisState(
  value: unknown,
  path: string,
): DiscoveredGraphAnalysisState {
  const state = expectRecord(value, path)
  const result =
    state.result === null || typeof state.result === 'undefined'
      ? null
      : expectRecord(state.result, `${path}.result`)
  const status =
    state.status === 'loading' ||
    state.status === 'ready' ||
    state.status === 'partial' ||
    state.status === 'error'
      ? state.status
      : 'idle'

  return {
    status,
    isStale: state.isStale === true,
    analysisKey:
      state.analysisKey === null || typeof state.analysisKey === 'undefined'
        ? null
        : expectString(state.analysisKey, `${path}.analysisKey`),
    message:
      state.message === null || typeof state.message === 'undefined'
        ? null
        : expectString(state.message, `${path}.message`),
    result:
      result === null
        ? null
        : {
            analysisKey: expectString(
              result.analysisKey,
              `${path}.result.analysisKey`,
            ),
            mode:
              result.mode === 'heuristic' ? 'heuristic' : 'full',
            confidence: validateGraphAnalysisConfidence(
              result.confidence,
              `${path}.result.confidence`,
            ),
            nodeCount: expectFiniteNumber(
              result.nodeCount,
              `${path}.result.nodeCount`,
            ),
            analyzedNodeCount: expectFiniteNumber(
              result.analyzedNodeCount,
              `${path}.result.analyzedNodeCount`,
            ),
            communityCount: expectFiniteNumber(
              result.communityCount,
              `${path}.result.communityCount`,
            ),
            relayHealth: {
              totalRelayCount: expectFiniteNumber(
                expectRecord(
                  result.relayHealth,
                  `${path}.result.relayHealth`,
                ).totalRelayCount,
                `${path}.result.relayHealth.totalRelayCount`,
              ),
              healthyRelayCount: expectFiniteNumber(
                expectRecord(
                  result.relayHealth,
                  `${path}.result.relayHealth`,
                ).healthyRelayCount,
                `${path}.result.relayHealth.healthyRelayCount`,
              ),
              degradedRelayCount: expectFiniteNumber(
                expectRecord(
                  result.relayHealth,
                  `${path}.result.relayHealth`,
                ).degradedRelayCount,
                `${path}.result.relayHealth.degradedRelayCount`,
              ),
              offlineRelayCount: expectFiniteNumber(
                expectRecord(
                  result.relayHealth,
                  `${path}.result.relayHealth`,
                ).offlineRelayCount,
                `${path}.result.relayHealth.offlineRelayCount`,
              ),
            },
            flags: expectArray(result.flags, `${path}.result.flags`).map(
              (flag, index) =>
                validateGraphAnalysisFlag(
                  flag,
                  `${path}.result.flags[${index}]`,
                ),
            ),
            communities: expectArray(
              result.communities,
              `${path}.result.communities`,
            ).map((community, index) => {
              const entry = expectRecord(
                community,
                `${path}.result.communities[${index}]`,
              )

              return {
                id: expectString(
                  entry.id,
                  `${path}.result.communities[${index}].id`,
                ),
                size: expectFiniteNumber(
                  entry.size,
                  `${path}.result.communities[${index}].size`,
                ),
                confidence: validateGraphAnalysisConfidence(
                  entry.confidence,
                  `${path}.result.communities[${index}].confidence`,
                ),
                memberPubkeys: expectArray(
                  entry.memberPubkeys,
                  `${path}.result.communities[${index}].memberPubkeys`,
                ).map((pubkey, memberIndex) =>
                  expectString(
                    pubkey,
                    `${path}.result.communities[${index}].memberPubkeys[${memberIndex}]`,
                  ),
                ),
              }
            }),
            nodeAnalysis: Object.fromEntries(
              Object.entries(
                expectRecord(result.nodeAnalysis, `${path}.result.nodeAnalysis`),
              ).map(([pubkey, analysis]) => {
                const entry = expectRecord(
                  analysis,
                  `${path}.result.nodeAnalysis.${pubkey}`,
                )

                return [
                  pubkey,
                  {
                    pubkey: expectString(
                      entry.pubkey,
                      `${path}.result.nodeAnalysis.${pubkey}.pubkey`,
                    ),
                    communityId:
                      entry.communityId === null
                        ? null
                        : expectString(
                            entry.communityId,
                            `${path}.result.nodeAnalysis.${pubkey}.communityId`,
                          ),
                    communitySize: expectFiniteNumber(
                      entry.communitySize,
                      `${path}.result.nodeAnalysis.${pubkey}.communitySize`,
                    ),
                    leaderScore: expectFiniteNumber(
                      entry.leaderScore,
                      `${path}.result.nodeAnalysis.${pubkey}.leaderScore`,
                    ),
                    bridgeScore: expectFiniteNumber(
                      entry.bridgeScore,
                      `${path}.result.nodeAnalysis.${pubkey}.bridgeScore`,
                    ),
                    leaderQuantile: expectFiniteNumber(
                      entry.leaderQuantile,
                      `${path}.result.nodeAnalysis.${pubkey}.leaderQuantile`,
                    ),
                    bridgeQuantile: expectFiniteNumber(
                      entry.bridgeQuantile,
                      `${path}.result.nodeAnalysis.${pubkey}.bridgeQuantile`,
                    ),
                    confidence: validateGraphAnalysisConfidence(
                      entry.confidence,
                      `${path}.result.nodeAnalysis.${pubkey}.confidence`,
                    ),
                    useNeutralFill: entry.useNeutralFill === true,
                    isLeader: entry.isLeader === true,
                    isBridge: entry.isBridge === true,
                  },
                ]
              }),
            ),
          },
  }
}

function validateBuildRenderModelNode(
  input: unknown,
  path: string,
): BuildRenderModelNodeInput {
  const node = expectRecord(input, path)

  return {
    pubkey: expectString(node.pubkey, `${path}.pubkey`),
    label: validateNullableString(node.label, `${path}.label`) ?? undefined,
    picture:
      validateNullableString(node.picture, `${path}.picture`) ?? undefined,
    keywordHits: expectFiniteNumber(node.keywordHits, `${path}.keywordHits`),
    discoveredAt: validateNullableFiniteNumber(
      node.discoveredAt,
      `${path}.discoveredAt`,
    ),
    source: validateGraphNodeSource(node.source, `${path}.source`),
  }
}

function validateGraphLinkForRender(input: unknown, path: string): GraphLink {
  const link = expectRecord(input, path)
  const relation = link.relation

  if (relation !== 'follow' && relation !== 'inbound' && relation !== 'zap') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path}.relation must be follow, inbound or zap.`,
      { path: `${path}.relation` },
    )
  }

  return {
    source: expectString(link.source, `${path}.source`),
    target: expectString(link.target, `${path}.target`),
    relation,
    ...(typeof link.weight === 'undefined'
      ? {}
      : { weight: expectFiniteNumber(link.weight, `${path}.weight`) }),
  }
}

function validateZapEdge(input: unknown, path: string): ZapLayerEdge {
  const edge = expectRecord(input, path)

  if (edge.relation !== 'zap') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path}.relation must be zap.`,
      { path: `${path}.relation` },
    )
  }

  return {
    source: expectString(edge.source, `${path}.source`),
    target: expectString(edge.target, `${path}.target`),
    relation: 'zap',
    weight: expectFiniteNumber(edge.weight, `${path}.weight`),
    receiptCount: expectFiniteNumber(edge.receiptCount, `${path}.receiptCount`),
  }
}

function validateRenderConfig(input: unknown, path: string): RenderConfig {
  const config = expectRecord(input, path)
  
  return {
    edgeThickness: expectFiniteNumber(config.edgeThickness, `${path}.edgeThickness`),
    arrowType: expectString(config.arrowType, `${path}.arrowType`) as RenderConfig['arrowType'],
    nodeSpacingFactor: expectFiniteNumber(config.nodeSpacingFactor, `${path}.nodeSpacingFactor`),
    nodeSizeFactor: expectFiniteNumber(config.nodeSizeFactor, `${path}.nodeSizeFactor`),
    autoSizeNodes: config.autoSizeNodes === true,
    imageQualityMode: expectString(
      config.imageQualityMode ?? 'adaptive',
      `${path}.imageQualityMode`,
    ) as RenderConfig['imageQualityMode'],
    showSharedEmphasis: config.showSharedEmphasis === true,
  }
}

function validateEffectiveGraphCaps(
  input: unknown,
  path: string,
): BuildRenderModelRequest['effectiveGraphCaps'] {
  if (typeof input === 'undefined') {
    return {
      maxNodes: 3000,
      coldStartLayoutTicks: 90,
      warmStartLayoutTicks: 50,
    }
  }

  const caps = expectRecord(input, path)

  return {
    maxNodes: expectFiniteNumber(caps.maxNodes, `${path}.maxNodes`),
    coldStartLayoutTicks: expectFiniteNumber(
      caps.coldStartLayoutTicks,
      `${path}.coldStartLayoutTicks`,
    ),
    warmStartLayoutTicks: expectFiniteNumber(
      caps.warmStartLayoutTicks,
      `${path}.warmStartLayoutTicks`,
    ),
  }
}

function validateBuildRenderModelRequest(
  payload: unknown,
): BuildRenderModelRequest {
  const request = expectRecord(payload, 'payload')
  const nodesRecord = expectRecord(request.nodes, 'payload.nodes')
  const previousPositionsRecord =
    typeof request.previousPositions === 'undefined'
      ? undefined
      : expectRecord(request.previousPositions, 'payload.previousPositions')

  return {
    jobKind:
      request.jobKind === 'BUILD_RENDER_MODEL'
        ? 'BUILD_RENDER_MODEL'
        : undefined,
    jobKey:
      typeof request.jobKey === 'undefined'
        ? undefined
        : expectString(request.jobKey, 'payload.jobKey'),
    nodes: Object.fromEntries(
      Object.entries(nodesRecord).map(([pubkey, node]) => [
        pubkey,
        validateBuildRenderModelNode(node, `payload.nodes.${pubkey}`),
      ]),
    ),
    links: expectArray(request.links, 'payload.links').map((link, index) =>
      validateGraphLinkForRender(link, `payload.links[${index}]`),
    ),
    inboundLinks: expectArray(
      request.inboundLinks,
      'payload.inboundLinks',
    ).map((link, index) =>
      validateGraphLinkForRender(link, `payload.inboundLinks[${index}]`),
    ),
    connectionsLinks: (Array.isArray(request.connectionsLinks)
      ? request.connectionsLinks
      : []
    ).map((link: unknown, index: number) =>
      validateGraphLinkForRender(link, `payload.connectionsLinks[${index}]`),
    ),
    zapEdges: expectArray(request.zapEdges, 'payload.zapEdges').map(
      (edge, index) => validateZapEdge(edge, `payload.zapEdges[${index}]`),
    ),
    activeLayer: validateUiLayer(request.activeLayer, 'payload.activeLayer'),
    connectionsSourceLayer:
      request.connectionsSourceLayer === 'graph' ||
      request.connectionsSourceLayer === 'following' ||
      request.connectionsSourceLayer === 'following-non-followers' ||
      request.connectionsSourceLayer === 'mutuals' ||
      request.connectionsSourceLayer === 'followers' ||
      request.connectionsSourceLayer === 'nonreciprocal-followers' ||
      request.connectionsSourceLayer === 'keywords' ||
      request.connectionsSourceLayer === 'zaps' ||
      request.connectionsSourceLayer === 'pathfinding'
        ? request.connectionsSourceLayer
        : 'graph',
    rootNodePubkey:
      request.rootNodePubkey === null
        ? null
        : expectString(request.rootNodePubkey, 'payload.rootNodePubkey'),
    selectedNodePubkey:
      request.selectedNodePubkey === null
        ? null
        : expectString(
            request.selectedNodePubkey,
            'payload.selectedNodePubkey',
          ),
    expandedNodePubkeys: expectArray(
      request.expandedNodePubkeys,
      'payload.expandedNodePubkeys',
    ).map((pubkey, index) =>
      expectString(pubkey, `payload.expandedNodePubkeys[${index}]`),
    ),
    comparedNodePubkeys: Array.isArray(request.comparedNodePubkeys)
      ? expectArray(
          request.comparedNodePubkeys,
          'payload.comparedNodePubkeys',
        ).map((pubkey, index) =>
          expectString(pubkey, `payload.comparedNodePubkeys[${index}]`),
        )
      : [],
    previousPositions: previousPositionsRecord
      ? Object.fromEntries(
          Object.entries(previousPositionsRecord).map(([pubkey, position]) => [
            pubkey,
            validateNullablePositionTuple(
              position,
              `payload.previousPositions.${pubkey}`,
            ),
          ]),
        )
      : undefined,
    previousLayoutKey:
      typeof request.previousLayoutKey === 'undefined'
        ? undefined
        : expectString(request.previousLayoutKey, 'payload.previousLayoutKey'),
    graphAnalysis: validateGraphAnalysisState(
      request.graphAnalysis ?? {},
      'payload.graphAnalysis',
    ),
    effectiveGraphCaps: validateEffectiveGraphCaps(
      request.effectiveGraphCaps,
      'payload.effectiveGraphCaps',
    ),
    renderConfig: validateRenderConfig(request.renderConfig, 'payload.renderConfig'),
  } satisfies BuildRenderModelRequest
}

function buildNormalizedAdjacency(adjacencyInput: Record<string, string[]>): NormalizedAdjacency {
  const adjacency = Object.fromEntries(
    Object.entries(adjacencyInput).map(([pubkey, neighbors]) => [
      pubkey,
      [...new Set(neighbors)].sort(),
    ]),
  )

  Object.values(adjacency).forEach((neighbors) => {
    neighbors.forEach((neighbor) => {
      adjacency[neighbor] ??= []
    })
  })

  return Object.fromEntries(
    Object.entries(adjacency).sort(([leftPubkey], [rightPubkey]) => leftPubkey.localeCompare(rightPubkey)),
  )
}

function adjacencyFromLinks(links: GraphLinkInput[]): NormalizedAdjacency {
  const adjacency: NormalizedAdjacency = {}

  links.forEach((link) => {
    adjacency[link.sourcePubkey] ??= []
    adjacency[link.targetPubkey] ??= []
    adjacency[link.sourcePubkey].push(link.targetPubkey)
  })

  return buildNormalizedAdjacency(adjacency)
}

export function findShortestPath(request: FindPathRequest): FindPathResult {
  const normalizedAdjacency = buildNormalizedAdjacency(request.adjacency)
  const sourcePubkey = request.sourcePubkey
  const targetPubkey = request.targetPubkey
  const algorithm = request.algorithm ?? 'bfs'

  if (!(sourcePubkey in normalizedAdjacency)) {
    throw new WorkerProtocolError(
      'GRAPH_NODE_NOT_FOUND',
      'The source pubkey is not present in the discovered graph.',
      { pubkey: sourcePubkey, role: 'source' },
    )
  }

  if (!(targetPubkey in normalizedAdjacency)) {
    throw new WorkerProtocolError(
      'GRAPH_NODE_NOT_FOUND',
      'The target pubkey is not present in the discovered graph.',
      { pubkey: targetPubkey, role: 'target' },
    )
  }

  const buildPath = (previous: Map<string, string | null>, cursor: string) => {
    const path: string[] = []
    let current: string | null = cursor

    while (current) {
      path.unshift(current)
      current = previous.get(current) ?? null
    }

    return path
  }

  if (algorithm === 'dijkstra') {
    const distances = new Map<string, number>()
    const previous = new Map<string, string | null>()
    const pending = new Set(Object.keys(normalizedAdjacency))
    let visitedCount = 0

    pending.forEach((pubkey) => {
      distances.set(pubkey, pubkey === sourcePubkey ? 0 : Number.POSITIVE_INFINITY)
    })
    previous.set(sourcePubkey, null)

    while (pending.size > 0) {
      let currentPubkey: string | null = null
      let currentDistance = Number.POSITIVE_INFINITY

      pending.forEach((pubkey) => {
        const candidateDistance = distances.get(pubkey) ?? Number.POSITIVE_INFINITY
        if (candidateDistance < currentDistance) {
          currentDistance = candidateDistance
          currentPubkey = pubkey
        }
      })

      if (currentPubkey === null || !Number.isFinite(currentDistance)) {
        break
      }

      pending.delete(currentPubkey)
      visitedCount += 1

      if (currentPubkey === targetPubkey) {
        return {
          path: buildPath(previous, currentPubkey),
          visitedCount,
          algorithm,
        }
      }

      normalizedAdjacency[currentPubkey].forEach((neighbor) => {
        if (!pending.has(neighbor)) {
          return
        }

        const nextDistance = currentDistance + 1
        if (nextDistance < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
          distances.set(neighbor, nextDistance)
          previous.set(neighbor, currentPubkey)
        }
      })
    }

    return {
      path: null,
      visitedCount,
      algorithm,
    }
  }

  const queue: string[] = [sourcePubkey]
  const previous = new Map<string, string | null>([[sourcePubkey, null]])
  let visitedCount = 0

  while (queue.length > 0) {
    const currentPubkey = queue.shift()
    if (!currentPubkey) {
      break
    }

    visitedCount += 1

    if (currentPubkey === targetPubkey) {
      return {
        path: buildPath(previous, currentPubkey),
        visitedCount,
        algorithm,
      }
    }

    normalizedAdjacency[currentPubkey].forEach((neighbor) => {
      if (!previous.has(neighbor)) {
        previous.set(neighbor, currentPubkey)
        queue.push(neighbor)
      }
    })
  }

  return {
    path: null,
    visitedCount,
    algorithm,
  }
}

export function calculateDegrees(request: CalcDegreesRequest): CalcDegreesResult {
  const normalizedAdjacency =
    request.adjacency ? buildNormalizedAdjacency(request.adjacency) : adjacencyFromLinks(request.links ?? [])
  const inboundCounts = new Map<string, number>()

  Object.entries(normalizedAdjacency).forEach(([pubkey, neighbors]) => {
    inboundCounts.set(pubkey, inboundCounts.get(pubkey) ?? 0)
    neighbors.forEach((neighbor) => {
      inboundCounts.set(neighbor, (inboundCounts.get(neighbor) ?? 0) + 1)
    })
  })

  const degrees = Object.fromEntries(
    Object.keys(normalizedAdjacency)
      .sort()
      .map((pubkey) => {
        const outbound = normalizedAdjacency[pubkey].length
        const inbound = inboundCounts.get(pubkey) ?? 0

        return [
          pubkey,
          {
            inbound,
            outbound,
            total: inbound + outbound,
          },
        ]
      }),
  )

  return { degrees }
}

export function buildRenderModel(request: BuildRenderModelRequest) {
  return buildGraphRenderModel(deserializeBuildGraphRenderModelInput(request))
}

export function createGraphWorkerRegistry(): WorkerHandlerRegistry<GraphWorkerActionMap> {
  return {
    ANALYZE_DISCOVERED_GRAPH: {
      validate: validateAnalyzeDiscoveredGraphRequest,
      handle: analyzeDiscoveredGraph,
    },
    FIND_PATH: {
      validate: validateFindPathRequest,
      handle: findShortestPath,
    },
    CALC_DEGREES: {
      validate: validateCalcDegreesRequest,
      handle: calculateDegrees,
    },
    BUILD_RENDER_MODEL: {
      validate: validateBuildRenderModelRequest,
      handle: buildRenderModel,
    },
  }
}
