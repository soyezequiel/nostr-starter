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

import {
  appStore,
  deriveCoverageRecovery,
  useAppStore,
} from '@/features/graph/app/store'
import type { AppStore } from '@/features/graph/app/store/types'
import { CoverageRecoveryCard } from '@/features/graph/components/CoverageRecoveryCard'
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
  keywordLayer: state.keywordLayer,
  relayUrls: state.relayUrls,
  relayHealth: state.relayHealth,
  rootNodePubkey: state.rootNodePubkey,
  selectedNodePubkey: state.selectedNodePubkey,
  comparedNodePubkeys: state.comparedNodePubkeys,
  expandedNodePubkeys: state.expandedNodePubkeys,
  graphAnalysis: state.graphAnalysis,
  pathfinding: state.pathfinding,
  rootLoadStatus: state.rootLoad.status,
  rootLoadMessage: state.rootLoad.message,
  activeLayer: state.activeLayer,
  currentKeyword: state.currentKeyword,
  capReached: state.graphCaps.capReached,
  maxNodes: state.graphCaps.maxNodes,
  renderConfig: state.renderConfig,
  isNodeDetailOpen:
    state.openPanel === 'node-detail' && state.selectedNodePubkey !== null,
  isPathfindingOpen: state.openPanel === 'pathfinding',
})

const NodeDetailPanel = lazy(async () => {
  const module = await import('@/features/graph/components/NodeDetailPanel')
  return { default: module.NodeDetailPanel }
})

const PathfindingPanel = lazy(async () => {
  const module = await import('@/features/graph/components/PathfindingPanel')
  return { default: module.PathfindingPanel }
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
    keywordLayerStatus: string
  }
}

interface GraphCanvasProps {
  runtime: RootLoader
  onTrySampleRoot: () => void
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
  onTrySampleRoot,
  onDiagnosticsChange,
}: GraphCanvasProps) {
  const {
    nodes,
    links,
    zapEdges,
    zapLayerStatus,
    keywordLayer,
    relayUrls,
    relayHealth,
    rootNodePubkey,
    selectedNodePubkey,
    comparedNodePubkeys,
    expandedNodePubkeys,
    graphAnalysis,
    pathfinding,
    rootLoadStatus,
    rootLoadMessage,
    activeLayer,
    currentKeyword,
    capReached,
    maxNodes,
    renderConfig,
    isNodeDetailOpen,
    isPathfindingOpen,
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
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [keywordDraft, setKeywordDraft] = useState(currentKeyword)
  const [isKeywordSearching, setIsKeywordSearching] = useState(false)
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
    pathfinding,
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
  const keywordSearchSequenceRef = useRef(0)
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
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const coverageRecovery = useMemo(
    () =>
      deriveCoverageRecovery({
        browserOnline: isBrowserOnline,
        relayUrls,
        relayHealth,
        rootNodePubkey,
        rootLoadStatus,
        links,
      }),
    [
      isBrowserOnline,
      links,
      relayHealth,
      relayUrls,
      rootLoadStatus,
      rootNodePubkey,
    ],
  )

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true)
    }

    const handleOffline = () => {
      setIsBrowserOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

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
      pathfinding: {
        status: pathfinding.status,
        path: pathfinding.path,
      },
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
    pathfinding.path,
    pathfinding.status,
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
    } else if (pathfinding !== previous.pathfinding) {
      counters.lastRenderTrigger = 'pathfinding'
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
      pathfinding,
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
    pathfinding,
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
      activeLayer: model.activeLayer,
      viewState,
      width: size.width,
      height: size.height,
      visibleNodeCount: model.lod.visibleNodeCount,
      autoSizeNodes: model.renderConfig?.autoSizeNodes,
    })
  }, [
    model.activeLayer,
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

  const handleSelectNode = useCallback(
    (pubkey: string | null, options?: { shiftKey?: boolean }) => {
      const state = appStore.getState()

      if (
        pubkey &&
        state.openPanel === 'pathfinding' &&
        state.pathfinding.selectionMode !== 'idle'
      ) {
        state.setSelectedNodePubkey(pubkey)
        state.setPathfindingEndpoint(state.pathfinding.selectionMode, {
          pubkey,
          query: pubkey,
        })
        return
      }

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

  const handleToggleLayer = useCallback(
    (layer: AppStore['activeLayer']) => {
      runtime.toggleLayer(layer)
    },
    [runtime],
  )

  const handleKeywordDraftChange = useCallback(
    (nextValue: string) => {
      startTransition(() => {
        setKeywordDraft(nextValue)
      })
    },
    [],
  )

  useEffect(() => {
    if (activeLayer !== 'keywords') {
      setKeywordDraft(currentKeyword)
    }
  }, [activeLayer, currentKeyword])

  useEffect(() => {
    if (activeLayer !== 'keywords' || keywordLayer.status !== 'enabled') {
      setIsKeywordSearching(false)
      return
    }

    const requestId = keywordSearchSequenceRef.current + 1
    keywordSearchSequenceRef.current = requestId

    const timer = window.setTimeout(() => {
      setIsKeywordSearching(true)
      void runtime
        .searchKeyword(keywordDraft)
        .catch((error) => {
          console.warn('[graph] Keyword search failed.', error)
        })
        .finally(() => {
          if (keywordSearchSequenceRef.current === requestId) {
            setIsKeywordSearching(false)
          }
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)

      if (keywordSearchSequenceRef.current === requestId) {
        setIsKeywordSearching(false)
      }
    }
  }, [
    activeLayer,
    keywordDraft,
    keywordLayer.status,
    runtime,
  ])

  useEffect(() => {
    lastViewSampleRef.current = null
    lastViewportInteractionAtRef.current = null
    setViewportVelocity(0)
    setViewportQuietForMs(QUIET_VIEWPORT_READY_MS)
  }, [fitSignature])

  const overlayCopy = emptyStateCopy(renderState)
  const shouldMountRenderer =
    model.nodes.length > 0 &&
    size.width > 0 &&
    size.height > 0 &&
    viewState !== null
  const shouldShowEmptyState =
    !shouldMountRenderer &&
    rootNodePubkey !== null &&
    rootLoadStatus !== 'loading'
  const keywordMatchNodeCount = Object.keys(keywordLayer.matchesByPubkey).length
  const keywordMatchCount = Object.values(keywordLayer.matchesByPubkey).reduce(
    (total, matches) => total + matches.length,
    0,
  )
  const shouldShowRecoveryEmptyState =
    shouldShowEmptyState && coverageRecovery.shouldOfferRecovery
  const shouldShowRecoveryOverlay =
    shouldMountRenderer && coverageRecovery.shouldOfferRecovery
  const statusCopy = capReached
    ? `Cap ${maxNodes} alcanzado`
    : activeLayer === 'pathfinding' && pathfinding.path
      ? `Camino de ${Math.max(0, pathfinding.path.length - 1)} saltos`
    : activeLayer === 'zaps'
      ? `${zapEdges.length} zaps visibles`
      : activeLayer === 'keywords'
        ? keywordMatchCount > 0
          ? `${keywordMatchCount} hits en ${keywordMatchNodeCount} nodos`
          : keywordLayer.extractCount > 0
            ? `${keywordLayer.extractCount} extractos listos`
            : keywordLayer.message ?? 'Keywords sin corpus'
      : `${model.edges.length} links visibles`
  const layerStatusNote =
    activeLayer === 'keywords'
      ? keywordLayer.message
      : activeLayer === 'zaps'
        ? zapLayerStatus === 'enabled'
          ? `${zapEdges.length} relaciones de zap visibles.`
          : 'La capa de zaps depende de recibos disponibles.'
        : graphAnalysis.message
  const keywordLayerDisabledReason =
    keywordLayer.status === 'unavailable'
      ? keywordLayer.message ?? 'La capa de keywords no esta disponible.'
      : keywordLayer.status === 'loading'
        ? keywordLayer.message ?? 'Preparando corpus de notas...'
        : keywordLayer.status === 'disabled'
          ? keywordLayer.message ?? 'La capa de keywords todavia no esta lista.'
          : ''
  const isKeywordSearchUsable = keywordLayer.status === 'enabled'
  const keywordInputPlaceholder =
    keywordLayer.status === 'enabled'
      ? 'Buscar keyword o interes'
      : 'Esperando corpus de notas'
  const streamLabel =
    pathfinding.status === 'computing'
      ? 'Calculando camino'
      : rootLoadStatus === 'loading'
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
        keywordLayerStatus: keywordLayer.status,
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
      keywordLayer.status,
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
          className="graph-panel__canvas-frame"
          ref={(element) => {
            containerRef.current = element
          }}
        >
          {shouldShowRecoveryOverlay && coverageRecovery.reason ? (
            <div className="graph-panel__overlay-stack">
              <CoverageRecoveryCard
                onChangeRelays={() => {
                  appStore.getState().setOpenPanel('relay-config')
                }}
                onTrySampleRoot={onTrySampleRoot}
                reason={coverageRecovery.reason}
                relaySummary={coverageRecovery.relaySummary}
                rootLoadMessage={rootLoadMessage}
                variant="overlay"
              />
            </div>
          ) : null}

          {isNodeDetailOpen ? (
            <Suspense fallback={null}>
              <NodeDetailPanel imageRuntime={imageRuntime} runtime={runtime} />
            </Suspense>
          ) : null}

          {isPathfindingOpen ? (
            <Suspense fallback={null}>
              <PathfindingPanel runtime={runtime} />
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

          {shouldShowRecoveryEmptyState && coverageRecovery.reason ? (
            <CoverageRecoveryCard
              onChangeRelays={() => {
                appStore.getState().setOpenPanel('relay-config')
              }}
              onTrySampleRoot={onTrySampleRoot}
              reason={coverageRecovery.reason}
              relaySummary={coverageRecovery.relaySummary}
              rootLoadMessage={rootLoadMessage}
              variant="empty"
            />
          ) : null}

          {shouldShowEmptyState && !shouldShowRecoveryEmptyState ? (
            <div aria-live="polite" className="graph-panel__empty">
              <p className="graph-panel__empty-title">{overlayCopy.title}</p>
              <p className="graph-panel__empty-copy">{overlayCopy.body}</p>
              {modelErrorMessage ? (
                <p className="graph-panel__empty-copy">{modelErrorMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div className="graph-panel__stream-status" role="status">
            <span className="graph-panel__stream-label">{streamLabel}</span>
            <span className="graph-panel__stream-meta">{statusCopy}</span>
          </div>

          <div className="graph-panel__control-bar">
            <div className="graph-panel__control-group" role="group" aria-label="Capas del grafo">
              <button
                aria-pressed={activeLayer === 'graph'}
                className={`graph-panel__control-btn${
                  activeLayer === 'graph' ? ' graph-panel__control-btn--primary' : ''
                }`}
                onClick={() => handleToggleLayer('graph')}
                type="button"
              >
                Graph
              </button>
              <button
                aria-pressed={activeLayer === 'mutuals'}
                className={`graph-panel__control-btn${
                  activeLayer === 'mutuals' ? ' graph-panel__control-btn--primary' : ''
                }`}
                onClick={() => handleToggleLayer('mutuals')}
                type="button"
              >
                Mutuals
              </button>
              <button
                aria-pressed={activeLayer === 'keywords'}
                className={`graph-panel__control-btn${
                  activeLayer === 'keywords' ? ' graph-panel__control-btn--primary' : ''
                }`}
                onClick={() => handleToggleLayer('keywords')}
                title={keywordLayerDisabledReason || undefined}
                type="button"
              >
                Keywords
              </button>
              <button
                aria-pressed={activeLayer === 'zaps'}
                className={`graph-panel__control-btn${
                  activeLayer === 'zaps' ? ' graph-panel__control-btn--primary' : ''
                }`}
                disabled={zapLayerStatus !== 'enabled'}
                onClick={() => handleToggleLayer('zaps')}
                title={
                  zapLayerStatus !== 'enabled'
                    ? 'La capa de zaps depende de recibos disponibles.'
                    : undefined
                }
                type="button"
              >
                Zaps
              </button>
            </div>

            {activeLayer === 'keywords' ? (
              <div className="graph-panel__keyword-search">
                <input
                  aria-label="Buscar keyword o interes"
                  className="graph-panel__keyword-input"
                  disabled={!isKeywordSearchUsable}
                  onChange={(event) => handleKeywordDraftChange(event.target.value)}
                  placeholder={keywordInputPlaceholder}
                  type="search"
                  value={keywordDraft}
                />
                <span className="graph-panel__keyword-meta">
                  {isKeywordSearching
                    ? 'Buscando...'
                    : keywordMatchCount > 0
                      ? `${keywordMatchCount} hits`
                      : keywordLayer.extractCount > 0
                        ? `${keywordLayer.extractCount} extractos`
                        : 'Sin corpus'}
                </span>
              </div>
            ) : null}
          </div>

          {layerStatusNote ? (
            <div className="graph-panel__status-note" aria-live="polite">
              <p>{layerStatusNote}</p>
              {activeLayer === 'keywords' ? (
                <p>
                  Corpus {keywordLayer.extractCount} extractos /{' '}
                  {keywordLayer.corpusNodeCount} nodos / origen {keywordLayer.loadedFrom}
                  {keywordLayer.isPartial ? ' / parcial' : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </Profiler>
  )
}
