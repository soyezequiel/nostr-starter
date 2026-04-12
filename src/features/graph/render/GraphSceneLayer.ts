import {
  CompositeLayer,
  type DefaultProps,
  type Layer,
  type UpdateParameters,
} from '@deck.gl/core'
import { IconLayer, LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Texture } from '@luma.gl/core'

import type { RenderConfig } from '@/features/graph/app/store/types'
import type { GraphViewState } from '@/features/graph/render/graphViewState'
import {
  COMMON_FOLLOW_NODE_COLOR,
  CONNECTIONS_FOLLOW_COLOR,
  CONNECTIONS_INBOUND_COLOR,
  EXPANDED_RING_COLOR,
  HIGHLIGHT_LINK_COLOR,
  HOVER_RING_COLOR,
  LABEL_BACKGROUND_COLOR,
  LABEL_BORDER_COLOR,
  LABEL_TEXT_COLOR,
  LINK_COLOR,
  SHARED_RING_COLOR,
} from '@/features/graph/render/constants'
import {
  buildGraphSceneGeometry,
  createGraphSceneGeometrySignature,
} from '@/features/graph/render/graphSceneGeometry'
import {
  createEmptyImageRenderPayload,
  type ImageRenderPayload,
  type ImageRendererDeliverySnapshot,
  type ImageSourceHandle,
} from '@/features/graph/render/imageRuntime'
import {
  AvatarAtlasManager,
  createAvatarAtlasEntry,
} from '@/features/graph/render/avatarAtlasManager'
import {
  getVisibleArrowPlacement,
  getVisibleEdgeEndpoints,
  getVisibleNodeRadius,
  type VisibleGeometryContext,
} from '@/features/graph/render/visibleGeometry'
import type {
  GraphRenderEdge,
  GraphRenderLabel,
  GraphRenderModel,
  GraphRenderNode,
} from '@/features/graph/render/types'

const fallbackAvatarUrl = '/graph-assets/avatar-fallback.svg'

type GraphSceneLayerProps = {
  model: GraphRenderModel
  viewState: GraphViewState
  hoveredNodePubkey: string | null
  hoveredEdgeId: string | null
  hoveredEdgePubkeys: readonly string[]
  selectedNodePubkey: string | null
  visibleLabels: readonly GraphRenderLabel[]
  nodeScreenRadii: ReadonlyMap<string, number>
  imageFrame: ImageRenderPayload
  hoverPickingEnabled: boolean
  renderConfig: RenderConfig
  onAvatarRendererDelivery?: (snapshot: ImageRendererDeliverySnapshot) => void
}

const SHARED_NODE_THRESHOLD = 2

const defaultProps: DefaultProps<GraphSceneLayerProps> = {
  hoveredNodePubkey: null,
  hoveredEdgeId: null,
  hoveredEdgePubkeys: [],
  selectedNodePubkey: null,
  visibleLabels: [],
  nodeScreenRadii: new Map<string, number>(),
  imageFrame: createEmptyImageRenderPayload(),
  hoverPickingEnabled: true,
  onAvatarRendererDelivery: undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const getEdgeColor = (
  edge: Pick<
    GraphRenderEdge,
    | 'relation'
    | 'weight'
    | 'isPriority'
    | 'targetSharedByExpandedCount'
    | 'isPathEdge'
  > & { source: string; target: string },
  maxZapWeight: number,
  hoveredNodePubkey: string | null,
  hoveredEdgeId: string | null,
  selectedNodePubkey: string | null,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  const isHighlighted =
    ('id' in edge && hoveredEdgeId !== null && edge.id === hoveredEdgeId) ||
    (hoveredNodePubkey !== null &&
      (edge.source === hoveredNodePubkey || edge.target === hoveredNodePubkey)) ||
    (selectedNodePubkey !== null &&
      (edge.source === selectedNodePubkey || edge.target === selectedNodePubkey))

  if (activeLayer === 'pathfinding' && hasPathHighlight) {
    if (edge.isPathEdge) {
      return isHighlighted ? [236, 253, 245, 255] as const : [52, 211, 153, 248] as const
    }

    return isHighlighted ? [94, 234, 212, 110] as const : [71, 85, 105, 28] as const
  }

  if (isHighlighted) {
    return HIGHLIGHT_LINK_COLOR
  }

  if (activeLayer === 'connections') {
    const baseColor =
      edge.relation === 'follow' ? CONNECTIONS_FOLLOW_COLOR : CONNECTIONS_INBOUND_COLOR
    return [baseColor[0], baseColor[1], baseColor[2], 188] as const
  }

  if (edge.relation === 'follow') {
    if (
      edge.isPriority ||
      edge.targetSharedByExpandedCount < SHARED_NODE_THRESHOLD
    ) {
      return LINK_COLOR
    }

    const sharedAlpha = Math.max(
      0.12,
      0.35 - Math.log2(edge.targetSharedByExpandedCount) * 0.08,
    )

    return [
      LINK_COLOR[0],
      LINK_COLOR[1],
      LINK_COLOR[2],
      Math.round(sharedAlpha * 255),
    ] as const
  }

  if (edge.relation !== 'zap') {
    return LINK_COLOR
  }

  const normalizedWeight =
    maxZapWeight > 0 ? Math.max(0.18, edge.weight / maxZapWeight) : 0.18

  return [
    251,
    191,
    36,
    Math.round(Math.min(0.92, 0.24 + normalizedWeight * 0.6) * 255),
  ] as const
}

const getEdgeWidth = (
  edge: Pick<GraphRenderEdge, 'relation' | 'weight' | 'isPathEdge'> & {
    id: string
    source: string
    target: string
  },
  maxZapWeight: number,
  hoveredNodePubkey: string | null,
  hoveredEdgeId: string | null,
  selectedNodePubkey: string | null,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  const isHighlighted =
    (hoveredEdgeId !== null && edge.id === hoveredEdgeId) ||
    (hoveredNodePubkey !== null &&
      (edge.source === hoveredNodePubkey || edge.target === hoveredNodePubkey)) ||
    (selectedNodePubkey !== null &&
      (edge.source === selectedNodePubkey || edge.target === selectedNodePubkey))

  if (activeLayer === 'pathfinding' && hasPathHighlight) {
    if (edge.isPathEdge) {
      return isHighlighted ? 4.4 : 3.2
    }

    return isHighlighted ? 1.4 : 0.85
  }

  let baseWidth = 1
  if (activeLayer === 'connections') {
    baseWidth = 2.2
  } else if (edge.relation !== 'zap') {
    baseWidth = 1.4
  } else {
    const normalizedWeight =
      maxZapWeight > 0 ? Math.max(0.15, edge.weight / maxZapWeight) : 0.15
    baseWidth = 1.6 + normalizedWeight * 4.4
  }

  return isHighlighted ? baseWidth * 2 : baseWidth
}

const getNodeFillColor = (
  node: GraphRenderNode,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  if (activeLayer === 'pathfinding' && hasPathHighlight) {
    return node.fillColor ?? [100, 116, 139, 214]
  }

  if (node.isPathNode) {
    return node.fillColor ?? [100, 116, 139, 214]
  }

  if (
    node.isCommonFollow &&
    activeLayer !== 'connections' &&
    activeLayer !== 'following' &&
    activeLayer !== 'following-non-followers' &&
    activeLayer !== 'mutuals' &&
    activeLayer !== 'followers' &&
    activeLayer !== 'nonreciprocal-followers'
  ) {
    return COMMON_FOLLOW_NODE_COLOR
  }

  return node.fillColor ?? [100, 116, 139, 214]
}

const getNodeLineColor = (node: GraphRenderNode) => {
  return node.lineColor ?? [226, 232, 240, 118]
}

const mixColor = (
  left: readonly [number, number, number, number] | readonly [number, number, number],
  right: readonly [number, number, number, number] | readonly [number, number, number],
  ratio: number,
): [number, number, number, number] => {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const inverseRatio = 1 - clampedRatio
  const leftAlpha = left[3] ?? 255
  const rightAlpha = right[3] ?? 255

  return [
    Math.round(left[0] * inverseRatio + right[0] * clampedRatio),
    Math.round(left[1] * inverseRatio + right[1] * clampedRatio),
    Math.round(left[2] * inverseRatio + right[2] * clampedRatio),
    Math.round(leftAlpha * inverseRatio + rightAlpha * clampedRatio),
  ]
}

const GLASS_FROST_COLOR = [236, 245, 255, 255] as const
const GLASS_EDGE_COLOR = [255, 255, 255, 255] as const
const GLASS_SHADOW_COLOR = [125, 211, 252, 255] as const
const KEYWORD_MUTED_COLOR = [156, 163, 175, 255] as const

const shouldMuteKeywordMiss = (
  model: GraphRenderModel,
  node: GraphRenderNode,
) => model.activeLayer === 'keywords' && node.keywordHits <= 0

const muteKeywordMissColor = (
  color: readonly [number, number, number, number],
): [number, number, number, number] =>
  mixColor(color, KEYWORD_MUTED_COLOR, 0.78)

const getNodeGlassFillColor = (
  node: GraphRenderNode,
  paintedAvatarPubkeySet: ReadonlySet<string>,
  model: GraphRenderModel,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  const tint = getNodeFillColor(node, activeLayer, hasPathHighlight)
  const frosted = mixColor(tint, GLASS_FROST_COLOR, 0.72)
  const hasAvatarPainted = paintedAvatarPubkeySet.has(node.pubkey)
  const color = shouldMuteKeywordMiss(model, node)
    ? muteKeywordMissColor(frosted)
    : frosted

  return [
    color[0],
    color[1],
    color[2],
    hasAvatarPainted ? 88 : 122,
  ] as const
}

const getNodeGlassLineColor = (
  node: GraphRenderNode,
  paintedAvatarPubkeySet: ReadonlySet<string>,
  model: GraphRenderModel,
) => {
  const tint = getNodeLineColor(node)
  const edged = mixColor(tint, GLASS_EDGE_COLOR, 0.68)
  const hasAvatarPainted = paintedAvatarPubkeySet.has(node.pubkey)
  const color = shouldMuteKeywordMiss(model, node)
    ? muteKeywordMissColor(edged)
    : edged

  return [
    color[0],
    color[1],
    color[2],
    hasAvatarPainted ? 150 : 196,
  ] as const
}

const getNodeGlassHaloColor = (
  node: GraphRenderNode,
  paintedAvatarPubkeySet: ReadonlySet<string>,
  model: GraphRenderModel,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  const tint = getNodeFillColor(node, activeLayer, hasPathHighlight)
  const halo = mixColor(tint, GLASS_SHADOW_COLOR, 0.5)
  const hasAvatarPainted = paintedAvatarPubkeySet.has(node.pubkey)
  const color = shouldMuteKeywordMiss(model, node)
    ? muteKeywordMissColor(halo)
    : halo

  return [
    color[0],
    color[1],
    color[2],
    hasAvatarPainted ? 24 : 40,
  ] as const
}

const getNodeGlassHighlightColor = (
  node: GraphRenderNode,
  paintedAvatarPubkeySet: ReadonlySet<string>,
  model: GraphRenderModel,
  activeLayer: GraphRenderModel['activeLayer'],
  hasPathHighlight: boolean,
) => {
  const tint = getNodeFillColor(node, activeLayer, hasPathHighlight)
  const highlight = mixColor(tint, GLASS_EDGE_COLOR, 0.88)
  const hasAvatarPainted = paintedAvatarPubkeySet.has(node.pubkey)
  const color = shouldMuteKeywordMiss(model, node)
    ? muteKeywordMissColor(highlight)
    : highlight

  return [
    color[0],
    color[1],
    color[2],
    hasAvatarPainted ? 34 : 64,
  ] as const
}

const getEmphasisNodes = (
  nodes: readonly GraphRenderNode[],
  hoveredNodePubkey: string | null,
  hoveredEdgePubkeys: readonly string[],
) =>
  nodes.filter(
    (node) =>
      node.isSelected ||
      node.isExpanded ||
      node.isPathEndpoint === true ||
      node.pubkey === hoveredNodePubkey ||
      hoveredEdgePubkeys.includes(node.pubkey),
  )

const getSharedEmphasisNodes = (nodes: readonly GraphRenderNode[]) =>
  nodes.filter(
    (node) =>
      node.sharedByExpandedCount >= SHARED_NODE_THRESHOLD && !node.isRoot,
  )

const getCommonFollowNodes = (nodes: readonly GraphRenderNode[]) =>
  nodes.filter((node) => node.isCommonFollow && !node.isRoot)

const getSharedRingScale = (sharedByExpandedCount: number) =>
  Math.min(2.55, 1.45 + Math.log2(sharedByExpandedCount + 1) * 0.5)

const getSharedRingWidth = (sharedByExpandedCount: number) =>
  Math.min(4, 1.6 + Math.log2(sharedByExpandedCount + 1) * 0.95)

type DebugAvatarIconLayerProps = {
  deliveryLane: 'base' | 'hd'
  onDeliveryDebug?: (snapshot: ImageRendererDeliverySnapshot) => void
  explicitFailedPubkeys?: string[]
  emitDeliveryDebugOnDraw?: boolean
}

type GraphSceneTopologyCacheEntry = {
  signature: string
  geometry: ReturnType<typeof buildGraphSceneGeometry>
  arrowData: ReadonlyArray<ReturnType<typeof buildGraphSceneGeometry>['segments'][number]>
  maxZapWeight: number
  sharedEmphasisNodes: readonly GraphRenderNode[]
  commonFollowNodes: readonly GraphRenderNode[]
}

type GraphSceneEmphasisCacheEntry = {
  signature: string
  hasPathHighlight: boolean
  emphasisNodes: readonly GraphRenderNode[]
}

type GraphSceneImageDataCacheEntry = {
  signature: string
  paintedAvatarPubkeySet: ReadonlySet<string>
  fallbackAvatarNodes: readonly GraphRenderNode[]
  hasKeywordMatches: boolean
  keywordMutedNodes: readonly GraphRenderNode[]
  baseReadyImageSignature: string
  hdReadyImageSignature: string
  baseAvatarNodes: readonly GraphRenderNode[]
  hdAvatarNodes: readonly GraphRenderNode[]
  avatarNodesByIconId: ReadonlyMap<string, readonly GraphRenderNode[]>
  hdAvatarNodesByIconId: ReadonlyMap<string, readonly GraphRenderNode[]>
}

const rendererAvatarAtlases = new Map<string, AvatarAtlasManager>()
const graphSceneTopologyCache = new Map<string, GraphSceneTopologyCacheEntry>()
const graphSceneEmphasisCache = new Map<string, GraphSceneEmphasisCacheEntry>()
const graphSceneImageDataCache = new Map<string, GraphSceneImageDataCacheEntry>()
const imageHandleRecordSignatureCache = new WeakMap<
  Record<string, ImageSourceHandle>,
  string
>()
const HD_ATLAS_MAX_TEXTURE_SIZE = 4096
const HD_ATLAS_BUCKETS = [256, 512, 1024] as const
// Favor the first visible paint with a bounded burst, then fall back to the
// steady 2-pages-per-frame atlas cadence from the manager.
const AVATAR_ATLAS_INITIAL_BURST_PAGE_COMMITS = 4
const AVATAR_ATLAS_INITIAL_BURST_PIXEL_BUDGET = 1024 * 1024 * 4

const resolveGraphSceneTopologySignature = (model: GraphRenderModel) =>
  `${model.topologySignature}|${model.layoutKey}|${model.nodes.length}n:${model.edges.length}e`

const getGraphSceneTopologyData = (
  layerId: string,
  model: GraphRenderModel,
): GraphSceneTopologyCacheEntry => {
  const signature = resolveGraphSceneTopologySignature(model)
  const cachedEntry = graphSceneTopologyCache.get(layerId)

  if (cachedEntry && cachedEntry.signature === signature) {
    return cachedEntry
  }

  const geometrySignature = `${signature}|${createGraphSceneGeometrySignature(model.edges)}`
  const geometry = buildGraphSceneGeometry(model.edges, geometrySignature)
  const nextEntry: GraphSceneTopologyCacheEntry = {
    signature,
    geometry,
    arrowData: geometry.segments.filter((segment) => segment.progressEnd === 1),
    maxZapWeight: model.edges.reduce(
      (maxWeight, edge) => Math.max(maxWeight, edge.weight),
      0,
    ),
    sharedEmphasisNodes: getSharedEmphasisNodes(model.nodes),
    commonFollowNodes:
      model.activeLayer === 'connections' ||
      model.activeLayer === 'following' ||
      model.activeLayer === 'following-non-followers' ||
      model.activeLayer === 'mutuals' ||
      model.activeLayer === 'followers' ||
      model.activeLayer === 'nonreciprocal-followers'
        ? []
        : getCommonFollowNodes(model.nodes),
  }

  graphSceneTopologyCache.set(layerId, nextEntry)

  return nextEntry
}

const createImageHandleRecordSignature = (
  imagesByPubkey: Record<string, ImageSourceHandle>,
) => {
  const cachedSignature = imageHandleRecordSignatureCache.get(imagesByPubkey)
  if (cachedSignature !== undefined) {
    return cachedSignature
  }

  const signature = Object.entries(imagesByPubkey)
    .sort(([leftPubkey], [rightPubkey]) =>
      leftPubkey.localeCompare(rightPubkey),
    )
    .map(
      ([pubkey, handle]) =>
        `${pubkey}:${handle.key}:${handle.url}:${handle.bucket}`,
    )
    .join('|')

  imageHandleRecordSignatureCache.set(imagesByPubkey, signature)

  return signature
}

const buildAvatarNodesByIconId = (
  avatarNodes: readonly GraphRenderNode[],
  imagesByPubkey: Record<string, ImageSourceHandle>,
) => {
  const avatarNodesByIconId = new Map<string, GraphRenderNode[]>()

  for (const node of avatarNodes) {
    const iconId = imagesByPubkey[node.pubkey].key
    const iconNodes = avatarNodesByIconId.get(iconId) ?? []
    iconNodes.push(node)
    avatarNodesByIconId.set(iconId, iconNodes)
  }

  return avatarNodesByIconId
}

const getGraphSceneEmphasisData = ({
  layerId,
  model,
  hoveredNodePubkey,
  hoveredEdgePubkeys,
}: {
  layerId: string
  model: GraphRenderModel
  hoveredNodePubkey: string | null
  hoveredEdgePubkeys: readonly string[]
}): GraphSceneEmphasisCacheEntry => {
  const signature = [
    resolveGraphSceneTopologySignature(model),
    hoveredNodePubkey ?? '',
    hoveredEdgePubkeys.join(','),
  ].join('|')
  const cachedEntry = graphSceneEmphasisCache.get(layerId)

  if (cachedEntry && cachedEntry.signature === signature) {
    return cachedEntry
  }

  const nextEntry: GraphSceneEmphasisCacheEntry = {
    signature,
    hasPathHighlight: model.nodes.some((node) => node.isPathNode),
    emphasisNodes: getEmphasisNodes(
      model.nodes,
      hoveredNodePubkey,
      hoveredEdgePubkeys,
    ),
  }

  graphSceneEmphasisCache.set(layerId, nextEntry)

  return nextEntry
}

const getGraphSceneImageData = ({
  layerId,
  model,
  imageFrame,
}: {
  layerId: string
  model: GraphRenderModel
  imageFrame: ImageRenderPayload
}): GraphSceneImageDataCacheEntry => {
  const baseReadyImagesByPubkey =
    imageFrame.baseReadyImagesByPubkey ?? imageFrame.readyImagesByPubkey
  const hdReadyImagesByPubkey = imageFrame.hdReadyImagesByPubkey ?? {}
  const baseReadyImageSignature =
    createImageHandleRecordSignature(baseReadyImagesByPubkey)
  const hdReadyImageSignature =
    createImageHandleRecordSignature(hdReadyImagesByPubkey)
  const paintedAvatarPubkeysSignature = imageFrame.paintedPubkeys.join(',')
  const signature = [
    resolveGraphSceneTopologySignature(model),
    model.activeLayer,
    paintedAvatarPubkeysSignature,
    baseReadyImageSignature,
    hdReadyImageSignature,
  ].join('|')
  const cachedEntry = graphSceneImageDataCache.get(layerId)

  if (cachedEntry && cachedEntry.signature === signature) {
    return cachedEntry
  }

  const paintedAvatarPubkeySet = new Set(imageFrame.paintedPubkeys)
  const fallbackAvatarNodes = model.nodes.filter(
    (node) => !paintedAvatarPubkeySet.has(node.pubkey),
  )
  const hasKeywordMatches =
    model.activeLayer === 'keywords' &&
    model.nodes.some((node) => node.keywordHits > 0)
  const keywordMutedNodes = hasKeywordMatches
    ? model.nodes.filter((node) => node.keywordHits <= 0)
    : []
  const baseAvatarNodes = model.nodes.filter(
    (node) => baseReadyImagesByPubkey[node.pubkey] !== undefined,
  )
  const hdAvatarNodes = model.nodes.filter(
    (node) => hdReadyImagesByPubkey[node.pubkey] !== undefined,
  )
  const nextEntry: GraphSceneImageDataCacheEntry = {
    signature,
    paintedAvatarPubkeySet,
    fallbackAvatarNodes,
    hasKeywordMatches,
    keywordMutedNodes,
    baseReadyImageSignature,
    hdReadyImageSignature,
    baseAvatarNodes,
    hdAvatarNodes,
    avatarNodesByIconId: buildAvatarNodesByIconId(
      baseAvatarNodes,
      baseReadyImagesByPubkey,
    ),
    hdAvatarNodesByIconId: buildAvatarNodesByIconId(
      hdAvatarNodes,
      hdReadyImagesByPubkey,
    ),
  }

  graphSceneImageDataCache.set(layerId, nextEntry)

  return nextEntry
}

const getRendererAvatarAtlas = (
  layerId: string,
  options?: ConstructorParameters<typeof AvatarAtlasManager>[0],
) => {
  let atlas = rendererAvatarAtlases.get(layerId)

  if (!atlas) {
    atlas = new AvatarAtlasManager(options)
    rendererAvatarAtlases.set(layerId, atlas)
  }

  return atlas
}

const coerceIconAtlasTexture = (canvas: HTMLCanvasElement) =>
  // Deck.GL acepta canvas/image sources en runtime, pero su typing de `iconAtlas`
  // sigue restringido a `string | Texture` para el camino prepacked.
  canvas as unknown as Texture

class RendererAvatarDeliveryAggregator {
  private readonly snapshotsByPageId = new Map<string, ImageRendererDeliverySnapshot>()
  private explicitFailedPubkeys: string[] = []
  private listener?: (snapshot: ImageRendererDeliverySnapshot) => void
  private emittedSignature = ''

  public setListener(listener?: (snapshot: ImageRendererDeliverySnapshot) => void) {
    this.listener = listener
  }

  public setExplicitFailedPubkeys(pubkeys: string[]) {
    this.explicitFailedPubkeys = [...new Set(pubkeys)].sort()
    this.emit()
  }

  public pruneVisiblePages(visiblePageIds: ReadonlySet<string>) {
    let changed = false

    for (const pageId of this.snapshotsByPageId.keys()) {
      if (!visiblePageIds.has(pageId)) {
        this.snapshotsByPageId.delete(pageId)
        changed = true
      }
    }

    if (changed) {
      this.emit()
    }
  }

  public reportPage(pageId: string, snapshot: ImageRendererDeliverySnapshot) {
    this.snapshotsByPageId.set(pageId, {
      paintedPubkeys: [...new Set(snapshot.paintedPubkeys)].sort(),
      basePaintedPubkeys: [...new Set(snapshot.basePaintedPubkeys ?? [])].sort(),
      hdPaintedPubkeys: [...new Set(snapshot.hdPaintedPubkeys ?? [])].sort(),
      failedPubkeys: [...new Set(snapshot.failedPubkeys)].sort(),
    })
    this.emit()
  }

  private emit() {
    if (!this.listener) {
      return
    }

    const paintedPubkeys = new Set<string>()
    const basePaintedPubkeys = new Set<string>()
    const hdPaintedPubkeys = new Set<string>()
    const failedPubkeys = new Set(this.explicitFailedPubkeys)

    for (const snapshot of this.snapshotsByPageId.values()) {
      for (const pubkey of snapshot.paintedPubkeys) {
        paintedPubkeys.add(pubkey)
      }
      for (const pubkey of snapshot.basePaintedPubkeys ?? []) {
        basePaintedPubkeys.add(pubkey)
        paintedPubkeys.add(pubkey)
      }
      for (const pubkey of snapshot.hdPaintedPubkeys ?? []) {
        hdPaintedPubkeys.add(pubkey)
        paintedPubkeys.add(pubkey)
      }
      for (const pubkey of snapshot.failedPubkeys) {
        failedPubkeys.add(pubkey)
      }
    }

    const nextSnapshot = {
      paintedPubkeys: [...paintedPubkeys].sort(),
      basePaintedPubkeys: [...basePaintedPubkeys].sort(),
      hdPaintedPubkeys: [...hdPaintedPubkeys].sort(),
      failedPubkeys: [...failedPubkeys].sort(),
    }
    const nextSignature = [
      nextSnapshot.paintedPubkeys.join(','),
      nextSnapshot.basePaintedPubkeys.join(','),
      nextSnapshot.hdPaintedPubkeys.join(','),
      nextSnapshot.failedPubkeys.join(','),
    ].join('|')

    if (nextSignature === this.emittedSignature) {
      return
    }

    this.emittedSignature = nextSignature
    this.listener(nextSnapshot)
  }
}

const rendererAvatarDeliveryAggregators = new Map<
  string,
  RendererAvatarDeliveryAggregator
>()

const getRendererAvatarDeliveryAggregator = (layerId: string) => {
  let aggregator = rendererAvatarDeliveryAggregators.get(layerId)

  if (!aggregator) {
    aggregator = new RendererAvatarDeliveryAggregator()
    rendererAvatarDeliveryAggregators.set(layerId, aggregator)
  }

  return aggregator
}

class DebugAvatarIconLayer extends IconLayer<
  GraphRenderNode,
  DebugAvatarIconLayerProps
> {
  public static layerName = 'DebugAvatarIconLayer'

  private lastDeliverySignature = ''

  public override updateState(params: UpdateParameters<this>) {
    super.updateState(params)
    this.emitDeliveryDebug()
  }

  public override draw({ uniforms }: { uniforms: unknown }) {
    super.draw({ uniforms })
    if (this.props.emitDeliveryDebugOnDraw === true) {
      this.emitDeliveryDebug()
    }
  }

  // Una capa cuenta como pintada recien cuando deck.gl termino de cargar
  // su textura. Los fallos explicitos llegan desde el runtime/atlas controlado.
  private emitDeliveryDebug() {
    const onDeliveryDebug = this.props.onDeliveryDebug
    if (!onDeliveryDebug) {
      return
    }
    const avatarNodes = Array.isArray(this.props.data)
      ? this.props.data
      : Array.from(this.props.data as Iterable<GraphRenderNode>)
    const paintedPubkeys = this.isLoaded
      ? avatarNodes.map((node) => node.pubkey).sort()
      : []
    const basePaintedPubkeys =
      this.props.deliveryLane === 'base' ? paintedPubkeys : []
    const hdPaintedPubkeys =
      this.props.deliveryLane === 'hd' ? paintedPubkeys : []
    const failedPubkeys = [...(this.props.explicitFailedPubkeys ?? [])].sort()

    const nextSignature = [
      paintedPubkeys.join(','),
      basePaintedPubkeys.join(','),
      hdPaintedPubkeys.join(','),
      failedPubkeys.join(','),
    ].join('|')
    if (nextSignature === this.lastDeliverySignature) {
      return
    }

    this.lastDeliverySignature = nextSignature
    onDeliveryDebug({
      paintedPubkeys,
      basePaintedPubkeys,
      hdPaintedPubkeys,
      failedPubkeys,
    })
  }
}

export class GraphSceneLayer extends CompositeLayer<GraphSceneLayerProps> {
  public static defaultProps = defaultProps

  public static layerName = 'GraphSceneLayer'

  public renderLayers(): Layer[] {
    const {
      model,
      viewState,
      hoveredNodePubkey,
      hoveredEdgeId,
      hoveredEdgePubkeys,
      selectedNodePubkey,
      visibleLabels,
      nodeScreenRadii,
      renderConfig,
      imageFrame,
      hoverPickingEnabled,
      onAvatarRendererDelivery,
    } = this.props
    const topologyData = getGraphSceneTopologyData(this.props.id, model)
    const { hasPathHighlight, emphasisNodes } = getGraphSceneEmphasisData({
      layerId: this.props.id,
      model,
      hoveredNodePubkey,
      hoveredEdgePubkeys,
    })
    const {
      maxZapWeight,
      sharedEmphasisNodes,
      commonFollowNodes,
      arrowData,
    } =
      topologyData
    const { segments } = topologyData.geometry
    const nodeSizeFactor = renderConfig.nodeSizeFactor ?? 1
    const getScreenRadius = (pubkey: string, fallbackRadius: number) =>
      getVisibleNodeRadius({
        pubkey,
        fallbackRadius,
        nodeScreenRadii,
        nodeSizeFactor,
      })
    const nodeByPubkey = new Map(model.nodes.map((node) => [node.pubkey, node]))
    const visibleGeometryContext: VisibleGeometryContext = {
      nodeByPubkey,
      nodeScreenRadii,
      nodeSizeFactor,
      viewState,
    }
    const getSegmentPositions = (
      segment: (typeof segments)[number],
    ) =>
      getVisibleEdgeEndpoints({
        segment,
        context: visibleGeometryContext,
      })

    const edgeThickness = renderConfig.edgeThickness ?? 1
    const arrowType = renderConfig.arrowType ?? 'none'
    const baseReadyImagesByPubkey =
      imageFrame.baseReadyImagesByPubkey ?? imageFrame.readyImagesByPubkey
    const hdReadyImagesByPubkey = imageFrame.hdReadyImagesByPubkey ?? {}
    const {
      paintedAvatarPubkeySet,
      fallbackAvatarNodes,
      keywordMutedNodes,
      baseReadyImageSignature,
      hdReadyImageSignature,
      baseAvatarNodes,
      hdAvatarNodes,
      avatarNodesByIconId,
      hdAvatarNodesByIconId,
    } = getGraphSceneImageData({
      layerId: this.props.id,
      model,
      imageFrame,
    })

    const visibleArrowData =
      arrowType !== 'none' && model.activeLayer !== 'mutuals' ? arrowData : []

    const baseAvatarLayerId = `${this.props.id}-avatars-base`
    const avatarAtlas = getRendererAvatarAtlas(baseAvatarLayerId, {
      maxBurstPageCommitsPerFrame: AVATAR_ATLAS_INITIAL_BURST_PAGE_COMMITS,
      burstCommitPixelBudget: AVATAR_ATLAS_INITIAL_BURST_PIXEL_BUDGET,
    })
    avatarAtlas.setSnapshotChangeListener(() => {
      this.setNeedsUpdate()
      this.setNeedsRedraw()
    })
    const avatarAtlasSnapshot = avatarAtlas.updateVisibleEntries({
      entries: baseAvatarNodes.map((node) =>
        createAvatarAtlasEntry({
          pubkey: node.pubkey,
          handle: baseReadyImagesByPubkey[node.pubkey],
        }),
      ),
    })
    const avatarDeliveryAggregator = getRendererAvatarDeliveryAggregator(
      `${this.props.id}-avatars`,
    )
    avatarDeliveryAggregator.setListener(onAvatarRendererDelivery)
    avatarDeliveryAggregator.setExplicitFailedPubkeys(
      avatarAtlasSnapshot.delivery.failedPubkeys,
    )
    const visibleAvatarPageIds = new Set<string>()
    const avatarLayers =
      avatarAtlasSnapshot.pages.length > 0
        ? avatarAtlasSnapshot.pages.map((page) => {
            const pageNodes = [...new Set(page.iconIds)].flatMap(
              (iconId) => avatarNodesByIconId.get(iconId) ?? [],
            )
            const pageLayerId = `${baseAvatarLayerId}-${page.key}`
            visibleAvatarPageIds.add(pageLayerId)

            const layerProps = {
              id: pageLayerId,
              data: pageNodes,
              pickable: false,
              iconAtlas: coerceIconAtlasTexture(page.iconAtlas),
              iconMapping: page.iconMapping,
              sizeUnits: 'pixels' as const,
              getPosition: (node: GraphRenderNode) => node.position,
              getSize: (node: GraphRenderNode) =>
                getScreenRadius(node.pubkey, node.radius) * 2,
              // En modo prepacked, `getIcon` devuelve solo la key del mapping estable que
              // arma nuestro atlas controlado base. Evitamos el auto-packing opaco de deck.gl.
              getIcon: (node: GraphRenderNode) =>
                baseReadyImagesByPubkey[node.pubkey].key,
              updateTriggers: {
                getSize: [nodeScreenRadii, nodeSizeFactor],
                getIcon: [baseReadyImageSignature, page.revision, page.key],
              },
            }

            return new DebugAvatarIconLayer({
              ...layerProps,
              deliveryLane: 'base',
              explicitFailedPubkeys: [],
              onDeliveryDebug: (snapshot) => {
                avatarDeliveryAggregator.reportPage(pageLayerId, snapshot)
              },
            })
          })
        : []
    const hdAtlasLayerId = `${this.props.id}-avatars-hd`
    const hdAvatarAtlas = getRendererAvatarAtlas(hdAtlasLayerId, {
      maxWidth: HD_ATLAS_MAX_TEXTURE_SIZE,
      maxHeight: HD_ATLAS_MAX_TEXTURE_SIZE,
      supportedBuckets: HD_ATLAS_BUCKETS,
      maxBurstPageCommitsPerFrame: AVATAR_ATLAS_INITIAL_BURST_PAGE_COMMITS,
      burstCommitPixelBudget: AVATAR_ATLAS_INITIAL_BURST_PIXEL_BUDGET,
    })
    hdAvatarAtlas.setSnapshotChangeListener(() => {
      this.setNeedsUpdate()
      this.setNeedsRedraw()
    })
    const hdAvatarAtlasSnapshot = hdAvatarAtlas.updateVisibleEntries({
      // Full HD already usa variantes listas del runtime; aca solo evitamos el
      // auto-packing interno de deck.gl para no crecer una sola textura vertical
      // con iconos 1024x1024 y terminar en quads negros.
      entries: hdAvatarNodes.map((node) =>
        createAvatarAtlasEntry({
          pubkey: node.pubkey,
          handle: hdReadyImagesByPubkey[node.pubkey],
        }),
      ),
    })
    const hdAvatarLayers =
      hdAvatarAtlasSnapshot.pages.length > 0
        ? hdAvatarAtlasSnapshot.pages.map((page) => {
            const pageNodes = [...new Set(page.iconIds)].flatMap(
              (iconId) => hdAvatarNodesByIconId.get(iconId) ?? [],
            )
            const pageLayerId = `${hdAtlasLayerId}-${page.key}`
            visibleAvatarPageIds.add(pageLayerId)

            return new DebugAvatarIconLayer({
              id: pageLayerId,
              data: pageNodes,
              deliveryLane: 'hd',
              pickable: false,
              iconAtlas: coerceIconAtlasTexture(page.iconAtlas),
              iconMapping: page.iconMapping,
              sizeUnits: 'pixels',
              getPosition: (node: GraphRenderNode) => node.position,
              getSize: (node: GraphRenderNode) =>
                getScreenRadius(node.pubkey, node.radius) * 2,
              getIcon: (node: GraphRenderNode) =>
                hdReadyImagesByPubkey[node.pubkey].key,
              updateTriggers: {
                getSize: [nodeScreenRadii, nodeSizeFactor],
                getIcon: [hdReadyImageSignature, page.revision, page.key],
              },
              explicitFailedPubkeys: [],
              onDeliveryDebug: (snapshot) => {
                avatarDeliveryAggregator.reportPage(pageLayerId, snapshot)
              },
            })
          })
        : []
    avatarDeliveryAggregator.pruneVisiblePages(visibleAvatarPageIds)

    return [
      new LineLayer({
        id: `${this.props.id}-edges`,
        data: segments,
        pickable: hoverPickingEnabled,
        widthUnits: 'pixels',
        getSourcePosition: (segment) => getSegmentPositions(segment).sourcePosition,
        getTargetPosition: (segment) => getSegmentPositions(segment).targetPosition,
        getColor: (segment) => {
          const baseColor = getEdgeColor(
            segment,
            maxZapWeight,
            hoveredNodePubkey,
            hoveredEdgeId,
            selectedNodePubkey,
            model.activeLayer,
            hasPathHighlight,
          )

          if (model.activeLayer === 'connections') {
            return baseColor
          }

          const progress =
            ((segment.progressStart ?? 1) + (segment.progressEnd ?? 1)) / 2
          const fadedAlpha = Math.max(
            0,
            Math.round(baseColor[3] * progress * progress),
          )

          return [baseColor[0], baseColor[1], baseColor[2], fadedAlpha]
        },
          getWidth: (segment) =>
            getEdgeWidth(
              segment,
              maxZapWeight,
              hoveredNodePubkey,
              hoveredEdgeId,
              selectedNodePubkey,
              model.activeLayer,
              hasPathHighlight,
            ) * edgeThickness,
        updateTriggers: {
          getColor: [
            hoveredNodePubkey,
            hoveredEdgeId,
            selectedNodePubkey,
            model.activeLayer,
            hasPathHighlight,
          ],
          getWidth: [
            hoveredNodePubkey,
            hoveredEdgeId,
            selectedNodePubkey,
            model.activeLayer,
            hasPathHighlight,
          ],
        },
      }),
      ...(visibleArrowData.length > 0
        ? [
            new TextLayer({
              id: `${this.props.id}-arrows`,
              data: visibleArrowData,
              pickable: false,
              sizeUnits: 'pixels',
              getPosition: (segment) =>
                getVisibleArrowPlacement({
                  segment,
                  context: visibleGeometryContext,
                }).position,
              getAngle: (segment) =>
                getVisibleArrowPlacement({
                  segment,
                  context: visibleGeometryContext,
                }).angle,
              getText: () => (arrowType === 'triangle' ? '▶' : '➤'),
              getColor: (segment) => {
                const color = getEdgeColor(
                  segment,
                  maxZapWeight,
                  hoveredNodePubkey,
                  hoveredEdgeId,
                  selectedNodePubkey,
                  model.activeLayer,
                  hasPathHighlight,
                )
                return [color[0], color[1], color[2], 200]
              },
              getSize: (segment) =>
                getEdgeWidth(
                  segment,
                  maxZapWeight,
                  hoveredNodePubkey,
                  hoveredEdgeId,
                  selectedNodePubkey,
                  model.activeLayer,
                  hasPathHighlight,
                ) *
                  edgeThickness *
                  6 +
                4,
              getTextAnchor: 'end',
              getAlignmentBaseline: 'center',
              fontFamily: 'system-ui, sans-serif',
              characterSet: 'auto',
              updateTriggers: {
                getColor: [
                  hoveredNodePubkey,
                  hoveredEdgeId,
                  selectedNodePubkey,
                  model.activeLayer,
                  hasPathHighlight,
                ],
                getSize: [
                  hoveredNodePubkey,
                  hoveredEdgeId,
                  selectedNodePubkey,
                  model.activeLayer,
                  hasPathHighlight,
                ],
              },
            }),
          ]
        : []),
      ...(hasPathHighlight
        ? [
            new ScatterplotLayer<GraphRenderNode>({
              id: `${this.props.id}-path-emphasis`,
              data: model.nodes.filter((node) => node.isPathNode),
              pickable: false,
              stroked: true,
              filled: true,
              radiusUnits: 'pixels',
              lineWidthUnits: 'pixels',
              getPosition: (node) => node.position,
              getRadius: (node) =>
                getScreenRadius(node.pubkey, node.radius) *
                (node.isPathEndpoint ? 1.78 : 1.38),
              getFillColor: (node) =>
                node.isPathEndpoint ? [167, 243, 208, 74] : [56, 189, 248, 34],
              getLineColor: (node) =>
                node.isPathEndpoint ? [167, 243, 208, 220] : [125, 211, 252, 172],
              getLineWidth: (node) => (node.isPathEndpoint ? 3.2 : 2),
              updateTriggers: {
                getRadius: [nodeScreenRadii, nodeSizeFactor, model.nodes],
              },
            }),
          ]
        : []),
      new ScatterplotLayer<GraphRenderNode>({
        id: `${this.props.id}-emphasis`,
        data: emphasisNodes,
        pickable: false,
        stroked: true,
        filled: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) =>
          getScreenRadius(node.pubkey, node.radius) *
          (node.isSelected || hoveredEdgePubkeys.includes(node.pubkey)
            ? 2
            : node.pubkey === hoveredNodePubkey
              ? 2.1
              : 1.72),
        getFillColor: (node) =>
          node.pubkey === hoveredNodePubkey || hoveredEdgePubkeys.includes(node.pubkey)
            ? HOVER_RING_COLOR
            : [148, 163, 184, 30],
        getLineColor: (node) =>
          node.pubkey === hoveredNodePubkey || hoveredEdgePubkeys.includes(node.pubkey)
            ? HOVER_RING_COLOR
            : EXPANDED_RING_COLOR,
        getLineWidth: (node) =>
          hoveredEdgePubkeys.includes(node.pubkey) ? 2.6 : 2,
        updateTriggers: {
          getRadius: [
            nodeScreenRadii,
            nodeSizeFactor,
            hoveredNodePubkey,
            hoveredEdgePubkeys.join(','),
          ],
        },
      }),
      ...(renderConfig.showSharedEmphasis === true
        ? [
            new ScatterplotLayer<GraphRenderNode>({
              id: `${this.props.id}-shared-emphasis-${renderConfig.showSharedEmphasis}`,
              data: sharedEmphasisNodes,
              pickable: false,
              stroked: true,
              filled: false,
              radiusUnits: 'pixels',
              lineWidthUnits: 'pixels',
              getPosition: (node) => node.position,
              getRadius: (node) =>
                getScreenRadius(node.pubkey, node.radius) *
                getSharedRingScale(node.sharedByExpandedCount),
              getLineColor: () => SHARED_RING_COLOR,
              getLineWidth: (node) =>
                getSharedRingWidth(node.sharedByExpandedCount),
              updateTriggers: {
                getRadius: [nodeScreenRadii, nodeSizeFactor],
              },
            }),
          ]
        : []),
      new ScatterplotLayer<GraphRenderNode>({
        id: `${this.props.id}-common-follow-emphasis`,
        data: commonFollowNodes,
        pickable: false,
        stroked: true,
        filled: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) => getScreenRadius(node.pubkey, node.radius) * 1.2,
        getFillColor: () => [167, 243, 208, 100],
        getLineColor: () => [167, 243, 208, 220],
        getLineWidth: 3,
        updateTriggers: {
          getRadius: [nodeScreenRadii, nodeSizeFactor, model.nodes],
        },
      }),
      new ScatterplotLayer<GraphRenderNode>({
        id: `${this.props.id}-node-glass-halo`,
        data: model.nodes,
        pickable: false,
        stroked: false,
        filled: true,
        radiusUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) => getScreenRadius(node.pubkey, node.radius) * 1.14,
        getFillColor: (node) =>
          getNodeGlassHaloColor(
            node,
            paintedAvatarPubkeySet,
            model,
            model.activeLayer,
            hasPathHighlight,
          ),
        updateTriggers: {
          getRadius: [nodeScreenRadii, nodeSizeFactor],
          getFillColor: [
            imageFrame.paintedPubkeys.join(','),
            model.activeLayer,
            hasPathHighlight,
          ],
        },
      }),
      new ScatterplotLayer<GraphRenderNode>({
        id: `${this.props.id}-nodes`,
        data: model.nodes,
        pickable: true,
        stroked: true,
        filled: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) => getScreenRadius(node.pubkey, node.radius),
        getFillColor: (node) =>
          getNodeGlassFillColor(
            node,
            paintedAvatarPubkeySet,
            model,
            model.activeLayer,
            hasPathHighlight,
          ),
        getLineColor: (node) =>
          getNodeGlassLineColor(node, paintedAvatarPubkeySet, model),
        getLineWidth: (node) =>
          node.isRoot
            ? 2.2
            : paintedAvatarPubkeySet.has(node.pubkey)
              ? 1.35
              : 1.15,
        updateTriggers: {
          getRadius: [nodeScreenRadii, nodeSizeFactor],
          getFillColor: [
            imageFrame.paintedPubkeys.join(','),
            model.activeLayer,
            hasPathHighlight,
          ],
          getLineColor: [imageFrame.paintedPubkeys.join(','), model.activeLayer],
          getLineWidth: [imageFrame.paintedPubkeys.join(',')],
        },
      }),
      new ScatterplotLayer<GraphRenderNode>({
        id: `${this.props.id}-node-glass-highlight`,
        data: model.nodes,
        pickable: false,
        stroked: false,
        filled: true,
        radiusUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) => getScreenRadius(node.pubkey, node.radius) * 0.72,
        getFillColor: (node) =>
          getNodeGlassHighlightColor(
            node,
            paintedAvatarPubkeySet,
            model,
            model.activeLayer,
            hasPathHighlight,
          ),
        updateTriggers: {
          getRadius: [nodeScreenRadii, nodeSizeFactor],
          getFillColor: [
            imageFrame.paintedPubkeys.join(','),
            model.activeLayer,
            hasPathHighlight,
          ],
        },
      }),
      new IconLayer<GraphRenderNode>({
        id: `${this.props.id}-fallback-avatars`,
        data: fallbackAvatarNodes,
        pickable: false,
        sizeUnits: 'pixels',
        getPosition: (node) => node.position,
        getSize: (node) => getScreenRadius(node.pubkey, node.radius) * 2,
        getIcon: () => ({
          id: 'fallback-avatar',
          url: fallbackAvatarUrl,
          width: 128,
          height: 128,
          mask: false,
        }),
        updateTriggers: {
          getSize: [nodeScreenRadii, nodeSizeFactor],
        },
      }),
      ...avatarLayers,
      ...hdAvatarLayers,
      ...(keywordMutedNodes.length > 0
        ? [
            new ScatterplotLayer<GraphRenderNode>({
              id: `${this.props.id}-keyword-muted-overlay`,
              data: keywordMutedNodes,
              pickable: false,
              stroked: false,
              filled: true,
              radiusUnits: 'pixels',
              getPosition: (node) => node.position,
              getRadius: (node) =>
                getScreenRadius(node.pubkey, node.radius) * 0.98,
              getFillColor: () => [148, 163, 184, 132],
              updateTriggers: {
                getRadius: [nodeScreenRadii, nodeSizeFactor],
              },
            }),
          ]
        : []),
      new TextLayer<GraphRenderLabel>({
        id: `${this.props.id}-labels`,
        data: visibleLabels,
        pickable: hoverPickingEnabled,
        background: true,
        sizeUnits: 'pixels',
        getPosition: (label) => label.position,
        getText: (label) => label.text,
        getColor: () => LABEL_TEXT_COLOR,
        getSize: (label) => (label.isRoot ? 14 : 13),
        getPixelOffset: (label) => [
          0,
          getScreenRadius(label.pubkey, label.radius) + 8,
        ],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        getBackgroundColor: () => LABEL_BACKGROUND_COLOR,
        getBorderColor: () => LABEL_BORDER_COLOR,
        getBorderWidth: 0.8,
        backgroundBorderRadius: 8,
        backgroundPadding: [6, 3],
        fontFamily: 'Space Grotesk, ui-sans-serif, system-ui, sans-serif',
        characterSet: 'auto',
      }),
    ]
  }
}
