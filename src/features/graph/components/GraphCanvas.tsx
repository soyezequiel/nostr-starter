/* eslint-disable @next/next/no-assign-module-variable, react-hooks/refs */

import {
  Profiler,
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'

import { appStore, useAppStore } from '@/features/graph/app/store'
import type { AppStore } from '@/features/graph/app/store/types'
import { createPerfCounters } from '@/features/graph/components/perfCounters'
import type { RootLoader } from '@/features/graph/kernel'
import {
  createEmptyGraphRenderModel,
  createEmptyImageRenderPayload,
  createEmptyImageResidencySnapshot,
  createFittedGraphViewState,
  createGraphFitSignature,
  deriveGraphRenderState,
  ImageRuntime,
  resolveGraphNodeScreenRadii,
  sanitizeGraphViewState,
  selectVisibleGraphLabels,
  type GraphRenderLabel,
  type GraphRenderModel,
  type GraphRenderModelPhase,
  type GraphViewState,
  type ImageRenderPayload,
  type ImageResidencySnapshot,
} from '@/features/graph/render'
import type {
  ImageRendererDeliverySnapshot,
  ImageSourceHandle,
} from '@/features/graph/render/imageRuntime'
import { serializeBuildGraphRenderModelInput } from '@/features/graph/render/renderModelPayload'
import {
  createGraphRenderModelWorkerGateway,
  type GraphRenderModelWorkerGateway,
} from '@/features/graph/render/renderModelWorker'
import { GraphViewportLazy } from '@/features/graph/render/GraphViewportLazy'

const selectGraphCanvasState = (state: AppStore) => ({
  nodes: state.nodes,
  links: state.links,
  zapEdges: state.zapLayer.edges,
  zapLayerStatus: state.zapLayer.status,
  rootNodePubkey: state.rootNodePubkey,
  selectedNodePubkey: state.selectedNodePubkey,
  comparedNodePubkeys: state.comparedNodePubkeys,
  expandedNodePubkeys: state.expandedNodePubkeys,
  graphAnalysis: state.graphAnalysis,
  rootLoadStatus: state.rootLoad.status,
  activeLayer: state.activeLayer,
  capReached: state.graphCaps.capReached,
  maxNodes: state.graphCaps.maxNodes,
  renderConfig: state.renderConfig,
  isNodeDetailOpen:
    state.openPanel === 'node-detail' && state.selectedNodePubkey !== null,
})

const NodeDetailPanel = lazy(async () => {
  const module = await import('@/features/graph/components/NodeDetailPanel')
  return { default: module.NodeDetailPanel }
})

export interface GraphCanvasDiagnostics {
  comparisonCount: number
  render: {
    status: string
    reasons: string[]
    nodeCount: number
    edgeCount: number
    labelCount: number
    thinnedEdgeCount: number
    lastBuildMs: number
    avgBuildMs: number
    lastRenderTrigger: string
  }
  image: {
    snapshot: ImageResidencySnapshot
    readyImageCount: number
  }
  stream: {
    label: string
    meta: string
    activeLayer: string
    zapLayerStatus: string
  }
}

interface GraphCanvasProps {
  runtime: RootLoader
  onDiagnosticsChange?: (snapshot: GraphCanvasDiagnostics | null) => void
}

const EMPTY_IMAGE_FRAME = createEmptyImageRenderPayload()
const EMPTY_IMAGE_DIAGNOSTICS = createEmptyImageResidencySnapshot()
const EMPTY_NODE_SCREEN_RADII = new Map<string, number>()
const QUIET_VIEWPORT_READY_MS = 10_000
const AVATAR_HD_VIEWPORT_QUIET_MS = 120
const AVATAR_FULL_HD_VIEWPORT_QUIET_MS = 250

const equalStringLists = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const equalImageSourceHandleRecords = (
  left: Record<string, ImageSourceHandle>,
  right: Record<string, ImageSourceHandle>,
) => {
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) {
    return false
  }

  for (const [pubkey, leftHandle] of leftEntries) {
    const rightHandle = right[pubkey]
    if (
      !rightHandle ||
      leftHandle.key !== rightHandle.key ||
      leftHandle.sourceUrl !== rightHandle.sourceUrl ||
      leftHandle.bucket !== rightHandle.bucket ||
      leftHandle.url !== rightHandle.url ||
      leftHandle.byteSize !== rightHandle.byteSize
    ) {
      return false
    }
  }

  return true
}

const equalImageRenderPayload = (
  left: ImageRenderPayload,
  right: ImageRenderPayload,
) =>
  equalImageSourceHandleRecords(
    left.readyImagesByPubkey,
    right.readyImagesByPubkey,
  ) &&
  equalImageSourceHandleRecords(
    left.baseReadyImagesByPubkey,
    right.baseReadyImagesByPubkey,
  ) &&
  equalImageSourceHandleRecords(
    left.hdReadyImagesByPubkey,
    right.hdReadyImagesByPubkey,
  ) &&
  equalStringLists(left.paintedPubkeys, right.paintedPubkeys)

const equalGraphViewState = (
  left: GraphViewState | null,
  right: GraphViewState | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.zoom === right.zoom &&
    left.minZoom === right.minZoom &&
    left.maxZoom === right.maxZoom &&
    left.target[0] === right.target[0] &&
    left.target[1] === right.target[1] &&
    left.target[2] === right.target[2])

const equalGraphLabels = (
  left: readonly GraphRenderLabel[],
  right: readonly GraphRenderLabel[],
) =>
  left.length === right.length &&
  left.every((label, index) => {
    const candidate = right[index]
    return (
      label === candidate ||
      (candidate !== undefined &&
        label.id === candidate.id &&
        label.pubkey === candidate.pubkey &&
        label.text === candidate.text &&
        label.radius === candidate.radius &&
        label.isRoot === candidate.isRoot &&
        label.isSelected === candidate.isSelected &&
        label.position[0] === candidate.position[0] &&
        label.position[1] === candidate.position[1])
    )
  })

const equalNodeScreenRadii = (
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
) => {
  if (left === right) {
    return true
  }

  if (left.size !== right.size) {
    return false
  }

  for (const [pubkey, radius] of left) {
    if (right.get(pubkey) !== radius) {
      return false
    }
  }

  return true
}

const formatZoomLevel = (zoom: number) => zoom.toFixed(2)

const formatZoomScale = (zoom: number) => {
  const scale = 2 ** zoom
  return `${scale >= 10 ? scale.toFixed(1) : scale.toFixed(2)}x`
}

const readNowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const getRenderModelErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message
  }

  return 'No se pudo preparar el render 2D.'
}

const emptyStateCopy = (status: ReturnType<typeof deriveGraphRenderState>) => {
  if (status.reasons.includes('worker-error')) {
    return {
      title: 'No se pudo preparar el render 2D.',
      body: 'El worker de render fallo antes de producir un modelo util. Mantuvimos el estado del grafo, pero no hay viewport listo todavia.',
    }
  }

  if (status.status === 'rendering') {
    return {
      title: 'Preparando render del vecindario descubierto.',
      body: 'Montando el viewport 2D y ajustando el framing inicial.',
    }
  }

  return {
    title: 'Aun no hay un vecindario descubierto para renderizar.',
    body: 'Carga un root valido para ver el grafo incremental con pan, zoom y seleccion.',
  }
}

export function GraphCanvas({
  runtime,
  onDiagnosticsChange,
}: GraphCanvasProps) {
  const {
    nodes,
    links,
    zapEdges,
    zapLayerStatus,
    rootNodePubkey,
    selectedNodePubkey,
    comparedNodePubkeys,
    expandedNodePubkeys,
    graphAnalysis,
    rootLoadStatus,
    activeLayer,
    capReached,
    maxNodes,
    renderConfig,
    isNodeDetailOpen,
  } = useAppStore(useShallow(selectGraphCanvasState))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const perfCountersRef = useRef(createPerfCounters())
  const [hoveredNodePubkey, setHoveredNodePubkey] = useState<string | null>(
    null,
  )
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [hoveredEdgePubkeys, setHoveredEdgePubkeys] = useState<readonly string[]>(
    [],
  )
  const [interactionViewState, setInteractionViewState] = useState<{
    signature: string
    viewState: GraphViewState
  } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const canvasFrameRef = useRef<HTMLDivElement | null>(null)
  const previousRenderSnapshotRef = useRef({
    nodes,
    links,
    zapEdges,
    selectedNodePubkey,
    activeLayer,
    rootLoadStatus,
    size,
    hoveredNodePubkey,
    viewState: null as GraphViewState | null,
    renderConfig,
    comparedNodePubkeys,
  })
  const lastProfiledModelRef = useRef<GraphRenderModel | null>(null)
  const modelRef = useRef<GraphRenderModel>(
    createEmptyGraphRenderModel(activeLayer, renderConfig),
  )
  const previousPositionsRef = useRef<Map<string, [number, number]>>(new Map())
  const previousLayoutKeyRef = useRef<string | undefined>(undefined)
  const renderRequestSequenceRef = useRef(0)
  const [model, setModel] = useState<GraphRenderModel>(() =>
    createEmptyGraphRenderModel(activeLayer, renderConfig),
  )
  const [modelPhase, setModelPhase] = useState<GraphRenderModelPhase>('idle')
  const [modelErrorMessage, setModelErrorMessage] = useState<string | null>(
    null,
  )
  const [graphRenderWorker, setGraphRenderWorker] =
    useState<GraphRenderModelWorkerGateway | null>(null)

  const imageRuntimeRef = useRef<ImageRuntime | null>(null)
  const refreshImageFrameRef = useRef<() => void>(() => undefined)
  const [imageRuntime, setImageRuntime] = useState<ImageRuntime | null>(null)
  const [imageFrame, setImageFrame] =
    useState<ImageRenderPayload>(EMPTY_IMAGE_FRAME)
  const [imageDiagnosticsSnapshot, setImageDiagnosticsSnapshot] =
    useState<ImageResidencySnapshot>(EMPTY_IMAGE_DIAGNOSTICS)
  const stableViewStateRef = useRef<GraphViewState | null>(null)
  const stableVisibleLabelsRef = useRef<readonly GraphRenderLabel[]>([])
  const stableNodeScreenRadiiRef = useRef<ReadonlyMap<string, number>>(
    EMPTY_NODE_SCREEN_RADII,
  )
  const lastViewSampleRef = useRef<{
    at: number
    target: [number, number]
    zoom: number
  } | null>(null)
  const lastViewportInteractionAtRef = useRef<number | null>(null)
  const [viewportVelocity, setViewportVelocity] = useState(0)
  const [viewportQuietForMs, setViewportQuietForMs] = useState(
    QUIET_VIEWPORT_READY_MS,
  )

  useEffect(() => {
    const nextImageRuntime = new ImageRuntime()
    imageRuntimeRef.current = nextImageRuntime
    const unsubscribe = nextImageRuntime.subscribe(() => {
      refreshImageFrameRef.current()
    })

    setImageRuntime(nextImageRuntime)

    return () => {
      unsubscribe()
      nextImageRuntime.dispose()
      imageRuntimeRef.current = null
      setImageFrame(EMPTY_IMAGE_FRAME)
      setImageDiagnosticsSnapshot(EMPTY_IMAGE_DIAGNOSTICS)
      setImageRuntime(null)
    }
  }, [])

  useEffect(() => {
    const gateway = createGraphRenderModelWorkerGateway()
    setGraphRenderWorker(gateway)

    return () => {
      setGraphRenderWorker((current) => (current === gateway ? null : current))
      gateway.dispose()
    }
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const nextWidth = Math.max(0, Math.floor(entry.contentRect.width))
      const nextHeight = Math.max(0, Math.floor(entry.contentRect.height))

      setSize((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous
        }

        return {
          width: nextWidth,
          height: nextHeight,
        }
      })
    })

    resizeObserver.observe(element)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(true)
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    modelRef.current = model
  }, [model])

  const refreshViewportQuietState = useCallback(() => {
    const lastInteractionAt = lastViewportInteractionAtRef.current
    const nextQuietForMs =
      lastInteractionAt === null
        ? QUIET_VIEWPORT_READY_MS
        : Math.max(0, readNowMs() - lastInteractionAt)

    setViewportQuietForMs((current) =>
      Math.abs(current - nextQuietForMs) < 8 ? current : nextQuietForMs,
    )
  }, [])

  const markViewportInteraction = useCallback(() => {
    lastViewportInteractionAtRef.current = readNowMs()
    setViewportQuietForMs((current) => (current === 0 ? current : 0))
  }, [])

  const workerQueueRefs = useRef({
    isBusy: false,
    pendingInput: null as Omit<
      Parameters<typeof serializeBuildGraphRenderModelInput>[0],
      'previousPositions' | 'previousLayoutKey'
    > | null,
  })
  const triggerFlushRef = useRef<() => void>(undefined)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!graphRenderWorker) {
      return
    }

    workerQueueRefs.current.pendingInput = {
      nodes,
      links,
      zapEdges,
      activeLayer,
      rootNodePubkey,
      selectedNodePubkey,
      expandedNodePubkeys,
      comparedNodePubkeys,
      graphAnalysis,
      renderConfig,
    }

    const flushWorkerQueue = () => {
      if (
        workerQueueRefs.current.isBusy ||
        !workerQueueRefs.current.pendingInput
      ) {
        return
      }

      const input = workerQueueRefs.current.pendingInput
      workerQueueRefs.current.pendingInput = null
      workerQueueRefs.current.isBusy = true

      const requestId = renderRequestSequenceRef.current + 1
      renderRequestSequenceRef.current = requestId
      const hasRenderableModel = modelRef.current.nodes.length > 0

      const buildInput = {
        ...input,
        previousPositions: previousPositionsRef.current,
        previousLayoutKey: previousLayoutKeyRef.current,
      }

      const isCurrentRequest = () =>
        isMountedRef.current && renderRequestSequenceRef.current === requestId

      const onWorkerSettled = () => {
        workerQueueRefs.current.isBusy = false
        triggerFlushRef.current?.()
      }

      const commitModel = (nextModel: GraphRenderModel) => {
        if (!isCurrentRequest()) {
          onWorkerSettled()
          return
        }

        previousPositionsRef.current = new Map(
          nextModel.nodes.map((node) => [node.pubkey, node.position]),
        )
        previousLayoutKeyRef.current = nextModel.layoutKey

        startTransition(() => {
          setModel(nextModel)
          setModelPhase('ready')
          setModelErrorMessage(null)
        })

        onWorkerSettled()
      }

      const failModelBuild = (error: unknown) => {
        if (!isCurrentRequest()) {
          onWorkerSettled()
          return
        }

        startTransition(() => {
          setModelPhase('error')
          setModelErrorMessage(getRenderModelErrorMessage(error))
        })

        onWorkerSettled()
      }

      setModelPhase('building')
      setModelErrorMessage(null)

      if (!hasRenderableModel) {
        startTransition(() => {
          setModel((current) =>
            current.nodes.length === 0 &&
            (current.activeLayer !== input.activeLayer ||
              current.renderConfig !== input.renderConfig)
              ? createEmptyGraphRenderModel(input.activeLayer, input.renderConfig)
              : current,
          )
        })
      }

      const request = serializeBuildGraphRenderModelInput(buildInput)

      void graphRenderWorker
        .invoke('BUILD_RENDER_MODEL', request)
        .then(commitModel)
        .catch((workerError) => {
          failModelBuild(workerError)
        })
    }

    triggerFlushRef.current = flushWorkerQueue
    flushWorkerQueue()
  }, [
    activeLayer,
    comparedNodePubkeys,
    expandedNodePubkeys,
    graphAnalysis,
    graphRenderWorker,
    links,
    nodes,
    rootNodePubkey,
    selectedNodePubkey,
    zapEdges,
    renderConfig,
  ])

  useEffect(() => {
    perfCountersRef.current.modelBuilds += 1
  }, [model])

  const {
    minX: boundsMinX,
    maxX: boundsMaxX,
    minY: boundsMinY,
    maxY: boundsMaxY,
  } = model.bounds

  const fittedViewState = useMemo(() => {
    if (size.width === 0 || size.height === 0 || model.nodes.length === 0) {
      return null
    }

    return createFittedGraphViewState({
      bounds: {
        minX: boundsMinX,
        maxX: boundsMaxX,
        minY: boundsMinY,
        maxY: boundsMaxY,
      },
      width: size.width,
      height: size.height,
    })
  }, [
    boundsMaxX,
    boundsMaxY,
    boundsMinX,
    boundsMinY,
    model.nodes.length,
    size.height,
    size.width,
  ])

  const fitSignature = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? createGraphFitSignature({
            topologySignature: model.topologySignature,
            width: size.width,
            height: size.height,
          })
        : 'empty',
    [model.topologySignature, size.height, size.width],
  )

  const resolvedViewState = useMemo(() => {
    if (!fittedViewState) {
      return null
    }

    if (interactionViewState?.signature === fitSignature) {
      return interactionViewState.viewState
    }

    return fittedViewState
  }, [fitSignature, fittedViewState, interactionViewState])

  const viewState = useMemo(() => {
    if (equalGraphViewState(stableViewStateRef.current, resolvedViewState)) {
      return stableViewStateRef.current
    }

    stableViewStateRef.current = resolvedViewState
    return resolvedViewState
  }, [resolvedViewState])

  useEffect(() => {
    const previous = previousRenderSnapshotRef.current
    const counters = perfCountersRef.current

    counters.reactRenders += 1

    if (nodes !== previous.nodes) {
      counters.lastRenderTrigger = 'nodes'
    } else if (links !== previous.links) {
      counters.lastRenderTrigger = 'links'
    } else if (zapEdges !== previous.zapEdges) {
      counters.lastRenderTrigger = 'zapEdges'
    } else if (selectedNodePubkey !== previous.selectedNodePubkey) {
      counters.lastRenderTrigger = 'selection'
    } else if (activeLayer !== previous.activeLayer) {
      counters.lastRenderTrigger = 'layer'
    } else if (rootLoadStatus !== previous.rootLoadStatus) {
      counters.lastRenderTrigger = 'rootLoad'
    } else if (size !== previous.size) {
      counters.lastRenderTrigger = 'resize'
    } else if (hoveredNodePubkey !== previous.hoveredNodePubkey) {
      counters.lastRenderTrigger = 'hover'
    } else if (viewState !== previous.viewState) {
      counters.lastRenderTrigger = 'view'
    } else if (renderConfig !== previous.renderConfig) {
      counters.lastRenderTrigger = 'renderConfig'
    } else {
      counters.lastRenderTrigger = 'other'
    }

    previousRenderSnapshotRef.current = {
      nodes,
      links,
      zapEdges,
      selectedNodePubkey,
      activeLayer,
      rootLoadStatus,
      size,
      hoveredNodePubkey,
      viewState,
      renderConfig,
      comparedNodePubkeys,
    }
  }, [
    activeLayer,
    comparedNodePubkeys,
    hoveredNodePubkey,
    links,
    nodes,
    renderConfig,
    rootLoadStatus,
    selectedNodePubkey,
    size,
    viewState,
    zapEdges,
  ])

  const renderState = useMemo(
    () =>
      deriveGraphRenderState({
        model,
        hasViewport: size.width > 0 && size.height > 0 && viewState !== null,
        rootLoadStatus,
        capReached,
        modelPhase,
      }),
    [capReached, model, modelPhase, rootLoadStatus, size.height, size.width, viewState],
  )

  const visibleLabels = useMemo(
    () =>
      selectVisibleGraphLabels({
        labels: model.labels,
        hoveredNodePubkey,
        zoomLevel: viewState?.zoom ?? 1,
        labelPolicy: model.lod.labelPolicy,
      }),
    [hoveredNodePubkey, model.labels, model.lod.labelPolicy, viewState?.zoom],
  )

  const stableVisibleLabels = useMemo(() => {
    if (equalGraphLabels(stableVisibleLabelsRef.current, visibleLabels)) {
      return stableVisibleLabelsRef.current
    }

    stableVisibleLabelsRef.current = visibleLabels
    return visibleLabels
  }, [visibleLabels])

  const nodeScreenRadii = useMemo(() => {
    if (!viewState || size.width === 0 || size.height === 0) {
      return EMPTY_NODE_SCREEN_RADII
    }

    return resolveGraphNodeScreenRadii({
      nodes: model.nodes,
      viewState,
      width: size.width,
      height: size.height,
      visibleNodeCount: model.lod.visibleNodeCount,
      autoSizeNodes: model.renderConfig?.autoSizeNodes,
    })
  }, [
    model.lod.visibleNodeCount,
    model.nodes,
    model.renderConfig?.autoSizeNodes,
    size.height,
    size.width,
    viewState,
  ])

  const stableNodeScreenRadii = useMemo(() => {
    if (
      equalNodeScreenRadii(stableNodeScreenRadiiRef.current, nodeScreenRadii)
    ) {
      return stableNodeScreenRadiiRef.current
    }

    stableNodeScreenRadiiRef.current = nodeScreenRadii
    return nodeScreenRadii
  }, [nodeScreenRadii])

  refreshImageFrameRef.current = () => {
    const runtimeInstance = imageRuntimeRef.current
    if (!runtimeInstance || !viewState || size.width === 0 || size.height === 0) {
      startTransition(() => {
        setImageFrame((current) =>
          equalImageRenderPayload(current, EMPTY_IMAGE_FRAME)
            ? current
            : EMPTY_IMAGE_FRAME,
        )
        setImageDiagnosticsSnapshot(EMPTY_IMAGE_DIAGNOSTICS)
      })
      return
    }

    const nextImageFrame = runtimeInstance.prepareFrame({
      width: size.width,
      height: size.height,
      viewState,
      velocityScore: viewportVelocity,
      viewportQuietForMs,
      nodes: model.nodes,
      nodeScreenRadii: stableNodeScreenRadii,
      selectedNodePubkey,
      hoveredNodePubkey,
      mode: renderConfig.imageQualityMode,
      avatarHdZoomThreshold: renderConfig.avatarHdZoomThreshold,
      avatarFullHdZoomThreshold: renderConfig.avatarFullHdZoomThreshold,
    })
    const nextImageDiagnostics = runtimeInstance.debugSnapshot()

    startTransition(() => {
      setImageFrame((current) =>
        equalImageRenderPayload(current, nextImageFrame)
          ? current
          : nextImageFrame,
      )
      setImageDiagnosticsSnapshot(nextImageDiagnostics)
    })
  }

  useEffect(() => {
    refreshImageFrameRef.current()
  }, [
    hoveredNodePubkey,
    imageRuntime,
    model.nodes,
    stableNodeScreenRadii,
    renderConfig.avatarFullHdZoomThreshold,
    renderConfig.avatarHdZoomThreshold,
    renderConfig.imageQualityMode,
    selectedNodePubkey,
    size.height,
    size.width,
    viewState,
    viewportVelocity,
    viewportQuietForMs,
  ])

  useEffect(() => {
    refreshViewportQuietState()

    const lastInteractionAt = lastViewportInteractionAtRef.current
    if (lastInteractionAt === null || viewState === null) {
      return
    }

    const now = readNowMs()
    const timeouts = [
      AVATAR_HD_VIEWPORT_QUIET_MS,
      AVATAR_FULL_HD_VIEWPORT_QUIET_MS,
      AVATAR_FULL_HD_VIEWPORT_QUIET_MS + 16,
    ]
      .map((threshold) => threshold - (now - lastInteractionAt))
      .filter((delayMs) => delayMs > 0)
      .map((delayMs) =>
        window.setTimeout(() => {
          refreshViewportQuietState()
          refreshImageFrameRef.current()
        }, delayMs + 1),
      )

    return () => {
      for (const timeoutId of timeouts) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [refreshViewportQuietState, viewState])

  const handleAvatarRendererDelivery = useCallback(
    (snapshot: ImageRendererDeliverySnapshot) => {
      imageRuntimeRef.current?.reportRendererDelivery(snapshot)
    },
    [],
  )

  const handleFullscreenToggle = useCallback(() => {
    const frame = canvasFrameRef.current
    if (!frame) {
      return
    }

    if (document.fullscreenElement === frame) {
      void document.exitFullscreen()
    } else {
      void frame.requestFullscreen()
    }
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === canvasFrameRef.current)
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const handleSelectNode = useCallback(
    (pubkey: string | null, options?: { shiftKey?: boolean }) => {
      const state = appStore.getState()
      const effectiveShift = options?.shiftKey || isShiftPressed

      if (effectiveShift && pubkey) {
        const current = new Set(state.comparedNodePubkeys)

        if (!state.expandedNodePubkeys.has(pubkey)) {
          runtime.selectNode(pubkey)
        }

        if (
          current.size === 0 &&
          state.selectedNodePubkey &&
          state.selectedNodePubkey !== pubkey
        ) {
          current.add(state.selectedNodePubkey)
        }

        if (current.has(pubkey)) {
          current.delete(pubkey)
        } else if (current.size < 4) {
          current.add(pubkey)
        } else {
          const first = current.values().next().value
          if (first !== undefined) {
            current.delete(first)
          }
          current.add(pubkey)
        }

        state.setComparedNodePubkeys(current)
        return
      }

      if (state.comparedNodePubkeys.size > 0) {
        state.clearComparedNodes()
      }
      runtime.selectNode(pubkey)
    },
    [runtime, isShiftPressed],
  )

  const handleHoverGraph = useCallback(
    (
      hover:
        | { type: 'node'; pubkey: string }
        | { type: 'edge'; edgeId: string; pubkeys: [string, string] }
        | null,
    ) => {
      if (hover === null) {
        setHoveredNodePubkey((current) => (current === null ? current : null))
        setHoveredEdgeId((current) => (current === null ? current : null))
        setHoveredEdgePubkeys((current) =>
          current.length === 0 ? current : [],
        )
        return
      }

      if (hover.type === 'node') {
        setHoveredNodePubkey((current) =>
          current === hover.pubkey ? current : hover.pubkey,
        )
        setHoveredEdgeId((current) => (current === null ? current : null))
        setHoveredEdgePubkeys((current) =>
          current.length === 0 ? current : [],
        )
        return
      }

      setHoveredNodePubkey((current) => (current === null ? current : null))
      setHoveredEdgeId((current) =>
        current === hover.edgeId ? current : hover.edgeId,
      )
      setHoveredEdgePubkeys((current) =>
        current.length === hover.pubkeys.length &&
        current.every((value, index) => value === hover.pubkeys[index])
          ? current
          : [...hover.pubkeys],
      )
    },
    [],
  )

  const handleViewStateChange = useCallback(
    (nextViewState: GraphViewState) => {
      const currentSampleAt = readNowMs()
      const previousSample = lastViewSampleRef.current

      if (previousSample) {
        const elapsedMs = Math.max(16, currentSampleAt - previousSample.at)
        const deltaX = nextViewState.target[0] - previousSample.target[0]
        const deltaY = nextViewState.target[1] - previousSample.target[1]
        const deltaZoom = Math.abs(nextViewState.zoom - previousSample.zoom)
        const nextVelocity =
          (Math.hypot(deltaX, deltaY) / elapsedMs) * 1000 + deltaZoom * 800

        setViewportVelocity((current) =>
          Math.abs(current - nextVelocity) < 1 ? current : nextVelocity,
        )
      }

      lastViewSampleRef.current = {
        at: currentSampleAt,
        target: [nextViewState.target[0], nextViewState.target[1]],
        zoom: nextViewState.zoom,
      }
      markViewportInteraction()

      setInteractionViewState((current) => {
        if (
          current?.signature === fitSignature &&
          current.viewState.zoom === nextViewState.zoom &&
          current.viewState.target[0] === nextViewState.target[0] &&
          current.viewState.target[1] === nextViewState.target[1]
        ) {
          return current
        }

        return {
          signature: fitSignature,
          viewState: nextViewState,
        }
      })
    },
    [fitSignature, markViewportInteraction],
  )

  useEffect(() => {
    lastViewSampleRef.current = null
    lastViewportInteractionAtRef.current = null
    setViewportVelocity(0)
    setViewportQuietForMs(QUIET_VIEWPORT_READY_MS)
  }, [fitSignature])

  const handleStepZoom = useCallback(
    (delta: number) => {
      const baseViewState = viewState ?? fittedViewState
      if (!baseViewState) {
        return
      }

      markViewportInteraction()

      setInteractionViewState({
        signature: fitSignature,
        viewState: sanitizeGraphViewState({
          ...baseViewState,
          zoom: baseViewState.zoom + delta,
          target: baseViewState.target,
        }),
      })
    },
    [fitSignature, fittedViewState, markViewportInteraction, viewState],
  )

  const handleResetView = useCallback(() => {
    if (!fittedViewState) {
      return
    }

    markViewportInteraction()

    setInteractionViewState({
      signature: fitSignature,
      viewState: fittedViewState,
    })
  }, [fitSignature, fittedViewState, markViewportInteraction])

  const overlayCopy = emptyStateCopy(renderState)
  const shouldMountRenderer =
    model.nodes.length > 0 &&
    size.width > 0 &&
    size.height > 0 &&
    viewState !== null
  const statusCopy = capReached
    ? `Cap ${maxNodes} alcanzado`
    : activeLayer === 'zaps'
      ? `${zapEdges.length} zaps visibles`
      : `${model.edges.length} links visibles`
  const streamLabel =
    rootLoadStatus === 'loading'
      ? 'Descubriendo'
      : rootLoadStatus === 'partial'
        ? 'Evidencia parcial'
        : rootLoadStatus === 'ready'
          ? 'Viewport listo'
          : rootLoadStatus === 'error'
            ? 'Error de carga'
            : rootLoadStatus === 'empty'
              ? 'Sin follows'
              : 'Esperando root'
  const analysisOverlay = model.analysisOverlay
  const avatarQualityGuide = imageDiagnosticsSnapshot.qualityGuide
  const zoomOverlay = useMemo(
    () =>
      viewState
        ? {
            levelLabel: formatZoomLevel(viewState.zoom),
            scaleLabel: formatZoomScale(viewState.zoom),
          }
        : null,
    [viewState],
  )

  const diagnostics = useMemo<GraphCanvasDiagnostics>(
    () => ({
      comparisonCount: comparedNodePubkeys.size,
      render: {
        status: renderState.status,
        reasons: renderState.reasons,
        nodeCount: model.nodes.length,
        edgeCount: model.edges.length,
        labelCount: visibleLabels.length,
        thinnedEdgeCount: model.lod.thinnedEdgeCount,
        lastBuildMs: perfCountersRef.current.lastBuildMs,
        avgBuildMs: perfCountersRef.current.avgBuildMs,
        lastRenderTrigger: perfCountersRef.current.lastRenderTrigger,
      },
      image: {
        snapshot: imageDiagnosticsSnapshot,
        readyImageCount: Object.keys(imageFrame.readyImagesByPubkey).length,
      },
      stream: {
        label: streamLabel,
        meta: statusCopy,
        activeLayer,
        zapLayerStatus,
      },
    }),
    [
      activeLayer,
      comparedNodePubkeys.size,
      imageDiagnosticsSnapshot,
      imageFrame.readyImagesByPubkey,
      model.edges.length,
      model.lod.thinnedEdgeCount,
      model.nodes.length,
      renderState.reasons,
      renderState.status,
      statusCopy,
      streamLabel,
      visibleLabels.length,
      zapLayerStatus,
    ],
  )

  useEffect(() => {
    onDiagnosticsChange?.(diagnostics)
  }, [diagnostics, onDiagnosticsChange])

  useEffect(
    () => () => {
      onDiagnosticsChange?.(null)
    },
    [onDiagnosticsChange],
  )

  return (
    <Profiler
      id="graph-canvas"
      onRender={(_id, _phase, actualDuration) => {
        if (lastProfiledModelRef.current === model) {
          return
        }

        const counters = perfCountersRef.current
        counters.lastBuildMs = actualDuration
        counters.avgBuildMs =
          counters.avgBuildMs === 0
            ? actualDuration
            : counters.avgBuildMs * 0.8 + actualDuration * 0.2
        lastProfiledModelRef.current = model
      }}
    >
      <section
        aria-labelledby="graph-canvas-title"
        className="graph-panel"
        data-graph-panel
      >
        <h2 className="graph-panel__sr-title" id="graph-canvas-title">
          Grafo dirigido descubierto
        </h2>
        <div
          className={`graph-panel__canvas-frame${
            isFullscreen ? ' graph-panel__canvas-frame--fullscreen' : ''
          }`}
          ref={(element) => {
            containerRef.current = element
            canvasFrameRef.current = element
          }}
        >
          {isNodeDetailOpen ? (
            <Suspense fallback={null}>
              <NodeDetailPanel imageRuntime={imageRuntime} runtime={runtime} />
            </Suspense>
          ) : null}

          {shouldMountRenderer && viewState ? (
            <GraphViewportLazy
              height={size.height}
              hoveredNodePubkey={hoveredNodePubkey}
              hoveredEdgeId={hoveredEdgeId}
              hoveredEdgePubkeys={hoveredEdgePubkeys}
              selectedNodePubkey={selectedNodePubkey}
              model={model}
              nodeScreenRadii={stableNodeScreenRadii}
              visibleLabels={stableVisibleLabels}
              imageFrame={imageFrame}
              onAvatarRendererDelivery={handleAvatarRendererDelivery}
              onHoverGraph={handleHoverGraph}
              onSelectNode={handleSelectNode}
              onViewStateChange={handleViewStateChange}
              viewState={viewState}
              width={size.width}
              renderConfig={renderConfig}
            />
          ) : null}

          {!shouldMountRenderer ? (
            <div aria-live="polite" className="graph-panel__empty">
              <p className="graph-panel__empty-title">{overlayCopy.title}</p>
              <p className="graph-panel__empty-copy">{overlayCopy.body}</p>
              {modelErrorMessage ? (
                <p className="graph-panel__empty-copy">{modelErrorMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div className="graph-panel__stream-status" aria-live="polite">
            <span className="graph-panel__stream-dot" />
            <span className="graph-panel__stream-label">{streamLabel}</span>
            <span className="graph-panel__stream-meta">{statusCopy}</span>
          </div>

          {zoomOverlay ? (
            <div className="graph-panel__zoom-status" aria-live="polite">
              <span className="graph-panel__zoom-status-badge">Zoom</span>
              <span className="graph-panel__zoom-status-value">
                {zoomOverlay.levelLabel}
              </span>
              <span className="graph-panel__zoom-status-detail">
                {zoomOverlay.scaleLabel}
              </span>
            </div>
          ) : null}

          {analysisOverlay.summary || renderConfig.showAvatarQualityGuide ? (
            <div className="graph-panel__overlay-stack">
              {analysisOverlay.summary ? (
                <div className="graph-panel__analysis" aria-live="polite">
                  <div className="graph-panel__analysis-header">
                    {analysisOverlay.badgeLabel ? (
                      <span className="graph-panel__analysis-badge">
                        {analysisOverlay.badgeLabel}
                      </span>
                    ) : null}
                    {analysisOverlay.isStale ? (
                      <span className="graph-panel__analysis-badge graph-panel__analysis-badge--muted">
                        stale
                      </span>
                    ) : null}
                  </div>
                  <p className="graph-panel__analysis-copy">
                    {analysisOverlay.summary}
                  </p>
                  {analysisOverlay.detail ? (
                    <p className="graph-panel__analysis-detail">
                      {analysisOverlay.detail}
                    </p>
                  ) : null}
                  {analysisOverlay.legendItems.length > 0 ? (
                    <div className="graph-panel__analysis-legend">
                      {analysisOverlay.legendItems.map((item) => (
                        <div
                          className="graph-panel__analysis-legend-item"
                          key={item.id}
                        >
                          <span
                            className="graph-panel__analysis-swatch"
                            style={{
                              backgroundColor: `rgba(${item.color[0]}, ${item.color[1]}, ${item.color[2]}, ${item.color[3] / 255})`,
                            }}
                          />
                          <span>{`${item.label} (${item.nodeCount})`}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {renderConfig.showAvatarQualityGuide ? (
                <div
                  aria-live="polite"
                  className={`graph-panel__avatar-quality-guide graph-panel__avatar-quality-guide--${avatarQualityGuide.tier}`}
                >
                  <span className="graph-panel__avatar-quality-guide-badge">
                    Guia de calidad visible
                  </span>
                  <p className="graph-panel__avatar-quality-guide-summary">
                    {avatarQualityGuide.headline}
                  </p>
                  {avatarQualityGuide.detail ? (
                    <p className="graph-panel__avatar-quality-guide-detail">
                      {avatarQualityGuide.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="graph-panel__control-bar">
            <div className="graph-panel__control-group">
              <button
                aria-label="Alejar"
                className="graph-panel__control-btn"
                onClick={() => handleStepZoom(-0.3)}
                type="button"
              >
                -
              </button>
              <button
                aria-label="Acercar"
                className="graph-panel__control-btn"
                onClick={() => handleStepZoom(0.3)}
                type="button"
              >
                +
              </button>
              <button
                aria-label={
                  isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'
                }
                className="graph-panel__control-btn"
                onClick={handleFullscreenToggle}
                type="button"
              >
                {isFullscreen ? 'Exit' : 'Full'}
              </button>
            </div>

            <button
              className="graph-panel__control-btn graph-panel__control-btn--primary"
              onClick={handleResetView}
              type="button"
            >
              Reset view
            </button>
          </div>
        </div>
      </section>
    </Profiler>
  )
}
