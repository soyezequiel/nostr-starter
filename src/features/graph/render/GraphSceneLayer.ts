import {
  CompositeLayer,
  type DefaultProps,
  type Layer,
  type UpdateParameters,
} from '@deck.gl/core'
import { IconLayer, LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Texture } from '@luma.gl/core'

import type { RenderConfig } from '@/features/graph/app/store/types'
import {
  COMMON_FOLLOW_NODE_COLOR,
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
} from '@/features/graph/render/imageRuntime'
import { AvatarAtlasManager } from '@/features/graph/render/avatarAtlasManager'
import type {
  GraphRenderEdge,
  GraphRenderLabel,
  GraphRenderModel,
  GraphRenderNode,
} from '@/features/graph/render/types'

const fallbackAvatarUrl = '/graph-assets/avatar-fallback.svg'

type GraphSceneLayerProps = {
  model: GraphRenderModel
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
    'relation' | 'weight' | 'isPriority' | 'targetSharedByExpandedCount'
  > & { source: string; target: string },
  maxZapWeight: number,
  hoveredNodePubkey: string | null,
  hoveredEdgeId: string | null,
  selectedNodePubkey: string | null,
) => {
  const isHighlighted =
    ('id' in edge && hoveredEdgeId !== null && edge.id === hoveredEdgeId) ||
    (hoveredNodePubkey !== null &&
      (edge.source === hoveredNodePubkey || edge.target === hoveredNodePubkey)) ||
    (selectedNodePubkey !== null &&
      (edge.source === selectedNodePubkey || edge.target === selectedNodePubkey))

  if (isHighlighted) {
    return HIGHLIGHT_LINK_COLOR
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
  edge: Pick<GraphRenderEdge, 'relation' | 'weight'> & {
    id: string
    source: string
    target: string
  },
  maxZapWeight: number,
  hoveredNodePubkey: string | null,
  hoveredEdgeId: string | null,
  selectedNodePubkey: string | null,
) => {
  const isHighlighted =
    (hoveredEdgeId !== null && edge.id === hoveredEdgeId) ||
    (hoveredNodePubkey !== null &&
      (edge.source === hoveredNodePubkey || edge.target === hoveredNodePubkey)) ||
    (selectedNodePubkey !== null &&
      (edge.source === selectedNodePubkey || edge.target === selectedNodePubkey))

  let baseWidth = 1
  if (edge.relation !== 'zap') {
    baseWidth = edge.relation === 'follow' ? 1.4 : 1
  } else {
    const normalizedWeight =
      maxZapWeight > 0 ? Math.max(0.15, edge.weight / maxZapWeight) : 0.15
    baseWidth = 1.6 + normalizedWeight * 4.4
  }

  return isHighlighted ? baseWidth * 2 : baseWidth
}

const getNodeFillColor = (node: GraphRenderNode) => {
  if (node.isCommonFollow) {
    return COMMON_FOLLOW_NODE_COLOR
  }

  return node.fillColor ?? [100, 116, 139, 214]
}

const getNodeLineColor = (node: GraphRenderNode) => {
  return node.lineColor ?? [226, 232, 240, 118]
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
}

type GraphSceneTopologyCacheEntry = {
  signature: string
  geometry: ReturnType<typeof buildGraphSceneGeometry>
  arrowData: ReadonlyArray<
    ReturnType<typeof buildGraphSceneGeometry>['segments'][number] & {
      angle: number
    }
  >
  maxZapWeight: number
  sharedEmphasisNodes: readonly GraphRenderNode[]
  commonFollowNodes: readonly GraphRenderNode[]
}

const rendererAvatarAtlases = new Map<string, AvatarAtlasManager>()
const graphSceneTopologyCache = new Map<string, GraphSceneTopologyCacheEntry>()
const HD_ATLAS_MAX_TEXTURE_SIZE = 4096
const HD_ATLAS_BUCKETS = [256, 512, 1024] as const

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
    arrowData: geometry.segments
      .filter((segment) => segment.progressEnd === 1)
      .map((segment) => {
        const dx = segment.targetPosition[0] - segment.sourcePosition[0]
        const dy = segment.targetPosition[1] - segment.sourcePosition[1]

        return {
          ...segment,
          angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        }
      }),
    maxZapWeight: model.edges.reduce(
      (maxWeight, edge) => Math.max(maxWeight, edge.weight),
      0,
    ),
    sharedEmphasisNodes: getSharedEmphasisNodes(model.nodes),
    commonFollowNodes: getCommonFollowNodes(model.nodes),
  }

  graphSceneTopologyCache.set(layerId, nextEntry)

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
    this.emitDeliveryDebug()
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
    const emphasisNodes = getEmphasisNodes(
      model.nodes,
      hoveredNodePubkey,
      hoveredEdgePubkeys,
    )
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
      (nodeScreenRadii.get(pubkey) ?? fallbackRadius) * nodeSizeFactor

    const edgeThickness = renderConfig.edgeThickness ?? 1
    const arrowType = renderConfig.arrowType ?? 'none'
    const baseReadyImagesByPubkey =
      imageFrame.baseReadyImagesByPubkey ?? imageFrame.readyImagesByPubkey
    const hdReadyImagesByPubkey = imageFrame.hdReadyImagesByPubkey ?? {}
    const paintedAvatarPubkeySet = new Set(imageFrame.paintedPubkeys)
    const fallbackAvatarNodes = model.nodes.filter(
      (node) => !paintedAvatarPubkeySet.has(node.pubkey),
    )
    const baseReadyImageSignature = Object.entries(baseReadyImagesByPubkey)
      .sort(([leftPubkey], [rightPubkey]) =>
        leftPubkey.localeCompare(rightPubkey),
      )
      .map(
        ([pubkey, handle]) =>
          `${pubkey}:${handle.key}:${handle.url}:${handle.bucket}`,
      )
      .join('|')
    const hdReadyImageSignature = Object.entries(hdReadyImagesByPubkey)
      .sort(([leftPubkey], [rightPubkey]) =>
        leftPubkey.localeCompare(rightPubkey),
      )
      .map(
        ([pubkey, handle]) =>
          `${pubkey}:${handle.key}:${handle.url}:${handle.bucket}`,
      )
      .join('|')

    const visibleArrowData = arrowType !== 'none' ? arrowData : []

    const baseAvatarNodes = model.nodes.filter(
      (node) => baseReadyImagesByPubkey[node.pubkey] !== undefined,
    )
    const hdAvatarNodes = model.nodes.filter(
      (node) => hdReadyImagesByPubkey[node.pubkey] !== undefined,
    )
    const baseAvatarLayerId = `${this.props.id}-avatars-base`
    const avatarAtlas = getRendererAvatarAtlas(baseAvatarLayerId)
    avatarAtlas.setSnapshotChangeListener(() => {
      this.setNeedsUpdate()
    })
    const avatarAtlasSnapshot = avatarAtlas.updateVisibleEntries({
      entries: baseAvatarNodes.map((node) => {
        const handle = baseReadyImagesByPubkey[node.pubkey]

        return {
          pubkey: node.pubkey,
          icon: {
            id: handle.key,
            url: handle.url,
            width: handle.bucket,
            height: handle.bucket,
            mask: false,
          },
        }
      }),
    })
    const avatarDeliveryAggregator = getRendererAvatarDeliveryAggregator(
      `${this.props.id}-avatars`,
    )
    avatarDeliveryAggregator.setListener(onAvatarRendererDelivery)
    avatarDeliveryAggregator.setExplicitFailedPubkeys(
      avatarAtlasSnapshot.delivery.failedPubkeys,
    )
    const avatarNodesByIconId = new Map<string, GraphRenderNode[]>()
    for (const node of baseAvatarNodes) {
      const iconId = baseReadyImagesByPubkey[node.pubkey].key
      const iconNodes = avatarNodesByIconId.get(iconId) ?? []
      iconNodes.push(node)
      avatarNodesByIconId.set(iconId, iconNodes)
    }
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
    })
    hdAvatarAtlas.setSnapshotChangeListener(() => {
      this.setNeedsUpdate()
    })
    const hdAvatarAtlasSnapshot = hdAvatarAtlas.updateVisibleEntries({
      // Full HD already usa variantes listas del runtime; aca solo evitamos el
      // auto-packing interno de deck.gl para no crecer una sola textura vertical
      // con iconos 1024x1024 y terminar en quads negros.
      entries: hdAvatarNodes.map((node) => {
        const handle = hdReadyImagesByPubkey[node.pubkey]

        return {
          pubkey: node.pubkey,
          icon: {
            id: handle.key,
            url: handle.url,
            width: handle.bucket,
            height: handle.bucket,
            mask: false,
          },
        }
      }),
    })
    const hdAvatarNodesByIconId = new Map<string, GraphRenderNode[]>()
    for (const node of hdAvatarNodes) {
      const iconId = hdReadyImagesByPubkey[node.pubkey].key
      const iconNodes = hdAvatarNodesByIconId.get(iconId) ?? []
      iconNodes.push(node)
      hdAvatarNodesByIconId.set(iconId, iconNodes)
    }
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
        getSourcePosition: (segment) => segment.sourcePosition,
        getTargetPosition: (segment) => segment.targetPosition,
        getColor: (segment) => {
          const baseColor = getEdgeColor(
            segment,
            maxZapWeight,
            hoveredNodePubkey,
            hoveredEdgeId,
            selectedNodePubkey,
          )
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
          ) * edgeThickness,
        updateTriggers: {
          getColor: [hoveredNodePubkey, hoveredEdgeId, selectedNodePubkey],
          getWidth: [hoveredNodePubkey, hoveredEdgeId, selectedNodePubkey],
        },
      }),
      ...(visibleArrowData.length > 0
        ? [
            new TextLayer({
              id: `${this.props.id}-arrows`,
              data: visibleArrowData,
              pickable: false,
              sizeUnits: 'pixels',
              getPosition: (segment) => segment.targetPosition,
              getAngle: (segment) => -segment.angle,
              getText: () => (arrowType === 'triangle' ? '▶' : '➤'),
              getColor: (segment) => {
                const color = getEdgeColor(
                  segment,
                  maxZapWeight,
                  hoveredNodePubkey,
                  hoveredEdgeId,
                  selectedNodePubkey,
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
                ) *
                  edgeThickness *
                  6 +
                4,
              getTextAnchor: 'end',
              getAlignmentBaseline: 'center',
              fontFamily: 'system-ui, sans-serif',
              characterSet: 'auto',
              updateTriggers: {
                getColor: [hoveredNodePubkey, hoveredEdgeId, selectedNodePubkey],
                getSize: [hoveredNodePubkey, hoveredEdgeId, selectedNodePubkey],
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
        id: `${this.props.id}-nodes`,
        data: model.nodes,
        pickable: true,
        stroked: true,
        filled: true,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (node) => node.position,
        getRadius: (node) => getScreenRadius(node.pubkey, node.radius),
        getFillColor: (node) => getNodeFillColor(node),
        getLineColor: (node) => getNodeLineColor(node),
        getLineWidth: (node) =>
          node.isRoot
            ? 2.2
            : paintedAvatarPubkeySet.has(node.pubkey)
              ? 1.35
              : 1.15,
        updateTriggers: {
          getRadius: [nodeScreenRadii, nodeSizeFactor],
          getFillColor: [imageFrame.paintedPubkeys.join(',')],
          getLineColor: [imageFrame.paintedPubkeys.join(',')],
          getLineWidth: [imageFrame.paintedPubkeys.join(',')],
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
