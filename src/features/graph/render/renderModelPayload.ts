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
import type {
  BuildGraphRenderModelInput,
  GraphRenderEdge,
  GraphRenderLabel,
  GraphRenderModel,
  GraphRenderNode,
} from '@/features/graph/render/types'

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
  renderPass?: 'preview' | 'final'
  nodes: Record<string, BuildRenderModelNodeInput>
  links: GraphLink[]
  inboundLinks: GraphLink[]
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

interface TransferNodeMeta {
  id: string
  pubkey: string
  displayLabel: string
  pictureUrl: string | null
  keywordHits: number
  source: GraphRenderNode['source']
  discoveredAt: number | null
  sharedByExpandedCount: number
  analysisCommunityId: string | null
  pathOrder: number | null
}

interface TransferEdgeMeta {
  id: string
  source: string
  target: string
  relation: GraphRenderEdge['relation']
  targetSharedByExpandedCount: number
}

interface TransferLabelMeta {
  id: string
  pubkey: string
  text: string
}

export interface GraphRenderModelTransferPayload
  extends Omit<GraphRenderModel, 'nodes' | 'edges' | 'labels' | 'accessibleNodes'> {
  transferKind: 'GRAPH_RENDER_MODEL_TRANSFER'
  nodeMeta: TransferNodeMeta[]
  nodePositions: Float32Array
  nodeRadii: Float32Array
  nodeFlags: Uint16Array
  nodeFillColors: Uint8ClampedArray
  nodeLineColors: Uint8ClampedArray
  nodeBridgeHaloColors: Uint8ClampedArray
  edgeMeta: TransferEdgeMeta[]
  edgePositions: Float32Array
  edgeRadii: Float32Array
  edgeWeights: Float32Array
  edgeFlags: Uint8Array
  labelMeta: TransferLabelMeta[]
  labelPositions: Float32Array
  labelRadii: Float32Array
  labelFlags: Uint8Array
}

const NODE_FLAG_ROOT = 1 << 0
const NODE_FLAG_EXPANDED = 1 << 1
const NODE_FLAG_SELECTED = 1 << 2
const NODE_FLAG_COMMON_FOLLOW = 1 << 3
const NODE_FLAG_HAS_BRIDGE_HALO = 1 << 4
const NODE_FLAG_PATH_NODE = 1 << 5
const NODE_FLAG_PATH_ENDPOINT = 1 << 6

const EDGE_FLAG_PRIORITY = 1 << 0
const EDGE_FLAG_PATH = 1 << 1

const LABEL_FLAG_ROOT = 1 << 0
const LABEL_FLAG_SELECTED = 1 << 1

const DEFAULT_COLOR = [0, 0, 0, 0] as const

const writeColor = (
  target: Uint8ClampedArray,
  index: number,
  color: readonly [number, number, number, number] | null | undefined,
) => {
  const offset = index * 4
  const resolvedColor = color ?? DEFAULT_COLOR
  target[offset] = resolvedColor[0]
  target[offset + 1] = resolvedColor[1]
  target[offset + 2] = resolvedColor[2]
  target[offset + 3] = resolvedColor[3]
}

const readColor = (
  source: Uint8ClampedArray,
  index: number,
): [number, number, number, number] => {
  const offset = index * 4
  return [
    source[offset] ?? 0,
    source[offset + 1] ?? 0,
    source[offset + 2] ?? 0,
    source[offset + 3] ?? 0,
  ]
}

const asTransferableBuffer = (array: ArrayBufferView): Transferable =>
  array.buffer as ArrayBuffer

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
  renderPass,
  nodes,
  links,
  inboundLinks,
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
  renderPass: renderPass === 'preview' ? 'preview' : 'final',
  links: sanitizeLinks(links),
  inboundLinks: sanitizeLinks(inboundLinks),
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
  renderPass,
  nodes,
  links,
  inboundLinks,
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
  renderPass: renderPass === 'preview' ? 'preview' : 'final',
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

export const serializeGraphRenderModelTransferPayload = (
  model: GraphRenderModel,
): GraphRenderModelTransferPayload => {
  const nodeMeta: TransferNodeMeta[] = []
  const nodePositions = new Float32Array(model.nodes.length * 2)
  const nodeRadii = new Float32Array(model.nodes.length)
  const nodeFlags = new Uint16Array(model.nodes.length)
  const nodeFillColors = new Uint8ClampedArray(model.nodes.length * 4)
  const nodeLineColors = new Uint8ClampedArray(model.nodes.length * 4)
  const nodeBridgeHaloColors = new Uint8ClampedArray(model.nodes.length * 4)

  model.nodes.forEach((node, index) => {
    const positionOffset = index * 2
    nodePositions[positionOffset] = node.position[0]
    nodePositions[positionOffset + 1] = node.position[1]
    nodeRadii[index] = node.radius
    nodeFlags[index] =
      (node.isRoot ? NODE_FLAG_ROOT : 0) |
      (node.isExpanded ? NODE_FLAG_EXPANDED : 0) |
      (node.isSelected ? NODE_FLAG_SELECTED : 0) |
      (node.isCommonFollow ? NODE_FLAG_COMMON_FOLLOW : 0) |
      (node.bridgeHaloColor ? NODE_FLAG_HAS_BRIDGE_HALO : 0) |
      (node.isPathNode ? NODE_FLAG_PATH_NODE : 0) |
      (node.isPathEndpoint ? NODE_FLAG_PATH_ENDPOINT : 0)
    writeColor(nodeFillColors, index, node.fillColor)
    writeColor(nodeLineColors, index, node.lineColor)
    writeColor(nodeBridgeHaloColors, index, node.bridgeHaloColor)
    nodeMeta.push({
      id: node.id,
      pubkey: node.pubkey,
      displayLabel: node.displayLabel,
      pictureUrl: node.pictureUrl,
      keywordHits: node.keywordHits,
      source: node.source,
      discoveredAt: node.discoveredAt,
      sharedByExpandedCount: node.sharedByExpandedCount,
      analysisCommunityId: node.analysisCommunityId ?? null,
      pathOrder: node.pathOrder ?? null,
    })
  })

  const edgeMeta: TransferEdgeMeta[] = []
  const edgePositions = new Float32Array(model.edges.length * 4)
  const edgeRadii = new Float32Array(model.edges.length * 2)
  const edgeWeights = new Float32Array(model.edges.length)
  const edgeFlags = new Uint8Array(model.edges.length)

  model.edges.forEach((edge, index) => {
    const positionOffset = index * 4
    const radiusOffset = index * 2
    edgePositions[positionOffset] = edge.sourcePosition[0]
    edgePositions[positionOffset + 1] = edge.sourcePosition[1]
    edgePositions[positionOffset + 2] = edge.targetPosition[0]
    edgePositions[positionOffset + 3] = edge.targetPosition[1]
    edgeRadii[radiusOffset] = edge.sourceRadius
    edgeRadii[radiusOffset + 1] = edge.targetRadius
    edgeWeights[index] = edge.weight
    edgeFlags[index] =
      (edge.isPriority ? EDGE_FLAG_PRIORITY : 0) |
      (edge.isPathEdge ? EDGE_FLAG_PATH : 0)
    edgeMeta.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      targetSharedByExpandedCount: edge.targetSharedByExpandedCount,
    })
  })

  const labelMeta: TransferLabelMeta[] = []
  const labelPositions = new Float32Array(model.labels.length * 2)
  const labelRadii = new Float32Array(model.labels.length)
  const labelFlags = new Uint8Array(model.labels.length)

  model.labels.forEach((label, index) => {
    const positionOffset = index * 2
    labelPositions[positionOffset] = label.position[0]
    labelPositions[positionOffset + 1] = label.position[1]
    labelRadii[index] = label.radius
    labelFlags[index] =
      (label.isRoot ? LABEL_FLAG_ROOT : 0) |
      (label.isSelected ? LABEL_FLAG_SELECTED : 0)
    labelMeta.push({
      id: label.id,
      pubkey: label.pubkey,
      text: label.text,
    })
  })

  return {
    transferKind: 'GRAPH_RENDER_MODEL_TRANSFER',
    nodeMeta,
    nodePositions,
    nodeRadii,
    nodeFlags,
    nodeFillColors,
    nodeLineColors,
    nodeBridgeHaloColors,
    edgeMeta,
    edgePositions,
    edgeRadii,
    edgeWeights,
    edgeFlags,
    labelMeta,
    labelPositions,
    labelRadii,
    labelFlags,
    bounds: model.bounds,
    topologySignature: model.topologySignature,
    layoutKey: model.layoutKey,
    lod: model.lod,
    analysisOverlay: model.analysisOverlay,
    activeLayer: model.activeLayer,
    renderConfig: model.renderConfig,
  }
}

export const getGraphRenderModelTransferables = (
  payload: GraphRenderModelTransferPayload,
): Transferable[] => [
  asTransferableBuffer(payload.nodePositions),
  asTransferableBuffer(payload.nodeRadii),
  asTransferableBuffer(payload.nodeFlags),
  asTransferableBuffer(payload.nodeFillColors),
  asTransferableBuffer(payload.nodeLineColors),
  asTransferableBuffer(payload.nodeBridgeHaloColors),
  asTransferableBuffer(payload.edgePositions),
  asTransferableBuffer(payload.edgeRadii),
  asTransferableBuffer(payload.edgeWeights),
  asTransferableBuffer(payload.edgeFlags),
  asTransferableBuffer(payload.labelPositions),
  asTransferableBuffer(payload.labelRadii),
  asTransferableBuffer(payload.labelFlags),
]

export const isGraphRenderModelTransferPayload = (
  value: unknown,
): value is GraphRenderModelTransferPayload =>
  typeof value === 'object' &&
  value !== null &&
  'transferKind' in value &&
  value.transferKind === 'GRAPH_RENDER_MODEL_TRANSFER'

export const deserializeGraphRenderModelTransferPayload = (
  payload: GraphRenderModelTransferPayload,
): GraphRenderModel => {
  const nodes: GraphRenderNode[] = payload.nodeMeta.map((meta, index) => {
    const positionOffset = index * 2
    const flags = payload.nodeFlags[index] ?? 0

    return {
      id: meta.id,
      pubkey: meta.pubkey,
      displayLabel: meta.displayLabel,
      pictureUrl: meta.pictureUrl,
      position: [
        payload.nodePositions[positionOffset] ?? 0,
        payload.nodePositions[positionOffset + 1] ?? 0,
      ],
      radius: payload.nodeRadii[index] ?? 0,
      keywordHits: meta.keywordHits,
      isRoot: (flags & NODE_FLAG_ROOT) !== 0,
      isExpanded: (flags & NODE_FLAG_EXPANDED) !== 0,
      isSelected: (flags & NODE_FLAG_SELECTED) !== 0,
      isCommonFollow: (flags & NODE_FLAG_COMMON_FOLLOW) !== 0,
      source: meta.source,
      discoveredAt: meta.discoveredAt,
      sharedByExpandedCount: meta.sharedByExpandedCount,
      fillColor: readColor(payload.nodeFillColors, index),
      lineColor: readColor(payload.nodeLineColors, index),
      bridgeHaloColor:
        (flags & NODE_FLAG_HAS_BRIDGE_HALO) !== 0
          ? readColor(payload.nodeBridgeHaloColors, index)
          : null,
      analysisCommunityId: meta.analysisCommunityId,
      isPathNode: (flags & NODE_FLAG_PATH_NODE) !== 0,
      isPathEndpoint: (flags & NODE_FLAG_PATH_ENDPOINT) !== 0,
      pathOrder: meta.pathOrder,
    }
  })
  const edges: GraphRenderEdge[] = payload.edgeMeta.map((meta, index) => {
    const positionOffset = index * 4
    const radiusOffset = index * 2
    const flags = payload.edgeFlags[index] ?? 0

    return {
      id: meta.id,
      source: meta.source,
      target: meta.target,
      relation: meta.relation,
      weight: payload.edgeWeights[index] ?? 0,
      sourcePosition: [
        payload.edgePositions[positionOffset] ?? 0,
        payload.edgePositions[positionOffset + 1] ?? 0,
      ],
      targetPosition: [
        payload.edgePositions[positionOffset + 2] ?? 0,
        payload.edgePositions[positionOffset + 3] ?? 0,
      ],
      sourceRadius: payload.edgeRadii[radiusOffset] ?? 0,
      targetRadius: payload.edgeRadii[radiusOffset + 1] ?? 0,
      isPriority: (flags & EDGE_FLAG_PRIORITY) !== 0,
      targetSharedByExpandedCount: meta.targetSharedByExpandedCount,
      isPathEdge: (flags & EDGE_FLAG_PATH) !== 0,
    }
  })
  const labels: GraphRenderLabel[] = payload.labelMeta.map((meta, index) => {
    const positionOffset = index * 2
    const flags = payload.labelFlags[index] ?? 0

    return {
      id: meta.id,
      pubkey: meta.pubkey,
      text: meta.text,
      position: [
        payload.labelPositions[positionOffset] ?? 0,
        payload.labelPositions[positionOffset + 1] ?? 0,
      ],
      radius: payload.labelRadii[index] ?? 0,
      isRoot: (flags & LABEL_FLAG_ROOT) !== 0,
      isSelected: (flags & LABEL_FLAG_SELECTED) !== 0,
    }
  })

  return {
    nodes,
    edges,
    labels,
    accessibleNodes: nodes.map((node) => ({
      id: node.id,
      pubkey: node.pubkey,
      displayLabel: node.displayLabel,
      isRoot: node.isRoot,
      source: node.source,
    })),
    bounds: payload.bounds,
    topologySignature: payload.topologySignature,
    layoutKey: payload.layoutKey,
    lod: payload.lod,
    analysisOverlay: payload.analysisOverlay,
    activeLayer: payload.activeLayer,
    renderConfig: payload.renderConfig,
  }
}
