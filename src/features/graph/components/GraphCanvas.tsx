/* eslint-disable @next/next/no-assign-module-variable, react-hooks/refs */

import {
  memo,
  Profiler,
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  appStore,
  deriveCoverageRecovery,
  selectRelayHealthData,
  useAppStore,
} from '@/features/graph/app/store'
import type {
  AppStore,
  NodeExpansionState,
  RootCollectionProgress,
} from '@/features/graph/app/store/types'
import {
  clearAvatarPipelineProbe,
  publishAvatarPipelineProbe,
} from '@/features/graph/components/avatarPipelineProbe'
import { CoverageRecoveryCard } from '@/features/graph/components/CoverageRecoveryCard'
import { GraphControlRail } from '@/features/graph/components/GraphControlRail'
import { createPerfCounters } from '@/features/graph/components/perfCounters'
import type { RootLoader } from '@/features/graph/kernel/runtime'
import { createEmptyGraphRenderModel } from '@/features/graph/render/createEmptyGraphRenderModel'
import {
  createFittedGraphViewState,
  createGraphFitSignature,
  type GraphViewState,
} from '@/features/graph/render/graphViewState'
import {
  createEmptyImageRenderPayload,
  createEmptyImageResidencySnapshot,
  ImageRuntime,
  type ImageFrameComputationMode,
  type ImageFrameSkipReason,
  type ImageRenderPayload,
  type ImageRendererDeliverySnapshot,
  type ImageResidencySnapshot,
  type ImageSourceHandle,
} from '@/features/graph/render/imageRuntime'
import {
  selectVisibleGraphLabels,
  truncatePubkey,
} from '@/features/graph/render/labels'
import {
  resolveGraphNodeScreenRadii,
  resolveGraphNodeScreenRadiiFast,
} from '@/features/graph/render/nodeSizing'
import { deriveGraphRenderState } from '@/features/graph/render/status'
import type {
  GraphRenderLabel,
  GraphRenderModel,
  GraphRenderModelPhase,
} from '@/features/graph/render/types'
import { isMobileDevicePerformanceProfile } from '@/features/graph/devicePerformance'
import { serializeBuildGraphRenderModelInput } from '@/features/graph/render/renderModelPayload'
import {
  createGraphRenderModelWorkerGateway,
  type GraphRenderModelWorkerGateway,
} from '@/features/graph/render/renderModelWorker'
import { GraphViewportLazy } from '@/features/graph/render/GraphViewportLazy'

const selectGraphCanvasRenderState = (state: AppStore) => ({
  nodes: state.nodes,
  links: state.links,
  inboundLinks: state.inboundLinks,
  connectionsLinks: state.connectionsLinks,
  connectionsLinksRevision: state.connectionsLinksRevision,
  graphRevision: state.graphRevision,
  inboundGraphRevision: state.inboundGraphRevision,
  zapEdges: state.zapLayer.edges,
  zapLayerStatus: state.zapLayer.status,
  zapLayerRevision: state.zapLayer.revision,
  keywordLayerStatus: state.keywordLayer.status,
  keywordLayerMessage: state.keywordLayer.message,
  keywordExtractCount: state.keywordLayer.extractCount,
  keywordCorpusNodeCount: state.keywordLayer.corpusNodeCount,
  keywordLoadedFrom: state.keywordLayer.loadedFrom,
  keywordIsPartial: state.keywordLayer.isPartial,
  keywordMatchCount: state.keywordLayer.matchCount,
  keywordMatchNodeCount: state.keywordLayer.matchNodeCount,
  rootNodePubkey: state.rootNodePubkey,
  selectedNodePubkey: state.selectedNodePubkey,
  comparedNodePubkeys: state.comparedNodePubkeys,
  expandedNodePubkeys: state.expandedNodePubkeys,
  graphAnalysis: state.graphAnalysis,
  pathfinding: state.pathfinding,
  rootLoadStatus: state.rootLoad.status,
  rootLoadMessage: state.rootLoad.message,
  rootVisibleLinkProgress: state.rootLoad.visibleLinkProgress,
  activeLayer: state.activeLayer,
  connectionsSourceLayer: state.connectionsSourceLayer,
  capReached: state.graphCaps.capReached,
  maxNodes: state.graphCaps.maxNodes,
  nodeExpansionStates: state.nodeExpansionStates,
  renderConfig: state.renderConfig,
  devicePerformanceProfile: state.devicePerformanceProfile,
  effectiveGraphCaps: state.effectiveGraphCaps,
  effectiveImageBudget: state.effectiveImageBudget,
  isViewportActive: state.interactionState.isViewportActive,
})

const selectGraphCanvasPanelState = (state: AppStore) => ({
  openPanel: state.openPanel,
})

const selectGraphCanvasKeywordSearchState = (state: AppStore) => ({
  activeLayer: state.activeLayer,
  currentKeyword: state.currentKeyword,
  keywordLayerStatus: state.keywordLayer.status,
  keywordExtractCount: state.keywordLayer.extractCount,
  keywordMatchCount: state.keywordLayer.matchCount,
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

type ProgressMetricTone = 'discovery' | 'inbound' | 'images'

interface ProgressMetric {
  id: string
  label: string
  summary: string
  detail: string | null
  tone: ProgressMetricTone
  determinate: boolean
  current: number | null
  total: number | null
  value: number | null
}

interface GraphCanvasProps {
  runtime: RootLoader
  onTrySampleRoot: () => void
  onDiagnosticsChange?: (snapshot: GraphCanvasDiagnostics | null) => void
}
// naranja esta aqui
const EMPTY_IMAGE_FRAME = createEmptyImageRenderPayload()
const EMPTY_IMAGE_DIAGNOSTICS = createEmptyImageResidencySnapshot()
const EMPTY_NODE_SCREEN_RADII = new Map<string, number>()
const QUIET_VIEWPORT_READY_MS = 10_000
const AVATAR_HD_VIEWPORT_QUIET_MS = 400
const AVATAR_FULL_HD_VIEWPORT_QUIET_MS = 400
const COALESCED_FRAME_DELAY_MS = 16
const DIAGNOSTICS_COMMIT_DELAY_MS = 250
const RESIZE_SETTLE_DELAY_MS = 80
const VIEWPORT_SETTLE_DELAY_MS = 400
const BOOTSTRAP_IMAGE_QUALITY_MODE = 'performance'

interface HoverGraphState {
  nodePubkey: string | null
  edgeId: string | null
  edgePubkeys: readonly string[]
}

interface ActiveNodeExpansion {
  pubkey: string
  nodeLabel: string
  state: AppStore['nodeExpansionStates'][string]
}

const EMPTY_HOVER_STATE: HoverGraphState = {
  nodePubkey: null,
  edgeId: null,
  edgePubkeys: [],
}

const isRelationshipLayer = (layer: AppStore['activeLayer']) =>
  layer === 'following' ||
  layer === 'following-non-followers' ||
  layer === 'followers' ||
  layer === 'nonreciprocal-followers' ||
  layer === 'mutuals'

const resolveRelationshipControlLayer = (
  activeLayer: AppStore['activeLayer'],
  connectionsSourceLayer: AppStore['connectionsSourceLayer'],
) => (activeLayer === 'connections' ? connectionsSourceLayer : activeLayer)

const getRelationshipToggleState = (activeLayer: AppStore['activeLayer']) => ({
  following:
    activeLayer === 'following' ||
    activeLayer === 'following-non-followers' ||
    activeLayer === 'mutuals',
  followers:
    activeLayer === 'followers' ||
    activeLayer === 'nonreciprocal-followers' ||
    activeLayer === 'mutuals',
  onlyNonReciprocal:
    activeLayer === 'following-non-followers' ||
    activeLayer === 'nonreciprocal-followers',
})

const formatNodeExpansionPhaseLabel = (phase: NodeExpansionState['phase']) => {
  switch (phase) {
    case 'preparing':
      return 'preparando'
    case 'fetching-structure':
      return 'consultando relays'
    case 'correlating-followers':
      return 'correlacionando evidencia'
    case 'merging':
      return 'actualizando grafo'
    case 'idle':
      return 'esperando'
  }
}

const equalStringLists = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const hasRenderableFrameSize = (size: { width: number; height: number }) =>
  size.width > 0 && size.height > 0

const applyImageFrameDiagnostics = ({
  snapshot,
  frameComputationMode,
  frameSkipReason,
  primarySummary,
  secondarySummary,
}: {
  snapshot: ImageResidencySnapshot
  frameComputationMode: ImageFrameComputationMode
  frameSkipReason: ImageFrameSkipReason
  primarySummary?: string
  secondarySummary?: string | null
}): ImageResidencySnapshot => ({
  ...snapshot,
  diagnostics: {
    ...snapshot.diagnostics,
    frameComputationMode,
    frameSkipReason,
    primarySummary: primarySummary ?? snapshot.diagnostics.primarySummary,
    secondarySummary:
      secondarySummary !== undefined
        ? secondarySummary
        : snapshot.diagnostics.secondarySummary,
  },
})

const createSortedCollectionSignature = (values?: ReadonlySet<string>) =>
  values ? Array.from(values).sort().join(',') : ''

const clampProgressValue = (value: number) => Math.max(0, Math.min(1, value))

const getDisplayProgressTotal = (
  progress: Pick<RootCollectionProgress, 'loadedCount' | 'totalCount'>,
) =>
  progress.totalCount === null
    ? null
    : Math.max(progress.totalCount, progress.loadedCount)

const createPathfindingSignature = (
  pathfinding?: Pick<AppStore['pathfinding'], 'status' | 'path'>,
) => `${pathfinding?.status ?? 'idle'}:${pathfinding?.path?.join('>') ?? ''}`

const createRenderConfigSignature = (renderConfig: AppStore['renderConfig']) =>
  [
    renderConfig.edgeThickness,
    renderConfig.arrowType,
    renderConfig.nodeSpacingFactor,
    renderConfig.nodeSizeFactor,
    renderConfig.autoSizeNodes ? 'auto-size' : 'fixed-size',
    renderConfig.showSharedEmphasis ? 'shared-emphasis' : 'no-shared-emphasis',
    renderConfig.imageQualityMode,
  ].join(':')

const createGraphAnalysisSignature = (
  graphAnalysis?: AppStore['graphAnalysis'],
) =>
  [
    graphAnalysis?.analysisKey ?? '',
    graphAnalysis?.status ?? 'idle',
    graphAnalysis?.isStale ? 'stale' : 'fresh',
  ].join(':')

const createBuildRenderModelJobKey = ({
  graphRevision,
  inboundGraphRevision,
  connectionsLinksRevision,
  zapLayerRevision,
  zapLayerStatus,
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
}: {
  graphRevision: number
  inboundGraphRevision: number
  connectionsLinksRevision: number
  zapLayerRevision: number
  zapLayerStatus: AppStore['zapLayer']['status']
  activeLayer: AppStore['activeLayer']
  connectionsSourceLayer: AppStore['connectionsSourceLayer']
  rootNodePubkey: string | null
  selectedNodePubkey: string | null
  expandedNodePubkeys: ReadonlySet<string>
  comparedNodePubkeys?: ReadonlySet<string>
  pathfinding?: Pick<AppStore['pathfinding'], 'status' | 'path'>
  graphAnalysis?: AppStore['graphAnalysis']
  effectiveGraphCaps: AppStore['effectiveGraphCaps']
  renderConfig: AppStore['renderConfig']
}) =>
  JSON.stringify({
    graphRevision,
    inboundGraphRevision,
    connectionsLinksRevision,
    zapLayerRevision,
    zapLayerStatus,
    activeLayer,
    connectionsSourceLayer,
    rootNodePubkey,
    selectedNodePubkey,
    expandedNodePubkeys: createSortedCollectionSignature(expandedNodePubkeys),
    comparedNodePubkeys: createSortedCollectionSignature(comparedNodePubkeys),
    pathfinding: createPathfindingSignature(pathfinding),
    graphAnalysis: createGraphAnalysisSignature(graphAnalysis),
    effectiveGraphCaps,
    renderConfig: createRenderConfigSignature(renderConfig),
  })

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

interface GraphProgressMetricRowProps {
  metric: ProgressMetric
}

const GraphProgressMetricRow = memo(function GraphProgressMetricRow({
  metric,
}: GraphProgressMetricRowProps) {
  const ariaValueNow =
    metric.determinate && metric.total === 0 ? 1 : metric.current
  const ariaValueMax =
    metric.determinate && metric.total === 0 ? 1 : metric.total
  const valueText =
    metric.determinate && metric.current !== null && metric.total !== null
      ? `${metric.label}: ${metric.current} de ${metric.total}. ${metric.summary}`
      : `${metric.label}: ${metric.summary}`

  return (
    <div className="graph-panel__progress-row">
      <span className="graph-panel__progress-label">{metric.label}</span>
      <span className="graph-panel__progress-summary">{metric.summary}</span>
      <div
        aria-label={metric.label}
        aria-valuemax={metric.determinate ? ariaValueMax ?? 100 : undefined}
        aria-valuemin={metric.determinate ? 0 : undefined}
        aria-valuenow={metric.determinate ? ariaValueNow ?? 0 : undefined}
        aria-valuetext={valueText}
        className="graph-panel__progress-track"
        role="progressbar"
      >
        <span
          className={`graph-panel__progress-fill graph-panel__progress-fill--${metric.tone}${
            metric.determinate
              ? ''
              : ' graph-panel__progress-fill--indeterminate'
          }`}
          style={
            metric.determinate
              ? {
                  transform: `scaleX(${clampProgressValue(metric.value ?? 0)})`,
                }
              : undefined
          }
        />
      </div>
      {metric.detail ? (
        <span className="graph-panel__progress-detail">{metric.detail}</span>
      ) : null}
    </div>
  )
})

const emptyStateCopy = (
  status: ReturnType<typeof deriveGraphRenderState>,
  activeLayer: AppStore['activeLayer'],
  connectionsSourceLayer: AppStore['connectionsSourceLayer'],
) => {
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

  if (activeLayer === 'connections') {
    const sourceCopy =
      connectionsSourceLayer === 'following'
        ? 'entre las cuentas que sigue el root'
        : connectionsSourceLayer === 'following-non-followers'
          ? 'entre las cuentas que sigue el root sin follow-back'
          : connectionsSourceLayer === 'followers'
            ? 'entre las cuentas que siguen al root'
            : connectionsSourceLayer === 'nonreciprocal-followers'
              ? 'entre las cuentas que siguen al root sin reciprocidad'
              : connectionsSourceLayer === 'mutuals'
                ? 'entre las cuentas con relacion reciproca con el root'
                : 'entre los nodos visibles de la vista desde la que entraste'
    return {
      title: 'Todavia no hay conexiones internas visibles.',
      body: `Esta vista muestra solo enlaces internos ${sourceCopy}.`,
    }
  }

  if (activeLayer === 'following') {
    return {
      title: 'Todavia no hay follows visibles.',
      body: 'No hay follows salientes visibles todavia desde el root; prueba otros relays o recarga el vecindario.',
    }
  }

  if (activeLayer === 'following-non-followers') {
    return {
      title: 'Todavia no hay follows sin reciprocidad visibles.',
      body: 'Esta vista muestra solo las cuentas que sigue el root y que no lo siguen de vuelta segun la evidencia descubierta.',
    }
  }

  if (activeLayer === 'followers') {
    return {
      title: 'Todavia no hay followers visibles.',
      body: 'No hay follows entrantes visibles todavia hacia el root; prueba otros relays o recarga el vecindario.',
    }
  }

  if (activeLayer === 'nonreciprocal-followers') {
    return {
      title: 'Todavia no hay seguidores sin reciprocidad visibles.',
      body: 'Esta vista muestra solo las cuentas que siguen al root y no reciben reciprocidad segun la evidencia descubierta.',
    }
  }

  if (activeLayer === 'mutuals') {
    return {
      title: 'Todavia no hay vinculos reciprocos visibles.',
      body: 'Hace falta descubrir follows salientes y entrantes del root y de los nodos expandidos para confirmar relaciones reciprocas.',
    }
  }

  return {
    title: 'Aun no hay un vecindario descubierto para renderizar.',
    body: 'Carga un root valido para ver el grafo incremental con pan, zoom y seleccion.',
  }
}

interface GraphCanvasRecoveryChromeProps {
  browserOnline: boolean
  links: AppStore['links']
  rootLoadMessage: string | null
  rootLoadStatus: AppStore['rootLoad']['status']
  rootNodePubkey: string | null
  shouldMountRenderer: boolean
  onTrySampleRoot: () => void
}

const GraphCanvasRecoveryChrome = memo(function GraphCanvasRecoveryChrome({
  browserOnline,
  links,
  rootLoadMessage,
  rootLoadStatus,
  rootNodePubkey,
  shouldMountRenderer,
  onTrySampleRoot,
}: GraphCanvasRecoveryChromeProps) {
  const { relayUrls, relayHealth } = useAppStore(
    useShallow(selectRelayHealthData),
  )
  const coverageRecovery = useMemo(
    () =>
      deriveCoverageRecovery({
        browserOnline,
        relayUrls,
        relayHealth,
        rootNodePubkey,
        rootLoadStatus,
        links,
      }),
    [browserOnline, links, relayHealth, relayUrls, rootLoadStatus, rootNodePubkey],
  )
  const shouldShowRecoveryOverlay =
    shouldMountRenderer && coverageRecovery.shouldOfferRecovery

  return (
    <>
      {shouldShowRecoveryOverlay ? (
        <div className="graph-panel__overlay-stack">
          {coverageRecovery.reason ? (
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
          ) : null}
        </div>
      ) : null}
    </>
  )
})

interface GraphCanvasPanelsProps {
  hasSelectedNode: boolean
  imageRuntime: ImageRuntime | null
  runtime: RootLoader
}

const GraphCanvasPanels = memo(function GraphCanvasPanels({
  hasSelectedNode,
  imageRuntime,
  runtime,
}: GraphCanvasPanelsProps) {
  const { openPanel } = useAppStore(useShallow(selectGraphCanvasPanelState))
  const isNodeDetailOpen = openPanel === 'node-detail' && hasSelectedNode
  const isPathfindingOpen = openPanel === 'pathfinding'

  return (
    <>
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
    </>
  )
})

interface GraphCanvasKeywordSearchProps {
  runtime: RootLoader
}

const GraphCanvasKeywordSearch = memo(function GraphCanvasKeywordSearch({
  runtime,
}: GraphCanvasKeywordSearchProps) {
  const {
    activeLayer,
    currentKeyword,
    keywordLayerStatus,
    keywordExtractCount,
    keywordMatchCount,
  } = useAppStore(useShallow(selectGraphCanvasKeywordSearchState))
  const [draft, setDraft] = useState(currentKeyword)
  const [isSearching, setIsSearching] = useState(false)
  const deferredDraft = useDeferredValue(draft)
  const requestSequenceRef = useRef(0)

  useEffect(() => {
    if (activeLayer !== 'keywords' || keywordLayerStatus !== 'enabled') {
      return
    }

    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    const timer = window.setTimeout(() => {
      setIsSearching(true)
      void runtime
        .searchKeyword(deferredDraft)
        .catch((error) => {
          console.warn('[graph] Keyword search failed.', error)
        })
        .finally(() => {
          if (requestSequenceRef.current === requestId) {
            setIsSearching(false)
          }
        })
    }, 180)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeLayer, deferredDraft, keywordLayerStatus, runtime])

  const isKeywordSearchUsable = keywordLayerStatus === 'enabled'
  const keywordInputPlaceholder =
    keywordLayerStatus === 'enabled'
      ? 'Buscar keyword o interes'
      : 'Esperando corpus de notas'
  const keywordMeta = isKeywordSearchUsable && isSearching
    ? 'Buscando...'
    : keywordMatchCount > 0
      ? `${keywordMatchCount} hits`
      : keywordExtractCount > 0
        ? `${keywordExtractCount} extractos`
        : 'Sin corpus'

  return (
    <div className="graph-panel__keyword-search">
      <input
        aria-label="Buscar keyword o interes"
        className="graph-panel__keyword-input"
        disabled={!isKeywordSearchUsable}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        placeholder={keywordInputPlaceholder}
        type="search"
        value={draft}
      />
      <span className="graph-panel__keyword-meta">{keywordMeta}</span>
    </div>
  )
})

export const GraphCanvas = memo(function GraphCanvas({
  runtime,
  onTrySampleRoot,
  onDiagnosticsChange,
}: GraphCanvasProps) {
  const {
    nodes,
    links,
    inboundLinks,
    connectionsLinks,
    connectionsLinksRevision,
    graphRevision,
    inboundGraphRevision,
    zapEdges,
    zapLayerStatus,
    zapLayerRevision,
    keywordLayerStatus,
    keywordLayerMessage,
    keywordExtractCount,
    keywordCorpusNodeCount,
    keywordLoadedFrom,
    keywordIsPartial,
    keywordMatchCount,
    keywordMatchNodeCount,
    rootNodePubkey,
    selectedNodePubkey,
    comparedNodePubkeys,
    expandedNodePubkeys,
    graphAnalysis,
    pathfinding,
    rootLoadStatus,
    rootLoadMessage,
    rootVisibleLinkProgress,
    activeLayer,
    connectionsSourceLayer,
    capReached,
    maxNodes,
    nodeExpansionStates,
    renderConfig,
    devicePerformanceProfile,
    effectiveGraphCaps,
    effectiveImageBudget,
    isViewportActive,
  } = useAppStore(useShallow(selectGraphCanvasRenderState))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const perfCountersRef = useRef(createPerfCounters())
  const [hoverState, setHoverState] = useState<HoverGraphState>(EMPTY_HOVER_STATE)
  const [interactionViewState, setInteractionViewState] = useState<{
    signature: string
    viewState: GraphViewState
  } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const sizeRef = useRef({ width: 0, height: 0 })
  const [heavyWorkSize, setHeavyWorkSize] = useState({ width: 0, height: 0 })
  const [heavyWorkViewState, setHeavyWorkViewState] =
    useState<GraphViewState | null>(null)
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const previousRenderSnapshotRef = useRef({
    nodes,
    links,
    zapEdges,
    selectedNodePubkey,
    activeLayer,
    rootLoadStatus,
    size,
    hoveredNodePubkey: hoverState.nodePubkey,
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
  const imageRefreshTimerRef = useRef<number | null>(null)
  const diagnosticsCommitTimerRef = useRef<number | null>(null)
  const resizeSettleTimerRef = useRef<number | null>(null)
  const viewportSettleTimerRef = useRef<number | null>(null)
  const [imageRuntime, setImageRuntime] = useState<ImageRuntime | null>(null)
  const [imageFrame, setImageFrame] =
    useState<ImageRenderPayload>(EMPTY_IMAGE_FRAME)
  const imageDiagnosticsSnapshotRef =
    useRef<ImageResidencySnapshot>(EMPTY_IMAGE_DIAGNOSTICS)
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
  const viewportActiveRef = useRef(false)
  const pendingSettledViewStateRef = useRef<GraphViewState | null>(null)
  const imageBootstrapPendingRef = useRef(false)
  const lastImageBootstrapSignatureRef = useRef<string | null>(null)
  const lastBuildJobKeyRef = useRef<string | null>(null)
  const lastQueuedBuildJobKeyRef = useRef<string | null>(null)
  const viewportVelocityRef = useRef(0)
  const viewportQuietForMsRef = useRef(QUIET_VIEWPORT_READY_MS)
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [isPointerCoarse, setIsPointerCoarse] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(pointer: coarse)').matches,
  )
  const hoveredNodePubkey = hoverState.nodePubkey
  const hoveredEdgeId = hoverState.edgeId
  const hoveredEdgePubkeys = hoverState.edgePubkeys
  const isMobileProfile = isMobileDevicePerformanceProfile(
    devicePerformanceProfile,
  )
  const hoverInteractionEnabled = !isPointerCoarse
  const shouldCollectDiagnostics = onDiagnosticsChange !== undefined

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
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const handleChange = (event: MediaQueryListEvent) => {
      setIsPointerCoarse(event.matches)
    }

    setIsPointerCoarse(mediaQuery.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => {
        mediaQuery.removeEventListener('change', handleChange)
      }
    }

    mediaQuery.addListener(handleChange)
    return () => {
      mediaQuery.removeListener(handleChange)
    }
  }, [])

  useEffect(() => {
    clearAvatarPipelineProbe()
    const nextImageRuntime = new ImageRuntime({
      budgetOverrides: isMobileProfile
        ? {
            performance: {
              vramBytes: effectiveImageBudget.vramBytes,
              decodedBytes: effectiveImageBudget.decodedBytes,
              compressedBytes: effectiveImageBudget.compressedBytes,
            },
          }
        : undefined,
      baseFetchConcurrency: effectiveImageBudget.baseFetchConcurrency,
      boostedFetchConcurrency: effectiveImageBudget.boostedFetchConcurrency,
      allowHdTiers: effectiveImageBudget.allowHdTiers,
      allowParallelDirectFallback:
        effectiveImageBudget.allowParallelDirectFallback,
    })
    imageRuntimeRef.current = nextImageRuntime
    const unsubscribe = nextImageRuntime.subscribe(() => {
      if (imageRefreshTimerRef.current !== null) {
        return
      }

      const nextDelayMs = imageBootstrapPendingRef.current
        ? 0
        : COALESCED_FRAME_DELAY_MS
      imageRefreshTimerRef.current = window.setTimeout(() => {
        imageRefreshTimerRef.current = null
        refreshImageFrameRef.current()
      }, nextDelayMs)
    })

    setImageRuntime(nextImageRuntime)

    return () => {
      unsubscribe()
      nextImageRuntime.dispose()
      imageRuntimeRef.current = null
      if (imageRefreshTimerRef.current !== null) {
        window.clearTimeout(imageRefreshTimerRef.current)
        imageRefreshTimerRef.current = null
      }
      if (diagnosticsCommitTimerRef.current !== null) {
        window.clearTimeout(diagnosticsCommitTimerRef.current)
        diagnosticsCommitTimerRef.current = null
      }
      setImageFrame(EMPTY_IMAGE_FRAME)
      imageDiagnosticsSnapshotRef.current = EMPTY_IMAGE_DIAGNOSTICS
      setImageDiagnosticsSnapshot(EMPTY_IMAGE_DIAGNOSTICS)
      clearAvatarPipelineProbe()
      setImageRuntime(null)
    }
  }, [
    effectiveImageBudget.allowParallelDirectFallback,
    effectiveImageBudget.allowHdTiers,
    effectiveImageBudget.baseFetchConcurrency,
    effectiveImageBudget.boostedFetchConcurrency,
    effectiveImageBudget.compressedBytes,
    effectiveImageBudget.decodedBytes,
    effectiveImageBudget.vramBytes,
    isMobileProfile,
  ])

  useEffect(() => {
    const gateway = createGraphRenderModelWorkerGateway()
    setGraphRenderWorker(gateway)

    return () => {
      setGraphRenderWorker((current) => (current === gateway ? null : current))
      gateway.dispose()
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

    if (Math.abs(viewportQuietForMsRef.current - nextQuietForMs) < 8) {
      return
    }

    viewportQuietForMsRef.current = nextQuietForMs
  }, [])

  const scheduleImageFrameRefresh = useCallback(
    (delayMs = COALESCED_FRAME_DELAY_MS) => {
      if (imageRefreshTimerRef.current !== null) {
        window.clearTimeout(imageRefreshTimerRef.current)
      }

      imageRefreshTimerRef.current = window.setTimeout(() => {
        imageRefreshTimerRef.current = null
        refreshImageFrameRef.current()
      }, delayMs)
    },
    [],
  )

  const markViewportSettled = useCallback(
    (settledAt: number, nextViewState?: GraphViewState | null) => {
      viewportActiveRef.current = false
      viewportVelocityRef.current = 0
      viewportQuietForMsRef.current = Math.max(
        0,
        readNowMs() - (lastViewportInteractionAtRef.current ?? settledAt),
      )
      appStore.getState().markViewportSettled(settledAt)
      if (nextViewState) {
        pendingSettledViewStateRef.current = nextViewState
        setHeavyWorkViewState(nextViewState)
        imageBootstrapPendingRef.current = false
      }
      scheduleImageFrameRefresh()
    },
    [scheduleImageFrameRefresh],
  )

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
      const previousSize = sizeRef.current
      if (previousSize.width === nextWidth && previousSize.height === nextHeight) {
        return
      }

      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current)
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        resizeSettleTimerRef.current = null
        setHeavyWorkSize({ width: nextWidth, height: nextHeight })
        markViewportSettled(readNowMs(), pendingSettledViewStateRef.current)
      }, RESIZE_SETTLE_DELAY_MS)

      if (previousSize.width === 0 && previousSize.height === 0) {
        setHeavyWorkSize({ width: nextWidth, height: nextHeight })
      }

      const nextSize = {
        width: nextWidth,
        height: nextHeight,
      }
      sizeRef.current = nextSize
      setSize(nextSize)
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
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current)
        resizeSettleTimerRef.current = null
      }
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [markViewportSettled])

  const scheduleViewportSettled = useCallback(
    (delayMs: number, nextViewState?: GraphViewState | null) => {
      if (viewportSettleTimerRef.current !== null) {
        window.clearTimeout(viewportSettleTimerRef.current)
      }

      viewportSettleTimerRef.current = window.setTimeout(() => {
        viewportSettleTimerRef.current = null
        markViewportSettled(readNowMs(), nextViewState ?? pendingSettledViewStateRef.current)
      }, delayMs)
    },
    [markViewportSettled],
  )

  const markViewportInteraction = useCallback((nextViewState?: GraphViewState | null) => {
    const nextInteractionAt = readNowMs()
    viewportActiveRef.current = true
    pendingSettledViewStateRef.current = nextViewState ?? pendingSettledViewStateRef.current
    appStore.getState().markViewportInteraction(nextInteractionAt)
    lastViewportInteractionAtRef.current = nextInteractionAt
    viewportQuietForMsRef.current = 0
    scheduleViewportSettled(VIEWPORT_SETTLE_DELAY_MS, nextViewState)
  }, [scheduleViewportSettled])

  const scheduleImageDiagnosticsCommit = useCallback(() => {
    if (diagnosticsCommitTimerRef.current !== null) {
      return
    }

    diagnosticsCommitTimerRef.current = window.setTimeout(() => {
      diagnosticsCommitTimerRef.current = null
      startTransition(() => {
        setImageDiagnosticsSnapshot(imageDiagnosticsSnapshotRef.current)
      })
    }, DIAGNOSTICS_COMMIT_DELAY_MS)
  }, [])

  const workerQueueRefs = useRef({
    isBusy: false,
    pendingInput: null as Omit<
      Parameters<typeof serializeBuildGraphRenderModelInput>[0],
      'previousPositions' | 'previousLayoutKey'
    > | null,
  })
  const triggerFlushRef = useRef<() => void>(undefined)
  const workerFlushTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (workerFlushTimerRef.current !== null) {
        window.clearTimeout(workerFlushTimerRef.current)
        workerFlushTimerRef.current = null
      }
      if (imageRefreshTimerRef.current !== null) {
        window.clearTimeout(imageRefreshTimerRef.current)
        imageRefreshTimerRef.current = null
      }
      if (diagnosticsCommitTimerRef.current !== null) {
        window.clearTimeout(diagnosticsCommitTimerRef.current)
        diagnosticsCommitTimerRef.current = null
      }
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current)
        resizeSettleTimerRef.current = null
      }
      if (viewportSettleTimerRef.current !== null) {
        window.clearTimeout(viewportSettleTimerRef.current)
        viewportSettleTimerRef.current = null
      }
      imageBootstrapPendingRef.current = false
      lastImageBootstrapSignatureRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!graphRenderWorker) {
      return
    }

    let effectDisposed = false

    const scheduleWorkerFlush = () => {
      if (workerFlushTimerRef.current !== null) {
        return
      }

      workerFlushTimerRef.current = window.setTimeout(() => {
        workerFlushTimerRef.current = null
        triggerFlushRef.current?.()
      }, COALESCED_FRAME_DELAY_MS)
    }

    workerQueueRefs.current.pendingInput = {
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
      pathfinding: {
        status: pathfinding.status,
        path: pathfinding.path,
      },
      graphAnalysis,
      effectiveGraphCaps,
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
        !effectDisposed && renderRequestSequenceRef.current === requestId

      const onWorkerSettled = () => {
        workerQueueRefs.current.isBusy = false
        scheduleWorkerFlush()
      }

      const commitModel = (nextModel: GraphRenderModel) => {
        if (!isCurrentRequest()) {
          onWorkerSettled()
          return
        }

        if (request.jobKey) {
          lastBuildJobKeyRef.current = request.jobKey
        }

        previousPositionsRef.current = new Map(
          nextModel.nodes.map((node) => [node.pubkey, node.position]),
        )
        previousLayoutKeyRef.current = nextModel.layoutKey

        // setModel fuera de startTransition: React 19 difiere las transiciones
        // hasta que el usuario interactúa, lo que dejaba model.nodes vacío y
        // bloqueaba prepareFrame (mismos motivos que setImageFrame — ver abajo).
        setModel(nextModel)
        startTransition(() => {
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
        setModel((current) =>
          current.nodes.length === 0 &&
          (current.activeLayer !== input.activeLayer ||
            current.renderConfig !== input.renderConfig)
            ? createEmptyGraphRenderModel(input.activeLayer, input.renderConfig)
            : current,
        )
      }

      const jobKey = createBuildRenderModelJobKey({
        graphRevision,
        inboundGraphRevision,
        connectionsLinksRevision,
        zapLayerRevision,
        zapLayerStatus,
        activeLayer: input.activeLayer,
        connectionsSourceLayer: input.connectionsSourceLayer,
        rootNodePubkey: input.rootNodePubkey,
        selectedNodePubkey: input.selectedNodePubkey,
        expandedNodePubkeys: input.expandedNodePubkeys,
        comparedNodePubkeys: input.comparedNodePubkeys,
        pathfinding: input.pathfinding,
        graphAnalysis: input.graphAnalysis,
        effectiveGraphCaps: input.effectiveGraphCaps,
        renderConfig: input.renderConfig,
      })
      const request = serializeBuildGraphRenderModelInput(buildInput)

      if (
        jobKey === lastBuildJobKeyRef.current ||
        jobKey === lastQueuedBuildJobKeyRef.current
      ) {
        onWorkerSettled()
        return
      }

      request.jobKind = 'BUILD_RENDER_MODEL'
      request.jobKey = jobKey
      lastQueuedBuildJobKeyRef.current = jobKey

      void graphRenderWorker
        .invoke('BUILD_RENDER_MODEL', request)
        .then((nextModel) => {
          if (lastQueuedBuildJobKeyRef.current === request.jobKey) {
            lastQueuedBuildJobKeyRef.current = null
          }
          commitModel(nextModel)
        })
        .catch((workerError) => {
          if (lastQueuedBuildJobKeyRef.current === request.jobKey) {
            lastQueuedBuildJobKeyRef.current = null
          }
          failModelBuild(workerError)
        })
    }

    triggerFlushRef.current = flushWorkerQueue
    scheduleWorkerFlush()

    return () => {
      effectDisposed = true
    }
  }, [
    activeLayer,
    connectionsSourceLayer,
    connectionsLinks,
    connectionsLinksRevision,
    comparedNodePubkeys,
    expandedNodePubkeys,
    graphRevision,
    graphAnalysis,
    graphRenderWorker,
    inboundGraphRevision,
    links,
    inboundLinks,
    nodes,
    pathfinding.path,
    pathfinding.status,
    rootNodePubkey,
    selectedNodePubkey,
    zapEdges,
    zapLayerRevision,
    zapLayerStatus,
    effectiveGraphCaps,
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
            topologySignature:
              model.activeLayer === 'connections'
                ? [
                    model.activeLayer,
                    connectionsSourceLayer,
                    rootNodePubkey ?? 'none',
                  ].join('|')
                : model.topologySignature,
              width: size.width,
              height: size.height,
            })
          : 'empty',
    [
      connectionsSourceLayer,
      model.activeLayer,
      model.topologySignature,
      rootNodePubkey,
      size.height,
      size.width,
    ],
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

  const imageBootstrapSignature = useMemo(() => {
    if (
      !resolvedViewState ||
      size.width <= 0 ||
      size.height <= 0 ||
      model.nodes.length === 0
    ) {
      return null
    }

    return [
      fitSignature,
      rootNodePubkey ?? 'none',
      model.topologySignature,
      size.width,
      size.height,
    ].join('|')
  }, [
    fitSignature,
    model.nodes.length,
    model.topologySignature,
    resolvedViewState,
    rootNodePubkey,
    size.height,
    size.width,
  ])

  const viewState = useMemo(() => {
    if (equalGraphViewState(stableViewStateRef.current, resolvedViewState)) {
      return stableViewStateRef.current
    }

    stableViewStateRef.current = resolvedViewState
    return resolvedViewState
  }, [resolvedViewState])

  useEffect(() => {
    if (!imageBootstrapSignature) {
      lastImageBootstrapSignatureRef.current = null
      imageBootstrapPendingRef.current = false
      return
    }

    if (lastImageBootstrapSignatureRef.current === imageBootstrapSignature) {
      return
    }

    lastImageBootstrapSignatureRef.current = imageBootstrapSignature
    imageBootstrapPendingRef.current = true

    if (resolvedViewState) {
      pendingSettledViewStateRef.current = resolvedViewState
    }

    if (size.width > 0 && size.height > 0) {
      scheduleImageFrameRefresh(0)
    }
  }, [
    imageBootstrapSignature,
    resolvedViewState,
    scheduleImageFrameRefresh,
    size.height,
    size.width,
  ])

  useEffect(() => {
    if (!resolvedViewState) {
      pendingSettledViewStateRef.current = null
      imageBootstrapPendingRef.current = false
      setHeavyWorkViewState(null)
      return
    }

    pendingSettledViewStateRef.current = resolvedViewState

    setHeavyWorkViewState((current) => {
      if (equalGraphViewState(current, resolvedViewState)) {
        return current
      }
      // Durante interacción activa del viewport, preservamos el último estado
      // settled para no degradar la calidad de imagen mientras el usuario mueve.
      // Excepción: si todavía no hay ningún estado (carga inicial), lo aplicamos
      // de inmediato para que el primer prepareFrame arranque las descargas sin
      // esperar el settle de 400ms.
      if (viewportActiveRef.current && current !== null) {
        return current
      }
      return resolvedViewState
    })
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

    if (isMobileProfile && isViewportActive) {
      return resolveGraphNodeScreenRadiiFast({
        nodes: model.nodes,
        activeLayer: model.activeLayer,
        viewState,
        visibleNodeCount: model.lod.visibleNodeCount,
      })
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
    isViewportActive,
    isMobileProfile,
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
    const hasSettledFrame =
      heavyWorkViewState !== null && hasRenderableFrameSize(heavyWorkSize)
    const hasBootstrapFrame =
      resolvedViewState !== null &&
      hasRenderableFrameSize(size) &&
      model.nodes.length > 0
    const shouldUseBootstrapFrame =
      imageBootstrapPendingRef.current &&
      hasBootstrapFrame &&
      (
        !hasSettledFrame ||
        heavyWorkSize.width !== size.width ||
        heavyWorkSize.height !== size.height ||
        !equalGraphViewState(heavyWorkViewState, resolvedViewState)
      )

    if (!runtimeInstance || (!hasSettledFrame && !shouldUseBootstrapFrame)) {
      const frameSkipReason: ImageFrameSkipReason =
        !runtimeInstance
          ? 'no-runtime'
          : !hasRenderableFrameSize(size)
            ? 'no-size'
            : resolvedViewState === null || model.nodes.length === 0
              ? 'no-viewstate'
              : 'waiting-settle'

      const nextImageDiagnostics = applyImageFrameDiagnostics({
        snapshot: createEmptyImageResidencySnapshot(),
        frameComputationMode: 'idle',
        frameSkipReason,
        primarySummary:
          frameSkipReason === 'waiting-settle'
            ? 'Esperando viewport settled para refrescar avatars.'
            : frameSkipReason === 'no-size'
              ? 'El viewport todavia no tiene tamaño util.'
              : frameSkipReason === 'no-viewstate'
                ? 'Todavia no hay un viewState listo para calcular avatars.'
                : 'El runtime de imagenes todavia no esta listo.',
      })

      setImageFrame((current) =>
        equalImageRenderPayload(current, EMPTY_IMAGE_FRAME)
          ? current
          : EMPTY_IMAGE_FRAME,
      )
      imageDiagnosticsSnapshotRef.current = nextImageDiagnostics
      publishAvatarPipelineProbe({
        activeLayer,
        readyImageCount: 0,
        rootLoadStatus,
        snapshot: nextImageDiagnostics,
      })
      scheduleImageDiagnosticsCommit()
      return
    }

    const frameComputationMode: ImageFrameComputationMode =
      shouldUseBootstrapFrame ? 'bootstrap' : 'settled'
    const nextImageFrame = runtimeInstance.prepareFrame({
      width: shouldUseBootstrapFrame ? size.width : heavyWorkSize.width,
      height: shouldUseBootstrapFrame ? size.height : heavyWorkSize.height,
      viewState: shouldUseBootstrapFrame ? resolvedViewState! : heavyWorkViewState!,
      velocityScore: shouldUseBootstrapFrame ? 0 : viewportVelocityRef.current,
      viewportQuietForMs: shouldUseBootstrapFrame
        ? QUIET_VIEWPORT_READY_MS
        : viewportQuietForMsRef.current,
      isViewportActive: shouldUseBootstrapFrame ? false : viewportActiveRef.current,
      nodes: model.nodes,
      nodeScreenRadii: stableNodeScreenRadii,
      selectedNodePubkey,
      hoveredNodePubkey,
      mode: shouldUseBootstrapFrame
        ? BOOTSTRAP_IMAGE_QUALITY_MODE
        : renderConfig.imageQualityMode,
      avatarHdZoomThreshold: renderConfig.avatarHdZoomThreshold,
      avatarFullHdZoomThreshold: renderConfig.avatarFullHdZoomThreshold,
    })
    const nextImageDiagnostics = applyImageFrameDiagnostics({
      snapshot: runtimeInstance.debugSnapshot(),
      frameComputationMode,
      frameSkipReason: shouldUseBootstrapFrame ? 'bootstrap-fallback' : 'none',
      secondarySummary:
        shouldUseBootstrapFrame
          ? 'Bootstrap inicial usando viewport vivo para poblar avatars base visibles.'
          : undefined,
    })
    imageDiagnosticsSnapshotRef.current = nextImageDiagnostics
    publishAvatarPipelineProbe({
      activeLayer,
      readyImageCount: Object.keys(nextImageFrame.readyImagesByPubkey).length,
      rootLoadStatus,
      snapshot: nextImageDiagnostics,
    })

    if (!shouldUseBootstrapFrame) {
      imageBootstrapPendingRef.current = false
    }

    // imageFrame es datos críticos de renderizado: sacar del startTransition para
    // que React lo aplique de forma síncrona en el próximo commit. Dentro de
    // startTransition React 19 lo marca como interruptible y puede diferirlo
    // indefinidamente hasta que el usuario haga una interacción (el zoom), que
    // era exactamente el síntoma "las imágenes no cargan hasta hacer zoom".
    setImageFrame((current) =>
      equalImageRenderPayload(current, nextImageFrame)
        ? current
        : nextImageFrame,
    )
    scheduleImageDiagnosticsCommit()
  }

  useEffect(() => {
    publishAvatarPipelineProbe({
      activeLayer,
      readyImageCount: Object.keys(imageFrame.readyImagesByPubkey).length,
      rootLoadStatus,
      snapshot: imageDiagnosticsSnapshotRef.current,
    })
  }, [activeLayer, imageFrame, rootLoadStatus])

  useEffect(() => {
    scheduleImageFrameRefresh()
  }, [
    heavyWorkSize.height,
    heavyWorkSize.width,
    heavyWorkViewState,
    imageRuntime,
    model.nodes,
    stableNodeScreenRadii,
    renderConfig.avatarFullHdZoomThreshold,
    renderConfig.avatarHdZoomThreshold,
    renderConfig.imageQualityMode,
    selectedNodePubkey,
    scheduleImageFrameRefresh,
  ])

  useEffect(() => {
    if (viewportActiveRef.current) {
      return
    }

    scheduleImageFrameRefresh(48)
  }, [
    hoveredNodePubkey,
    scheduleImageFrameRefresh,
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
          scheduleImageFrameRefresh()
        }, delayMs + 1),
      )

    return () => {
      for (const timeoutId of timeouts) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [refreshViewportQuietState, scheduleImageFrameRefresh, viewState])

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
      if (!hoverInteractionEnabled) {
        return
      }

      const nextHoverState: HoverGraphState =
        hover === null
          ? EMPTY_HOVER_STATE
          : hover.type === 'node'
            ? {
                nodePubkey: hover.pubkey,
                edgeId: null,
                edgePubkeys: EMPTY_HOVER_STATE.edgePubkeys,
              }
            : {
                nodePubkey: null,
                edgeId: hover.edgeId,
                edgePubkeys: hover.pubkeys,
              }

      startTransition(() => {
        setHoverState((current) => {
          if (
            current.nodePubkey === nextHoverState.nodePubkey &&
            current.edgeId === nextHoverState.edgeId &&
            current.edgePubkeys.length === nextHoverState.edgePubkeys.length &&
            current.edgePubkeys.every(
              (value, index) => value === nextHoverState.edgePubkeys[index],
            )
          ) {
            return current
          }

          return nextHoverState
        })
      })
    },
    [hoverInteractionEnabled],
  )

  useEffect(() => {
    if (!hoverInteractionEnabled) {
      setHoverState(EMPTY_HOVER_STATE)
    }
  }, [hoverInteractionEnabled])

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

        if (Math.abs(viewportVelocityRef.current - nextVelocity) >= 1) {
          viewportVelocityRef.current = nextVelocity
        }
      }

      lastViewSampleRef.current = {
        at: currentSampleAt,
        target: [nextViewState.target[0], nextViewState.target[1]],
        zoom: nextViewState.zoom,
      }
      markViewportInteraction(nextViewState)

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

  const setConnectionsSourceLayer = useAppStore(
    (storeState) => storeState.setConnectionsSourceLayer,
  )
  const relationshipControlLayer = resolveRelationshipControlLayer(
    activeLayer,
    connectionsSourceLayer,
  )
  const relationshipToggleState = getRelationshipToggleState(
    relationshipControlLayer,
  )
  const onlyOneRelationshipSideActive =
    relationshipToggleState.following !== relationshipToggleState.followers
  const canToggleOnlyNonReciprocal =
    isRelationshipLayer(relationshipControlLayer) &&
    (relationshipToggleState.following || relationshipToggleState.followers)

  const handleToggleRelationship = useCallback(
    (role: 'following' | 'followers') => {
      const current = getRelationshipToggleState(relationshipControlLayer)
      const nextFollowing =
        role === 'following' ? !current.following : current.following
      const nextFollowers =
        role === 'followers' ? !current.followers : current.followers

      if (activeLayer === 'connections') {
        if (!nextFollowing && !nextFollowers) {
          setConnectionsSourceLayer('graph')
          return
        }

        if (nextFollowing && nextFollowers) {
          setConnectionsSourceLayer('mutuals')
          return
        }

        if (nextFollowing) {
          setConnectionsSourceLayer(
            current.onlyNonReciprocal ? 'following-non-followers' : 'following',
          )
          return
        }

        setConnectionsSourceLayer(
          current.onlyNonReciprocal
            ? 'nonreciprocal-followers'
            : 'followers',
        )
        return
      }

      if (!nextFollowing && !nextFollowers) {
        runtime.toggleLayer('graph')
        return
      }

      if (nextFollowing && nextFollowers) {
        runtime.toggleLayer('mutuals')
        return
      }

      if (nextFollowing) {
        runtime.toggleLayer(
          current.onlyNonReciprocal ? 'following-non-followers' : 'following',
        )
        return
      }

      runtime.toggleLayer(
        current.onlyNonReciprocal
          ? 'nonreciprocal-followers'
          : 'followers',
      )
    },
    [activeLayer, relationshipControlLayer, runtime, setConnectionsSourceLayer],
  )

  const handleToggleOnlyNonReciprocal = useCallback(() => {
    const current = getRelationshipToggleState(relationshipControlLayer)

    if (!canToggleOnlyNonReciprocal || !onlyOneRelationshipSideActive) {
      return
    }

    if (activeLayer === 'connections') {
      if (current.following) {
        setConnectionsSourceLayer(
          current.onlyNonReciprocal ? 'following' : 'following-non-followers',
        )
        return
      }

      if (current.followers) {
        setConnectionsSourceLayer(
          current.onlyNonReciprocal
            ? 'followers'
            : 'nonreciprocal-followers',
        )
      }
      return
    }

    if (current.following) {
      runtime.toggleLayer(
        current.onlyNonReciprocal ? 'following' : 'following-non-followers',
      )
      return
    }

    if (current.followers) {
      runtime.toggleLayer(
        current.onlyNonReciprocal
          ? 'followers'
          : 'nonreciprocal-followers',
      )
    }
  }, [
    activeLayer,
    canToggleOnlyNonReciprocal,
    onlyOneRelationshipSideActive,
    relationshipControlLayer,
    runtime,
    setConnectionsSourceLayer,
  ])

  useEffect(() => {
    lastViewSampleRef.current = null
    lastViewportInteractionAtRef.current = null
    viewportActiveRef.current = false
    pendingSettledViewStateRef.current = null
    viewportVelocityRef.current = 0
    viewportQuietForMsRef.current = QUIET_VIEWPORT_READY_MS
    appStore.getState().markViewportSettled(readNowMs())
    setHeavyWorkViewState(resolvedViewState)
  }, [fitSignature, resolvedViewState])

  const overlayCopy = emptyStateCopy(
    renderState,
    activeLayer,
    connectionsSourceLayer,
  )
  const activeNodeExpansions = useMemo<ActiveNodeExpansion[]>(
    () =>
      Object.entries(nodeExpansionStates)
        .filter(([, expansionState]) => expansionState.status === 'loading')
        .sort(
          ([, left], [, right]) =>
            (right.startedAt ?? right.updatedAt ?? 0) -
            (left.startedAt ?? left.updatedAt ?? 0),
        )
        .map(([pubkey, expansionState]) => ({
          pubkey,
          nodeLabel:
            nodes[pubkey]?.label?.trim() || truncatePubkey(pubkey, 8, 6),
          state: expansionState,
        })),
    [nodeExpansionStates, nodes],
  )
  const primaryActiveExpansion = activeNodeExpansions[0] ?? null
  const shouldMountRenderer =
    model.nodes.length > 0 &&
    size.width > 0 &&
    size.height > 0 &&
    viewState !== null
  const shouldShowEmptyState =
    !shouldMountRenderer &&
    rootNodePubkey !== null &&
    rootLoadStatus !== 'loading' &&
    renderState.status !== 'rendering'
  const rootDiscoveryStatusCopy =
    rootVisibleLinkProgress === null
      ? null
      : rootVisibleLinkProgress.visibleLinkCount !== null
        ? `${rootVisibleLinkProgress.visibleLinkCount} links descubiertos`
        : rootVisibleLinkProgress.contactListEventCount +
              rootVisibleLinkProgress.inboundCandidateEventCount >
            0
          ? `${
              rootVisibleLinkProgress.contactListEventCount +
              rootVisibleLinkProgress.inboundCandidateEventCount
            } eventos recibidos`
          : 'Buscando links visibles'
  const rootDiscoveryProgressDetail =
    rootVisibleLinkProgress === null
      ? null
      : [
          `${rootVisibleLinkProgress.contactListEventCount} contact lists`,
          `${rootVisibleLinkProgress.inboundCandidateEventCount} candidatos inbound`,
          rootVisibleLinkProgress.lastRelayUrl
            ? `ultimo relay ${rootVisibleLinkProgress.lastRelayUrl}`
            : null,
        ]
          .filter(Boolean)
          .join(' / ')
  const rootFollowCount = useMemo(
    () =>
      rootNodePubkey === null
        ? 0
        : links.filter(
            (link) =>
              link.source === rootNodePubkey && link.relation === 'follow',
          ).length,
    [links, rootNodePubkey],
  )
  const rootInboundCount = useMemo(
    () =>
      rootNodePubkey === null
        ? 0
        : new Set(
            inboundLinks
              .filter(
                (link) =>
                  link.target === rootNodePubkey && link.relation === 'inbound',
              )
              .map((link) => link.source),
          ).size,
    [inboundLinks, rootNodePubkey],
  )
  const progressMetrics = useMemo<ProgressMetric[]>(() => {
    const hasRoot = rootNodePubkey !== null
    const followingProgress: RootCollectionProgress = rootVisibleLinkProgress?.following ?? {
      status:
        hasRoot &&
        (rootLoadStatus === 'ready' ||
          rootLoadStatus === 'partial' ||
          rootLoadStatus === 'empty' ||
          rootLoadStatus === 'error')
          ? 'complete'
          : hasRoot
            ? 'loading'
            : 'idle',
      loadedCount: rootFollowCount,
      totalCount:
        hasRoot && (rootLoadStatus === 'ready' || rootLoadStatus === 'empty')
          ? rootFollowCount
          : null,
      isTotalKnown:
        hasRoot && (rootLoadStatus === 'ready' || rootLoadStatus === 'empty'),
    }
    const followersProgress: RootCollectionProgress = rootVisibleLinkProgress?.followers ?? {
      status:
        hasRoot &&
        (rootLoadStatus === 'ready' ||
          rootLoadStatus === 'partial' ||
          rootLoadStatus === 'empty' ||
          rootLoadStatus === 'error')
          ? 'complete'
          : hasRoot
            ? 'loading'
            : 'idle',
      loadedCount: rootInboundCount,
      totalCount:
        hasRoot && rootLoadStatus === 'ready' ? rootInboundCount : null,
      isTotalKnown: hasRoot && rootLoadStatus === 'ready',
    }
    const followingDisplayTotal = getDisplayProgressTotal(followingProgress)
    const followersDisplayTotal = getDisplayProgressTotal(followersProgress)
    const followingMetric: ProgressMetric = {
      id: 'following',
      label: 'Following',
      summary:
        followingDisplayTotal !== null
          ? `${followingProgress.loadedCount}/${followingDisplayTotal}${
              followingProgress.isTotalKnown ? '' : ' aprox.'
            }`
          : `${followingProgress.loadedCount} cargados`,
      detail:
        followingDisplayTotal !== null
          ? followingProgress.isTotalKnown
            ? 'Total tomado de la contact list kind:3 del root.'
            : 'Total provisional; se ajusta cuando llega una contact list mejor.'
          : hasRoot
            ? 'Esperando contact list parseada para fijar el total de following.'
            : 'Carga una identidad para iniciar el descubrimiento.',
      tone: 'discovery',
      determinate: followingDisplayTotal !== null,
      current:
        followingDisplayTotal !== null ? followingProgress.loadedCount : null,
      total: followingDisplayTotal,
      value:
        followingDisplayTotal !== null
          ? followingDisplayTotal === 0
            ? 1
            : clampProgressValue(
                followingProgress.loadedCount /
                  Math.max(1, followingDisplayTotal),
              )
          : null,
    }

    const followersMetric: ProgressMetric = {
      id: 'followers',
      label: 'Followers',
      summary:
        followersDisplayTotal !== null
          ? `${followersProgress.loadedCount}/${followersDisplayTotal}${
              followersProgress.isTotalKnown ? '' : ' aprox.'
            }`
          : `${followersProgress.loadedCount} cargados`,
      detail:
        followersDisplayTotal !== null
          ? followersProgress.isTotalKnown
            ? 'Total confirmado tras la correlacion final de followers inbound.'
            : 'Total estimado desde COUNT; cambia si aparece una mejor cobertura.'
          : hasRoot
            ? 'Sin total usable todavia; mostrando carga progresiva de followers.'
            : 'El total de followers aparece cuando se resuelve un root.',
      tone: 'inbound',
      determinate: followersDisplayTotal !== null,
      current:
        followersDisplayTotal !== null ? followersProgress.loadedCount : null,
      total: followersDisplayTotal,
      value:
        followersDisplayTotal !== null
          ? followersDisplayTotal === 0
            ? 1
            : clampProgressValue(
                followersProgress.loadedCount /
                  Math.max(1, followersDisplayTotal),
              )
          : null,
    }

    const visibleScreenNodes = imageDiagnosticsSnapshot.visibility.visibleScreenNodes
    const paintedVisibleNodes =
      imageDiagnosticsSnapshot.presentation.paintedVisibleNodes
    const visibleImagePending =
      imageDiagnosticsSnapshot.pendingWork.queuedVisibleBaseRequests +
      imageDiagnosticsSnapshot.pendingWork.queuedVisibleHdRequests +
      imageDiagnosticsSnapshot.pendingWork.inFlightVisibleBaseRequests +
      imageDiagnosticsSnapshot.pendingWork.inFlightVisibleHdRequests
    const imageMetric: ProgressMetric = {
      id: 'image-loading',
      label: 'Imagenes',
      summary:
        visibleScreenNodes > 0
          ? `${paintedVisibleNodes}/${visibleScreenNodes} visibles`
          : imageDiagnosticsSnapshot.pendingWork.totalRequests > 0
            ? 'precargando avatars'
            : 'sin nodos visibles',
      detail:
        visibleScreenNodes > 0
          ? `${visibleImagePending} solicitudes visibles / ${imageDiagnosticsSnapshot.presentation.iconLayerPendingVisibleNodes} pendientes en icon layer`
          : imageDiagnosticsSnapshot.diagnostics.secondarySummary ??
            imageDiagnosticsSnapshot.diagnostics.primarySummary,
      tone: 'images',
      determinate: visibleScreenNodes > 0,
      current: visibleScreenNodes > 0 ? paintedVisibleNodes : null,
      total: visibleScreenNodes > 0 ? visibleScreenNodes : null,
      value:
        visibleScreenNodes > 0
          ? clampProgressValue(paintedVisibleNodes / visibleScreenNodes)
          : null,
    }

    return [followingMetric, followersMetric, imageMetric]
  }, [
    imageDiagnosticsSnapshot,
    rootFollowCount,
    rootInboundCount,
    rootLoadStatus,
    rootNodePubkey,
    rootVisibleLinkProgress,
  ])
  const isRootDiscoveryProgressActive =
    rootDiscoveryStatusCopy !== null &&
    activeLayer === 'graph' &&
    (rootLoadStatus === 'loading' ||
      rootVisibleLinkProgress?.following.status !== 'complete' ||
      rootVisibleLinkProgress?.followers.status !== 'complete')
  const statusCopy = capReached
    ? `Cap ${maxNodes} alcanzado`
    : isRootDiscoveryProgressActive
      ? rootDiscoveryStatusCopy ?? 'Buscando links visibles'
    : activeLayer === 'connections'
      ? connectionsSourceLayer === 'following'
        ? `${model.edges.length} conexiones internas entre cuentas que sigo`
        : connectionsSourceLayer === 'following-non-followers'
          ? `${model.edges.length} conexiones entre cuentas que sigo sin reciprocidad`
          : connectionsSourceLayer === 'followers'
            ? `${model.edges.length} conexiones internas entre cuentas que me siguen`
            : connectionsSourceLayer === 'nonreciprocal-followers'
              ? `${model.edges.length} conexiones entre seguidores sin reciprocidad`
              : connectionsSourceLayer === 'mutuals'
                ? `${model.edges.length} conexiones internas entre mutuos`
                : `${model.edges.length} conexiones internas`
    : activeLayer === 'following'
      ? `${model.edges.length} seguidos visibles`
    : activeLayer === 'following-non-followers'
      ? `${model.edges.length} seguidos sin reciprocidad`
    : activeLayer === 'mutuals'
      ? `${model.edges.length} relaciones reciprocas`
    : activeLayer === 'followers'
      ? `${model.edges.length} seguidores visibles`
    : activeLayer === 'nonreciprocal-followers'
      ? `${model.edges.length} seguidores sin reciprocidad`
    : activeLayer === 'pathfinding' && pathfinding.path
      ? `Camino de ${Math.max(0, pathfinding.path.length - 1)} saltos`
    : activeLayer === 'zaps'
      ? `${zapEdges.length} zaps visibles`
      : activeLayer === 'keywords'
        ? keywordMatchCount > 0
          ? `${keywordMatchCount} hits en ${keywordMatchNodeCount} nodos`
          : keywordExtractCount > 0
            ? `${keywordExtractCount} extractos listos`
            : keywordLayerMessage ?? 'Keywords sin corpus'
      : `${model.edges.length} links visibles`
  const layerStatusNote =
    activeLayer === 'connections'
      ? model.edges.length > 0
        ? connectionsSourceLayer === 'following'
          ? 'Solo enlaces internos entre cuentas seguidas por el root.'
          : connectionsSourceLayer === 'following-non-followers'
            ? 'Solo enlaces internos entre cuentas seguidas por el root sin follow-back.'
            : connectionsSourceLayer === 'followers'
              ? 'Solo enlaces internos entre cuentas que siguen al root.'
              : connectionsSourceLayer === 'nonreciprocal-followers'
                ? 'Solo enlaces internos entre seguidores sin reciprocidad hacia el root.'
                : connectionsSourceLayer === 'mutuals'
                  ? 'Solo enlaces internos entre cuentas con relacion reciproca con el root.'
                  : 'Solo enlaces internos entre los nodos visibles de la vista anterior.'
        : connectionsSourceLayer === 'following'
          ? 'Todavia no hay enlaces internos entre las cuentas que sigue el root.'
          : connectionsSourceLayer === 'following-non-followers'
            ? 'Todavia no hay enlaces internos entre las cuentas que sigue el root sin reciprocidad.'
            : connectionsSourceLayer === 'followers'
              ? 'Todavia no hay enlaces internos entre las cuentas que siguen al root.'
              : connectionsSourceLayer === 'nonreciprocal-followers'
                ? 'Todavia no hay enlaces internos entre seguidores sin reciprocidad.'
                : connectionsSourceLayer === 'mutuals'
                  ? 'Todavia no hay enlaces internos entre los mutuos detectados.'
                  : 'Todavia no hay enlaces internos entre los nodos visibles de esa vista.'
    : activeLayer === 'following'
      ? model.edges.length > 0
        ? 'Cuentas seguidas por el root en esta sesion.'
        : 'No hay follows salientes visibles todavia para el root.'
    : activeLayer === 'following-non-followers'
      ? model.edges.length > 0
        ? 'Cuentas seguidas por el root sin follow-back.'
        : 'No hay follows sin reciprocidad visibles todavia para el root.'
    : activeLayer === 'followers'
      ? model.edges.length > 0
        ? 'Cuentas que siguen al root en esta sesion.'
        : 'No hay follows entrantes visibles todavia para el root.'
    : activeLayer === 'nonreciprocal-followers'
      ? model.edges.length > 0
        ? 'Cuentas que siguen al root sin recibir follow-back.'
        : 'No hay seguidores sin reciprocidad visibles todavia para el root.'
    : activeLayer === 'mutuals'
      ? model.edges.length > 0
        ? 'Relaciones reciprocas detectadas para el root.'
        : 'No hay relaciones reciprocas visibles todavia.'
    : activeLayer === 'keywords'
      ? keywordLayerMessage
      : activeLayer === 'zaps'
        ? zapLayerStatus === 'enabled'
          ? `${zapEdges.length} relaciones de zap visibles.`
          : 'La capa de zaps depende de recibos disponibles.'
        : graphAnalysis.message
  const keywordLayerDisabledReason =
    keywordLayerStatus === 'unavailable'
      ? keywordLayerMessage ?? 'La capa de keywords no esta disponible.'
      : keywordLayerStatus === 'loading'
        ? keywordLayerMessage ?? 'Preparando corpus de notas...'
        : keywordLayerStatus === 'disabled'
          ? keywordLayerMessage ?? 'La capa de keywords todavia no esta lista.'
          : ''
  const streamLabel =
    pathfinding.status === 'computing'
      ? 'Calculando camino'
      : primaryActiveExpansion
        ? 'Expandiendo nodo'
      : isRootDiscoveryProgressActive || rootLoadStatus === 'loading'
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
  const streamMeta = primaryActiveExpansion
    ? [
        `Paso ${primaryActiveExpansion.state.step ?? '-'} de ${
          primaryActiveExpansion.state.totalSteps ?? '-'
        }`,
        activeNodeExpansions.length > 1
          ? `+${activeNodeExpansions.length - 1} expansiones`
          : null,
      ]
        .filter(Boolean)
        .join(' / ')
    : statusCopy
  const streamDetail = primaryActiveExpansion
    ? `${
        primaryActiveExpansion.state.message ??
        `Trabajando sobre ${primaryActiveExpansion.nodeLabel}`
      } Fase: ${formatNodeExpansionPhaseLabel(
        primaryActiveExpansion.state.phase,
      )}. El grafo visible se mantiene usable mientras se integra el nodo.`
    : pathfinding.status === 'computing'
      ? pathfinding.message ?? 'Recorriendo el grafo mutuo descubierto.'
      : isRootDiscoveryProgressActive || rootLoadStatus === 'loading'
        ? rootLoadMessage ??
          rootDiscoveryProgressDetail ??
          'Consultando relays, cache local y contact list kind:3 del root.'
      : rootLoadStatus === 'partial' ||
          rootLoadStatus === 'empty' ||
          rootLoadStatus === 'error'
        ? rootLoadMessage ??
          'La cobertura quedo parcial; el grafo conserva la evidencia disponible.'
      : activeLayer === 'keywords' && keywordLayerMessage
        ? keywordLayerMessage
      : activeLayer === 'zaps'
        ? zapLayerStatus === 'enabled'
          ? `${zapEdges.length} relaciones de zap visibles desde evidencia decodificada.`
          : 'La capa de zaps espera recibos utilizables para los nodos explorados.'
      : graphAnalysis.status === 'loading' && graphAnalysis.message
        ? graphAnalysis.message
      : rootLoadStatus === 'ready'
        ? 'Exploracion completa del vecindario descubierto. Selecciona nodos, cambia capas o exporta evidencia.'
      : 'Carga una npub o nprofile para iniciar descubrimiento relay-aware.'

  const diagnostics = useMemo<GraphCanvasDiagnostics | null>(
    () => {
      if (!shouldCollectDiagnostics) {
        return null
      }

      return {
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
          meta: streamMeta,
          activeLayer,
          zapLayerStatus,
          keywordLayerStatus,
        },
      }
    },
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
      streamMeta,
      streamLabel,
      visibleLabels.length,
      keywordLayerStatus,
      shouldCollectDiagnostics,
      zapLayerStatus,
    ],
  )

  useEffect(() => {
    if (!onDiagnosticsChange || !diagnostics) {
      return
    }

    onDiagnosticsChange(diagnostics)
  }, [diagnostics, onDiagnosticsChange])

  useEffect(
    () => () => {
      onDiagnosticsChange?.(null)
    },
    [onDiagnosticsChange],
  )

  const [isStreamProgressCollapsed, setIsStreamProgressCollapsed] = useState(true)

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
          <GraphCanvasRecoveryChrome
            browserOnline={isBrowserOnline}
            links={links}
            onTrySampleRoot={onTrySampleRoot}
            rootLoadMessage={rootLoadMessage}
            rootLoadStatus={rootLoadStatus}
            rootNodePubkey={rootNodePubkey}
            shouldMountRenderer={shouldMountRenderer}
          />

          <GraphCanvasPanels
            hasSelectedNode={selectedNodePubkey !== null}
            imageRuntime={imageRuntime}
            runtime={runtime}
          />

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
              forceLowDevicePixels={isMobileProfile}
              hoverInteractionEnabled={hoverInteractionEnabled}
            />
          ) : null}

          {shouldShowEmptyState ? (
            <div aria-live="polite" className="graph-panel__empty">
              <p className="graph-panel__empty-title">{overlayCopy.title}</p>
              <p className="graph-panel__empty-copy">{overlayCopy.body}</p>
              {modelErrorMessage ? (
                <p className="graph-panel__empty-copy">{modelErrorMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div
            aria-atomic="false"
            aria-live="polite"
            className={`graph-panel__stream-status ${isStreamProgressCollapsed ? 'graph-panel__stream-status--collapsed' : ''}`}
            role="status"
          >
            <button
              className="graph-panel__stream-toggle"
              onClick={() => setIsStreamProgressCollapsed(!isStreamProgressCollapsed)}
              type="button"
              aria-expanded={!isStreamProgressCollapsed}
            >
              <span className="graph-panel__stream-eyebrow">Progreso</span>
              <div className="graph-panel__stream-header-main">
                <span className="graph-panel__stream-label">{streamLabel}</span>
                <span className="graph-panel__stream-meta">{streamMeta}</span>
              </div>
              <svg
                fill="none"
                height="12"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="12"
                style={{ 
                  transform: isStreamProgressCollapsed ? 'none' : 'rotate(180deg)',
                  transition: 'transform 0.2s ease'
                }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            
            {!isStreamProgressCollapsed && (
              <>
                <div className="graph-panel__progress-grid">
                  {progressMetrics.map((metric) => (
                    <GraphProgressMetricRow key={metric.id} metric={metric} />
                  ))}
                </div>
                <span className="graph-panel__stream-detail">{streamDetail}</span>
              </>
            )}
          </div>

          <GraphControlRail
            activeLayer={activeLayer}
            canToggleOnlyNonReciprocal={canToggleOnlyNonReciprocal}
            onlyOneRelationshipSideActive={onlyOneRelationshipSideActive}
            onToggleLayer={handleToggleLayer}
            onToggleOnlyNonReciprocal={handleToggleOnlyNonReciprocal}
            onToggleRelationship={handleToggleRelationship}
            relationshipToggleState={relationshipToggleState}
          />

          {activeLayer === 'keywords' && layerStatusNote ? (
            <div className="graph-panel__status-note" aria-live="polite">
              <p>{layerStatusNote}</p>
              {activeLayer === 'keywords' ? (
                <p>
                  Corpus {keywordExtractCount} extractos / {keywordCorpusNodeCount}{' '}
                  nodos / origen {keywordLoadedFrom}
                  {keywordIsPartial ? ' / parcial' : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </Profiler>
  )
})
