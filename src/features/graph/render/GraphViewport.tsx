import { DeckGraphRenderer } from '@/features/graph/render/DeckGraphRenderer'
import type { RenderConfig } from '@/features/graph/app/store/types'
import type { GraphViewState } from '@/features/graph/render/graphViewState'
import type {
  ImageFrameState,
  ImageRendererDeliverySnapshot,
} from '@/features/graph/render/imageRuntime'
import type { GraphNodeScreenRadii } from '@/features/graph/render/nodeSizing'
import type {
  GraphRenderLabel,
  GraphRenderModel,
} from '@/features/graph/render/types'

interface GraphViewportProps {
  width: number
  height: number
  model: GraphRenderModel
  viewState: GraphViewState
  hoveredNodePubkey: string | null
  hoveredEdgeId: string | null
  hoveredEdgePubkeys: readonly string[]
  selectedNodePubkey: string | null
  visibleLabels: readonly GraphRenderLabel[]
  nodeScreenRadii: GraphNodeScreenRadii
  imageFrame: ImageFrameState
  onAvatarRendererDelivery?: (snapshot: ImageRendererDeliverySnapshot) => void
  onHoverGraph: (
    hover:
      | { type: 'node'; pubkey: string }
      | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
      | null,
  ) => void
  onSelectNode: (pubkey: string | null, options?: { shiftKey?: boolean }) => void
  onViewStateChange: (viewState: GraphViewState) => void
  renderConfig: RenderConfig
  comparedNodePubkeys: ReadonlySet<string>
}

export function GraphViewport({
  width,
  height,
  model,
  viewState,
  hoveredNodePubkey,
  hoveredEdgeId,
  hoveredEdgePubkeys,
  selectedNodePubkey,
  visibleLabels,
  nodeScreenRadii,
  imageFrame,
  onAvatarRendererDelivery,
  onHoverGraph,
  onSelectNode,
  onViewStateChange,
  renderConfig,
  comparedNodePubkeys,
}: GraphViewportProps) {
  return (
    <>
      <DeckGraphRenderer
        height={height}
        hoveredNodePubkey={hoveredNodePubkey}
        hoveredEdgeId={hoveredEdgeId}
        hoveredEdgePubkeys={hoveredEdgePubkeys}
        selectedNodePubkey={selectedNodePubkey}
        model={model}
        nodeScreenRadii={nodeScreenRadii}
        visibleLabels={visibleLabels}
        imageFrame={imageFrame}
        onAvatarRendererDelivery={onAvatarRendererDelivery}
        onHoverGraph={onHoverGraph}
        onSelectNode={onSelectNode}
        onViewStateChange={onViewStateChange}
        viewState={viewState}
        width={width}
        renderConfig={renderConfig}
        comparedNodePubkeys={comparedNodePubkeys}
      />
    </>
  )
}
