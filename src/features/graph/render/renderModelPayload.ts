import type {
  DiscoveredGraphAnalysisConfidence,
  DiscoveredGraphAnalysisState,
} from '@/features/graph/analysis/types'
import type {
  ConnectionsSourceLayer,
  GraphLink,
  GraphNodeSource,
  UiLayer,
  ZapLayerEdge,
  RenderConfig,
  EffectiveGraphCaps,
} from '@/features/graph/app/store/types'
import type { BuildGraphRenderModelInput } from '@/features/graph/render/types'

export interface BuildRenderModelNodeInput {
  pubkey: string
  label?: string
  picture?: string | null
  keywordHits: number
  discoveredAt: number | null
  source: GraphNodeSource
}

export interface BuildRenderModelRequest {
  jobKind?: 'BUILD_RENDER_MODEL'
  jobKey?: string
  nodes: Record<string, BuildRenderModelNodeInput>
  links: GraphLink[]
  inboundLinks: GraphLink[]
  connectionsLinks: GraphLink[]
  zapEdges: ZapLayerEdge[]
  activeLayer: UiLayer
  connectionsSourceLayer: ConnectionsSourceLayer
  rootNodePubkey: string | null
  selectedNodePubkey: string | null
  expandedNodePubkeys: string[]
  comparedNodePubkeys?: string[]
  pathfinding?: {
    status: 'idle' | 'computing' | 'found' | 'not-found' | 'error'
    path: string[] | null
  }
  graphAnalysis?: DiscoveredGraphAnalysisState
  effectiveGraphCaps: EffectiveGraphCaps
  renderConfig: RenderConfig
  previousPositions?: Record<string, [number, number]>
  previousLayoutKey?: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const sanitizeString = (value: unknown) =>
  isNonEmptyString(value) ? value.trim() : null

const sanitizeFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const sanitizeNullableFiniteNumber = (value: unknown) =>
  value === null
    ? null
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : null

const isGraphNodeSource = (value: unknown): value is GraphNodeSource =>
  value === 'root' ||
  value === 'follow' ||
  value === 'inbound' ||
  value === 'keyword' ||
  value === 'zap'

const isUiLayer = (value: unknown): value is UiLayer =>
  value === 'graph' ||
  value === 'connections' ||
  value === 'following' ||
  value === 'following-non-followers' ||
  value === 'mutuals' ||
  value === 'followers' ||
  value === 'nonreciprocal-followers' ||
  value === 'keywords' ||
  value === 'zaps' ||
  value === 'pathfinding'

const isConnectionsSourceLayer = (
  value: unknown,
): value is ConnectionsSourceLayer => isUiLayer(value) && value !== 'connections'

const isGraphLinkRelation = (
  value: unknown,
): value is GraphLink['relation'] | ZapLayerEdge['relation'] =>
  value === 'follow' || value === 'inbound' || value === 'zap'

const sanitizeNodes = (nodes: BuildGraphRenderModelInput['nodes']) =>
  Object.fromEntries(
    Object.values(nodes)
      .filter((node) => isNonEmptyString(node?.pubkey))
      .map((node) => {
        const pubkey = node.pubkey.trim()

        return [
          pubkey,
          {
            pubkey,
            ...(typeof node.label === 'string' ? { label: node.label } : {}),
            picture: typeof node.picture === 'string' ? node.picture : null,
            keywordHits: sanitizeFiniteNumber(node.keywordHits, 0),
            discoveredAt: sanitizeNullableFiniteNumber(node.discoveredAt),
            source: isGraphNodeSource(node.source) ? node.source : 'follow',
          } satisfies BuildRenderModelNodeInput,
        ]
      }),
  )

const sanitizeLinks = (links: readonly GraphLink[]) =>
  links.flatMap((link) => {
    const source = sanitizeString(link.source)
    const target = sanitizeString(link.target)

    if (!source || !target || !isGraphLinkRelation(link.relation)) {
      return []
    }

    return [
      {
        source,
        target,
        relation: link.relation,
        ...(typeof link.weight === 'number' && Number.isFinite(link.weight)
          ? { weight: link.weight }
          : {}),
      } satisfies GraphLink,
    ]
  })

const sanitizeZapEdges = (zapEdges: readonly ZapLayerEdge[]) =>
  zapEdges.flatMap((edge) => {
    const source = sanitizeString(edge.source)
    const target = sanitizeString(edge.target)

    if (
      !source ||
      !target ||
      edge.relation !== 'zap' ||
      !Number.isFinite(edge.weight) ||
      !Number.isFinite(edge.receiptCount)
    ) {
      return []
    }

    return [
      {
        source,
        target,
        relation: 'zap',
        weight: edge.weight,
        receiptCount: edge.receiptCount,
      } satisfies ZapLayerEdge,
    ]
  })

const sanitizeExpandedNodePubkeys = (
  expandedNodePubkeys: BuildGraphRenderModelInput['expandedNodePubkeys'],
) =>
  Array.from(
    new Set(
      Array.from(expandedNodePubkeys)
        .map((pubkey) => sanitizeString(pubkey))
        .filter((pubkey): pubkey is string => pubkey !== null),
    ),
  ).sort()

const sanitizeOrderedPubkeyList = (pubkeys: readonly string[]) => {
  const seen = new Set<string>()
  const ordered: string[] = []

  pubkeys.forEach((pubkey) => {
    const sanitizedPubkey = sanitizeString(pubkey)
    if (!sanitizedPubkey || seen.has(sanitizedPubkey)) {
      return
    }

    seen.add(sanitizedPubkey)
    ordered.push(sanitizedPubkey)
  })

  return ordered
}

const sanitizePathfindingState = (
  pathfinding: BuildGraphRenderModelInput['pathfinding'],
): NonNullable<BuildRenderModelRequest['pathfinding']> => ({
  status:
    pathfinding?.status === 'computing' ||
    pathfinding?.status === 'found' ||
    pathfinding?.status === 'not-found' ||
    pathfinding?.status === 'error'
      ? pathfinding.status
      : 'idle',
  path: pathfinding?.path
    ? sanitizeOrderedPubkeyList(pathfinding.path)
    : null,
})

const sanitizeGraphAnalysisConfidence = (
  value: unknown,
): DiscoveredGraphAnalysisConfidence =>
  value === 'high' || value === 'medium' ? value : 'low'

const sanitizeGraphAnalysisState = (
  graphAnalysis: BuildGraphRenderModelInput['graphAnalysis'],
): DiscoveredGraphAnalysisState => {
  const status =
    graphAnalysis?.status === 'loading' ||
    graphAnalysis?.status === 'ready' ||
    graphAnalysis?.status === 'partial' ||
    graphAnalysis?.status === 'error'
      ? graphAnalysis.status
      : 'idle'

  return {
    status,
    isStale: graphAnalysis?.isStale === true,
    analysisKey: sanitizeString(graphAnalysis?.analysisKey),
    message: sanitizeString(graphAnalysis?.message),
    result: graphAnalysis?.result
      ? {
          analysisKey: graphAnalysis.result.analysisKey,
          mode:
            graphAnalysis.result.mode === 'heuristic' ? 'heuristic' : 'full',
          confidence: sanitizeGraphAnalysisConfidence(
            graphAnalysis.result.confidence,
          ),
          nodeCount: sanitizeFiniteNumber(graphAnalysis.result.nodeCount, 0),
          analyzedNodeCount: sanitizeFiniteNumber(
            graphAnalysis.result.analyzedNodeCount,
            0,
          ),
          communityCount: sanitizeFiniteNumber(
            graphAnalysis.result.communityCount,
            0,
          ),
          relayHealth: {
            totalRelayCount: sanitizeFiniteNumber(
              graphAnalysis.result.relayHealth.totalRelayCount,
              0,
            ),
            healthyRelayCount: sanitizeFiniteNumber(
              graphAnalysis.result.relayHealth.healthyRelayCount,
              0,
            ),
            degradedRelayCount: sanitizeFiniteNumber(
              graphAnalysis.result.relayHealth.degradedRelayCount,
              0,
            ),
            offlineRelayCount: sanitizeFiniteNumber(
              graphAnalysis.result.relayHealth.offlineRelayCount,
              0,
            ),
          },
          flags: [...graphAnalysis.result.flags].sort(),
          communities: [...graphAnalysis.result.communities]
            .map((community) => ({
              id: community.id,
              size: sanitizeFiniteNumber(community.size, 0),
              confidence: sanitizeGraphAnalysisConfidence(
                community.confidence,
              ),
              memberPubkeys: [...community.memberPubkeys].sort(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          nodeAnalysis: Object.fromEntries(
            Object.entries(graphAnalysis.result.nodeAnalysis)
              .filter(([pubkey]) => isNonEmptyString(pubkey))
              .sort(([leftPubkey], [rightPubkey]) =>
                leftPubkey.localeCompare(rightPubkey),
              )
              .map(([pubkey, analysis]) => [
                pubkey,
                {
                  pubkey,
                  communityId: sanitizeString(analysis.communityId),
                  communitySize: sanitizeFiniteNumber(analysis.communitySize, 0),
                  leaderScore: sanitizeFiniteNumber(analysis.leaderScore, 0),
                  bridgeScore: sanitizeFiniteNumber(analysis.bridgeScore, 0),
                  leaderQuantile: sanitizeFiniteNumber(
                    analysis.leaderQuantile,
                    0,
                  ),
                  bridgeQuantile: sanitizeFiniteNumber(
                    analysis.bridgeQuantile,
                    0,
                  ),
                  confidence: sanitizeGraphAnalysisConfidence(
                    analysis.confidence,
                  ),
                  useNeutralFill: analysis.useNeutralFill === true,
                  isLeader: analysis.isLeader === true,
                  isBridge: analysis.isBridge === true,
                },
              ]),
          ),
        }
      : null,
  }
}

const sanitizePreviousPositions = (
  previousPositions: BuildGraphRenderModelInput['previousPositions'],
) =>
  previousPositions
    ? Object.fromEntries(
        Array.from(previousPositions.entries()).flatMap(([pubkey, position]) => {
          const nextPubkey = sanitizeString(pubkey)
          const x = position?.[0]
          const y = position?.[1]

          if (
            !nextPubkey ||
            typeof x !== 'number' ||
            !Number.isFinite(x) ||
            typeof y !== 'number' ||
            !Number.isFinite(y)
          ) {
            return []
          }

          return [[nextPubkey, [x, y] as [number, number]]]
        }),
      )
    : undefined

const DEFAULT_EFFECTIVE_GRAPH_CAPS: EffectiveGraphCaps = {
  maxNodes: 3000,
  coldStartLayoutTicks: 90,
  warmStartLayoutTicks: 50,
}

const sanitizeEffectiveGraphCaps = (
  effectiveGraphCaps: BuildGraphRenderModelInput['effectiveGraphCaps'] | undefined,
): EffectiveGraphCaps => ({
  maxNodes: sanitizeFiniteNumber(
    effectiveGraphCaps?.maxNodes,
    DEFAULT_EFFECTIVE_GRAPH_CAPS.maxNodes,
  ),
  coldStartLayoutTicks: sanitizeFiniteNumber(
    effectiveGraphCaps?.coldStartLayoutTicks,
    DEFAULT_EFFECTIVE_GRAPH_CAPS.coldStartLayoutTicks,
  ),
  warmStartLayoutTicks: sanitizeFiniteNumber(
    effectiveGraphCaps?.warmStartLayoutTicks,
    DEFAULT_EFFECTIVE_GRAPH_CAPS.warmStartLayoutTicks,
  ),
})

export const serializeBuildGraphRenderModelInput = ({
  jobKey,
  nodes,
  links,
  inboundLinks,
  connectionsLinks,
  zapEdges,
  activeLayer,
  connectionsSourceLayer,
  rootNodePubkey,
  selectedNodePubkey,
  expandedNodePubkeys,
  comparedNodePubkeys,
  pathfinding,
  graphAnalysis,
  effectiveGraphCaps,
  renderConfig,
  previousPositions,
  previousLayoutKey,
}: BuildGraphRenderModelInput & { jobKey?: string }): BuildRenderModelRequest => ({
  ...(isNonEmptyString(jobKey)
    ? {
        jobKind: 'BUILD_RENDER_MODEL',
        jobKey: jobKey.trim(),
      }
    : {}),
  nodes: sanitizeNodes(nodes),
  links: sanitizeLinks(links),
  inboundLinks: sanitizeLinks(inboundLinks),
  connectionsLinks: sanitizeLinks(connectionsLinks),
  zapEdges: sanitizeZapEdges(zapEdges),
  activeLayer: isUiLayer(activeLayer) ? activeLayer : 'graph',
  connectionsSourceLayer: isConnectionsSourceLayer(connectionsSourceLayer)
    ? connectionsSourceLayer
    : 'graph',
  rootNodePubkey: sanitizeString(rootNodePubkey),
  selectedNodePubkey: sanitizeString(selectedNodePubkey),
  expandedNodePubkeys: sanitizeExpandedNodePubkeys(expandedNodePubkeys),
  comparedNodePubkeys: sanitizeExpandedNodePubkeys(comparedNodePubkeys ?? new Set()),
  pathfinding: sanitizePathfindingState(pathfinding),
  graphAnalysis: sanitizeGraphAnalysisState(graphAnalysis),
  effectiveGraphCaps: sanitizeEffectiveGraphCaps(effectiveGraphCaps),
  renderConfig: {
    edgeThickness: sanitizeFiniteNumber(renderConfig.edgeThickness, 1),
    edgeOpacity: sanitizeFiniteNumber(renderConfig.edgeOpacity, 1),
    arrowType: renderConfig.arrowType === 'arrow' || renderConfig.arrowType === 'triangle' ? renderConfig.arrowType : 'none',
    nodeSpacingFactor: sanitizeFiniteNumber(renderConfig.nodeSpacingFactor, 1),
    nodeSizeFactor: sanitizeFiniteNumber(renderConfig.nodeSizeFactor, 1),
    autoSizeNodes: renderConfig.autoSizeNodes === true,
    imageQualityMode: renderConfig.imageQualityMode ?? 'adaptive',
    showSharedEmphasis: renderConfig.showSharedEmphasis === true,
  },
  previousPositions: sanitizePreviousPositions(previousPositions),
  ...(isNonEmptyString(previousLayoutKey)
    ? { previousLayoutKey: previousLayoutKey.trim() }
    : {}),
})

export const deserializeBuildGraphRenderModelInput = ({
  jobKey,
  nodes,
  links,
  inboundLinks,
  connectionsLinks,
  zapEdges,
  activeLayer,
  connectionsSourceLayer,
  rootNodePubkey,
  selectedNodePubkey,
  expandedNodePubkeys,
  comparedNodePubkeys,
  pathfinding,
  graphAnalysis,
  effectiveGraphCaps,
  renderConfig,
  previousPositions,
  previousLayoutKey,
}: BuildRenderModelRequest): BuildGraphRenderModelInput => ({
  nodes: Object.fromEntries(
    Object.entries(nodes).map(([pubkey, node]) => [
      pubkey,
      {
        pubkey: node.pubkey,
        label: node.label,
        picture: node.picture ?? null,
        keywordHits: node.keywordHits,
        discoveredAt: node.discoveredAt,
        source: node.source,
      },
    ]),
  ),
  links,
  inboundLinks,
  connectionsLinks: connectionsLinks ?? [],
  zapEdges,
  activeLayer,
  connectionsSourceLayer: isConnectionsSourceLayer(connectionsSourceLayer)
    ? connectionsSourceLayer
    : 'graph',
  rootNodePubkey,
  selectedNodePubkey,
  expandedNodePubkeys: new Set(expandedNodePubkeys),
  comparedNodePubkeys: new Set(comparedNodePubkeys ?? []),
  pathfinding: pathfinding
    ? {
        status: pathfinding.status,
        path: pathfinding.path ? [...pathfinding.path] : null,
      }
    : undefined,
  graphAnalysis,
  effectiveGraphCaps,
  renderConfig,
  previousPositions: previousPositions
    ? new Map(Object.entries(previousPositions))
    : undefined,
  previousLayoutKey,
  ...(typeof jobKey === 'string' ? { jobKey } : {}),
})
