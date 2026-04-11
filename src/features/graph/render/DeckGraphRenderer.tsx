import {
  OrthographicView,
  type OrthographicViewState,
  type PickingInfo,
} from '@deck.gl/core'
import DeckGL from '@deck.gl/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import '@/features/graph/render/patchLumaCanvasContext'
import {
  sanitizeGraphViewState,
  type GraphViewState,
} from '@/features/graph/render/graphViewState'
import { resolveGraphUseDevicePixels } from '@/features/graph/render/devicePixels'
import { GraphSceneLayer } from '@/features/graph/render/GraphSceneLayer'
import type {
  ImageRenderPayload,
  ImageRendererDeliverySnapshot,
} from '@/features/graph/render/imageRuntime'
import type { GraphNodeScreenRadii } from '@/features/graph/render/nodeSizing'
import type {
  GraphRenderLabel,
  GraphRenderEdge,
  GraphRenderModel,
  GraphRenderNode,
} from '@/features/graph/render/types'
import type { RenderConfig } from '@/features/graph/app/store/types'

const GRAPH_VIEW = new OrthographicView({
  id: 'graph-view',
})
const DECK_STYLE = {
  position: 'absolute',
  top: '0',
  left: '0',
  width: '100%',
  height: '100%',
  // PERF: prevent browser scroll/zoom handling from competing with deck.gl.
  touchAction: 'none',
} as const
const HOVER_RESUME_DELAY_MS = 96
const DRAG_HOVER_RESUME_DELAY_MS = 144
const VIEWSTATE_MOTION_DISTANCE_THRESHOLD = 2
const VIEWSTATE_MOTION_ZOOM_THRESHOLD = 0.01

type PickableGraphObject = GraphRenderNode | GraphRenderLabel
type PickableGraphHoverObject =
  | PickableGraphObject
  | (GraphRenderEdge & { progressStart?: number; progressEnd?: number })

interface DeckGraphRendererProps {
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
  imageFrame: ImageRenderPayload
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
  forceLowDevicePixels?: boolean
  hoverInteractionEnabled?: boolean
  comparedNodePubkeys?: ReadonlySet<string>
}

const resolvePickedPubkey = (
  object: PickableGraphObject | null | undefined,
): string | null => {
  if (!object || typeof object !== 'object' || !('pubkey' in object)) {
    return null
  }

  return object.pubkey
}

const resolveHoverTarget = (
  object: PickableGraphHoverObject | null | undefined,
):
  | { type: 'node'; pubkey: string }
  | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
  | null => {
  if (!object || typeof object !== 'object') {
    return null
  }

  if ('pubkey' in object && typeof object.pubkey === 'string') {
    return { type: 'node', pubkey: object.pubkey }
  }

  if (
    'id' in object &&
    'source' in object &&
    'target' in object &&
    typeof object.id === 'string' &&
    typeof object.source === 'string' &&
    typeof object.target === 'string'
  ) {
    return {
      type: 'edge',
      edgeId: object.id,
      pubkeys: [object.source, object.target],
    }
  }

  return null
}

const serializeHoverTarget = (
  hover:
    | { type: 'node'; pubkey: string }
    | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
    | null,
) => {
  if (hover === null) {
    return 'none'
  }

  return hover.type === 'node'
    ? `node:${hover.pubkey}`
    : `edge:${hover.edgeId}:${hover.pubkeys[0]}:${hover.pubkeys[1]}`
}

export const DeckGraphRenderer = memo(function DeckGraphRenderer({
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
  forceLowDevicePixels = false,
  hoverInteractionEnabled = true,
}: DeckGraphRendererProps) {
  const hoverFrameRef = useRef<number | null>(null)
  const hoverResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHoverRef = useRef<
    | { type: 'node'; pubkey: string }
    | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
    | null
  >(null)
  const pendingHoverSignatureRef = useRef('none')
  const emittedHoverSignatureRef = useRef('none')
  const lastViewStateRef = useRef<GraphViewState | null>(null)
  const [hoverPickingEnabled, setHoverPickingEnabled] = useState(true)

  const useDevicePixels = useMemo(
    () =>
      resolveGraphUseDevicePixels({
        lod: model.lod,
        forceLowDevicePixels,
      }),
    [forceLowDevicePixels, model.lod],
  )

  const scheduleHoverDispatch = useCallback(
    (
      hover:
        | { type: 'node'; pubkey: string }
        | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
        | null,
    ) => {
      pendingHoverRef.current = hover
      pendingHoverSignatureRef.current = serializeHoverTarget(hover)

      if (hoverFrameRef.current !== null) {
        return
      }

      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null

        if (pendingHoverSignatureRef.current === emittedHoverSignatureRef.current) {
          return
        }

        emittedHoverSignatureRef.current = pendingHoverSignatureRef.current
        onHoverGraph(pendingHoverRef.current)
      })
    },
    [onHoverGraph],
  )

  const suspendHoverPicking = useCallback(
    (durationMs: number) => {
      setHoverPickingEnabled((current) => (current ? false : current))
      scheduleHoverDispatch(null)

      if (hoverResumeTimeoutRef.current !== null) {
        clearTimeout(hoverResumeTimeoutRef.current)
      }

      hoverResumeTimeoutRef.current = setTimeout(() => {
        hoverResumeTimeoutRef.current = null
        setHoverPickingEnabled(true)
      }, durationMs)
    },
    [scheduleHoverDispatch],
  )

  useEffect(
    () => () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current)
      }
      if (hoverResumeTimeoutRef.current !== null) {
        clearTimeout(hoverResumeTimeoutRef.current)
      }
    },
    [],
  )

  const handleGetCursor = useCallback(
    ({ isDragging }: { isDragging: boolean; isHovering: boolean }) =>
      isDragging
        ? 'grabbing'
        : hoveredNodePubkey !== null || hoveredEdgeId !== null
          ? 'pointer'
          : 'grab',
    [hoveredEdgeId, hoveredNodePubkey],
  )

  const handleClick = useCallback(
    (info: PickingInfo<PickableGraphObject>, event: unknown) => {
      const shiftKey =
        typeof event === 'object' &&
        event !== null &&
        'srcEvent' in event &&
        typeof event.srcEvent === 'object' &&
        event.srcEvent !== null &&
        'shiftKey' in event.srcEvent
          ? Boolean(event.srcEvent.shiftKey)
          : false

      onSelectNode(resolvePickedPubkey(info.object), { shiftKey })
    },
    [onSelectNode],
  )

  const handleHover = useCallback(
    (info: PickingInfo<PickableGraphObject>) => {
      scheduleHoverDispatch(
        resolveHoverTarget(info.object as PickableGraphHoverObject | null),
      )
    },
    [scheduleHoverDispatch],
  )

  const handleDeckViewStateChange = useCallback(
    (params: {
      viewState: OrthographicViewState
      interactionState?: {
        isDragging?: boolean
        inTransition?: boolean
      }
    }) => {
      const sanitizedViewState = sanitizeGraphViewState(
        params.viewState as OrthographicViewState,
      )
      const previousViewState = lastViewStateRef.current
      const nextViewState = sanitizedViewState
      const deltaX = previousViewState
        ? nextViewState.target[0] - previousViewState.target[0]
        : 0
      const deltaY = previousViewState
        ? nextViewState.target[1] - previousViewState.target[1]
        : 0
      const deltaZoom = previousViewState
        ? Math.abs(nextViewState.zoom - previousViewState.zoom)
        : 0
      const movedMeaningfully =
        Math.hypot(deltaX, deltaY) >= VIEWSTATE_MOTION_DISTANCE_THRESHOLD ||
        deltaZoom >= VIEWSTATE_MOTION_ZOOM_THRESHOLD ||
        params.interactionState?.isDragging === true ||
        params.interactionState?.inTransition === true

      lastViewStateRef.current = nextViewState

      if (hoverInteractionEnabled && movedMeaningfully) {
        suspendHoverPicking(
          params.interactionState?.isDragging === true
            ? DRAG_HOVER_RESUME_DELAY_MS
            : HOVER_RESUME_DELAY_MS,
        )
      }

      onViewStateChange(
        sanitizedViewState,
      )
    },
    [hoverInteractionEnabled, onViewStateChange, suspendHoverPicking],
  )

  const layers = useMemo(
    () => [
      new GraphSceneLayer({
        id: 'graph-scene',
        model,
        hoveredNodePubkey,
        hoveredEdgeId,
        hoveredEdgePubkeys,
        selectedNodePubkey,
        visibleLabels,
        nodeScreenRadii,
        imageFrame,
      onAvatarRendererDelivery,
      hoverPickingEnabled: hoverInteractionEnabled && hoverPickingEnabled,
      renderConfig,
    }),
    ],
    [
      hoveredNodePubkey,
      hoveredEdgeId,
      hoveredEdgePubkeys,
      selectedNodePubkey,
      model,
      nodeScreenRadii,
      visibleLabels,
      imageFrame,
      onAvatarRendererDelivery,
      hoverInteractionEnabled,
      hoverPickingEnabled,
      renderConfig,
    ],
  )

  return (
    <DeckGL
      controller={true}
      getCursor={handleGetCursor}
      height={height}
      layers={layers}
      useDevicePixels={useDevicePixels}
      onClick={handleClick}
      onHover={
        hoverInteractionEnabled && hoverPickingEnabled ? handleHover : undefined
      }
      onViewStateChange={handleDeckViewStateChange}
      style={DECK_STYLE}
      views={GRAPH_VIEW}
      viewState={viewState}
      width={width}
    />
  )
})
