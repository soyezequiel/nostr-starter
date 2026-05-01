'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import type { ConnectionVisualConfig } from '@/features/graph-v2/connectionVisualConfig'
import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'
import type { AvatarRuntimeOptions } from '@/features/graph-v2/renderer/avatar/types'
import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import { SigmaRendererAdapter } from '@/features/graph-v2/renderer/SigmaRendererAdapter'
import { hasRenderableSigmaContainer } from '@/features/graph-v2/renderer/containerDimensions'
import type { DragNeighborhoodInfluenceTuning } from '@/features/graph-v2/renderer/dragInfluence'
import type { ForceAtlasPhysicsTuning } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type {
  DebugDragRuntimeState,
  DebugDragTimelineEvent,
  DebugNodePosition,
  DebugPhysicsDiagnostics,
  DebugProjectionDiagnostics,
  DebugRenderInvalidationState,
  DebugRenderPhysicsPosition,
  DebugViewportPosition,
  SigmaLabDebugApi,
} from '@/features/graph-v2/testing/browserDebug'
import type { ActivityOverlayController } from '@/features/graph-v2/events/activityOverlayFactory'
import { createActivityOverlay } from '@/features/graph-v2/events/activityOverlayFactory'
import type { ParsedGraphEvent } from '@/features/graph-v2/events/types'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import { resolveActivityOverlayCssPosition } from '@/features/graph-v2/ui/activityOverlayPosition'

interface SigmaCanvasHostProps {
  scene: GraphSceneSnapshot
  callbacks: GraphInteractionCallbacks
  enableDebugProbe?: boolean
  dragInfluenceTuning?: Partial<DragNeighborhoodInfluenceTuning>
  physicsTuning?: Partial<ForceAtlasPhysicsTuning>
  physicsAutoFreezeEnabled?: boolean
  hideAvatarsOnMove?: boolean
  avatarImagesEnabled?: boolean
  hideConnectionsForLowPerformance?: boolean
  edgeZoomLodEnabled?: boolean
  collapseMutualEdgesEnabled?: boolean
  edgeViewportCullingEnabled?: boolean
  aggressiveBarnesHutEnabled?: boolean
  avatarRuntimeOptions?: AvatarRuntimeOptions
  connectionVisualConfig?: ConnectionVisualConfig
  initialCameraZoom?: number
  onAvatarPerfSnapshot?: (snapshot: PerfBudgetSnapshot | null) => void
}

export interface MinimapSnapshot {
  nodes: Array<{ x: number; y: number; color: string; isRoot: boolean; isSelected: boolean }>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  viewport: { minX: number; minY: number; maxX: number; maxY: number } | null
}

export type MinimapViewport = MinimapSnapshot['viewport']

export interface SigmaCanvasHostHandle {
  playZap: (zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) => boolean
  playZapArrival: (zap: Pick<ParsedZap, 'toPubkey' | 'sats'>) => boolean
  playGraphEvent: (event: ParsedGraphEvent) => boolean
  setActivityOverlayPaused: (paused: boolean) => void
  setZapOverlayPaused: (paused: boolean) => void
  recenterCamera: () => void
  fitCameraToGraph: () => void
  fitCameraToGraphAfterPhysicsSettles: () => void
  fitCameraToGraphWhilePhysicsSettles: () => void
  zoomIn: () => void
  zoomOut: () => void
  placeDetachedNode: (pubkey: string) => boolean
  setNodePinned: (pubkey: string, pinned: boolean) => void
  setPhysicsSuspended: (suspended: boolean) => void
  getMinimapSnapshot: () => MinimapSnapshot | null
  getMinimapViewport: () => MinimapViewport
  panCameraToGraph: (graphX: number, graphY: number, options?: { animate?: boolean }) => void
  subscribeToCameraTicks: (listener: () => void) => () => void
  subscribeToRenderTicks: (listener: () => void) => () => void
  getNodePosition: (pubkey: string) => DebugNodePosition | null
  getViewportPosition: (pubkey: string) => DebugViewportPosition | null
  getVisibleNodePubkeys: () => string[]
  setAvatarDebugDetailsEnabled: (enabled: boolean) => void
  getAvatarRuntimeDebugSnapshot: (options?: {
    includeOverlayNodes?: boolean
  }) => AvatarRuntimeStateDebugSnapshot | null
  getDragRuntimeState: () => DebugDragRuntimeState
  getDragTimeline: () => DebugDragTimelineEvent[]
  getProjectionDiagnostics: () => DebugProjectionDiagnostics
  getRenderPhysicsPosition: (pubkey: string) => DebugRenderPhysicsPosition
  getRenderInvalidationState: () => DebugRenderInvalidationState
  getPhysicsDiagnostics: () => DebugPhysicsDiagnostics | null
}

const BACKDROP_GRID_WORLD_STEP = 80
const BACKDROP_GRID_MINOR_DIVISOR = 4
const BACKDROP_GRID_MAJOR_COLOR = 'oklch(24% 0.012 230 / 0.5)'
const BACKDROP_GRID_MINOR_COLOR = 'oklch(22% 0.012 230 / 0.35)'
const BACKDROP_GRID_MAJOR_WIDTH = 1
const BACKDROP_GRID_MINOR_WIDTH = 0.5

const createEmptyDragRuntimeState = (): DebugDragRuntimeState => ({
  draggedNodePubkey: null,
  pendingDragGesturePubkey: null,
  lastReleasedNodePubkey: null,
  lastReleasedGraphPosition: null,
  lastReleasedAtMs: null,
  manualDragFixedNodeCount: 0,
  forceAtlasRunning: false,
  forceAtlasSuspended: false,
  moveBodyCount: 0,
  flushCount: 0,
  lastMoveBodyPointer: null,
  lastScheduledGraphPosition: null,
  lastFlushedGraphPosition: null,
  influencedNodeCount: 0,
  maxHopDistance: null,
  influenceHopSample: [],
})

const createEmptyProjectionDiagnostics = (): DebugProjectionDiagnostics => ({
  graphBoundsLocked: false,
  cameraLocked: false,
  dimensions: null,
  camera: null,
  bbox: null,
  customBBox: null,
  customBBoxKnown: false,
})

const createEmptyRenderPhysicsPosition = (): DebugRenderPhysicsPosition => ({
  render: null,
  physics: null,
  renderFixed: null,
  physicsFixed: null,
})

const createEmptyRenderInvalidationState =
  (): DebugRenderInvalidationState => ({
    pendingContainerRefresh: false,
    pendingContainerRefreshFrame: false,
    pendingDragFrame: false,
    pendingPhysicsBridgeFrame: false,
    pendingFitCameraAfterPhysicsFrame: false,
    pendingGraphBoundsUnlockFrame: false,
    graphBoundsUnlockStartedAtMs: null,
    graphBoundsUnlockDeferredCount: 0,
    graphBoundsLocked: false,
    cameraLocked: false,
    forceAtlasRunning: false,
    forceAtlasSuspended: false,
    lastInvalidation: { action: null, atMs: null },
  })

export const SigmaCanvasHost = forwardRef<SigmaCanvasHostHandle, SigmaCanvasHostProps>(
  function SigmaCanvasHost(
    {
      scene,
      callbacks,
      enableDebugProbe = false,
      dragInfluenceTuning,
      physicsTuning,
      physicsAutoFreezeEnabled = true,
      hideAvatarsOnMove = false,
      avatarImagesEnabled = true,
      hideConnectionsForLowPerformance = false,
      edgeZoomLodEnabled = false,
      collapseMutualEdgesEnabled = false,
      edgeViewportCullingEnabled = false,
      aggressiveBarnesHutEnabled = false,
      avatarRuntimeOptions,
      connectionVisualConfig,
      initialCameraZoom,
      onAvatarPerfSnapshot,
    },
    ref,
  ) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const backdropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const adapterRef = useRef<SigmaRendererAdapter | null>(null)
  const overlayRef = useRef<ActivityOverlayController | null>(null)
  const sceneRef = useRef(scene)
  const dragInfluenceTuningRef = useRef(dragInfluenceTuning)
  const physicsTuningRef = useRef(physicsTuning)
  const physicsAutoFreezeEnabledRef = useRef(physicsAutoFreezeEnabled)
  const hideAvatarsOnMoveRef = useRef(hideAvatarsOnMove)
  const avatarImagesEnabledRef = useRef(avatarImagesEnabled)
  const hideConnectionsForLowPerformanceRef = useRef(
    hideConnectionsForLowPerformance,
  )
  const edgeZoomLodEnabledRef = useRef(edgeZoomLodEnabled)
  const collapseMutualEdgesEnabledRef = useRef(collapseMutualEdgesEnabled)
  const edgeViewportCullingEnabledRef = useRef(edgeViewportCullingEnabled)
  const aggressiveBarnesHutEnabledRef = useRef(aggressiveBarnesHutEnabled)
  const avatarRuntimeOptionsRef = useRef(avatarRuntimeOptions)
  const connectionVisualConfigRef = useRef(connectionVisualConfig)
  const initialCameraZoomRef = useRef(initialCameraZoom)
  const lastAvatarPerfSnapshotKeyRef = useRef<string | null>(null)

  useEffect(() => {
    sceneRef.current = scene
    dragInfluenceTuningRef.current = dragInfluenceTuning
    physicsTuningRef.current = physicsTuning
    physicsAutoFreezeEnabledRef.current = physicsAutoFreezeEnabled
    hideAvatarsOnMoveRef.current = hideAvatarsOnMove
    avatarImagesEnabledRef.current = avatarImagesEnabled
    hideConnectionsForLowPerformanceRef.current =
      hideConnectionsForLowPerformance
    edgeZoomLodEnabledRef.current = edgeZoomLodEnabled
    collapseMutualEdgesEnabledRef.current = collapseMutualEdgesEnabled
    edgeViewportCullingEnabledRef.current = edgeViewportCullingEnabled
    aggressiveBarnesHutEnabledRef.current = aggressiveBarnesHutEnabled
    avatarRuntimeOptionsRef.current = avatarRuntimeOptions
    connectionVisualConfigRef.current = connectionVisualConfig
    initialCameraZoomRef.current = initialCameraZoom
  }, [
    avatarImagesEnabled,
    avatarRuntimeOptions,
    connectionVisualConfig,
    dragInfluenceTuning,
    hideConnectionsForLowPerformance,
    edgeZoomLodEnabled,
    collapseMutualEdgesEnabled,
    edgeViewportCullingEnabled,
    aggressiveBarnesHutEnabled,
    hideAvatarsOnMove,
    initialCameraZoom,
    physicsAutoFreezeEnabled,
    physicsTuning,
    scene,
  ])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    let adapter: SigmaRendererAdapter | null = null
    let overlay: ActivityOverlayController | null = null
    let pendingMountFrame: number | null = null
    let detachOverlayRenderTicks = () => {}
    let disposed = false

    const mountAdapter = () => {
      if (
        disposed ||
        adapter !== null ||
        !hasRenderableSigmaContainer(container)
      ) {
        return
      }

      const nextAdapter = new SigmaRendererAdapter()
      if (typeof initialCameraZoomRef.current === 'number') {
        nextAdapter.setInitialCameraZoom(initialCameraZoomRef.current)
      }
      nextAdapter.setAvatarImagesEnabled(avatarImagesEnabledRef.current)
      nextAdapter.mount(container, sceneRef.current, callbacks)
      nextAdapter.setDragInfluenceTuning(dragInfluenceTuningRef.current ?? {})
      nextAdapter.setAutoFreezeEnabled(physicsAutoFreezeEnabledRef.current)
      nextAdapter.setPhysicsTuning(physicsTuningRef.current ?? {})
      nextAdapter.setHideAvatarsOnMove(hideAvatarsOnMoveRef.current)
      nextAdapter.setHideConnectionsForLowPerformance(
        hideConnectionsForLowPerformanceRef.current,
      )
      nextAdapter.setEdgeZoomLodEnabled(edgeZoomLodEnabledRef.current)
      nextAdapter.setCollapseMutualEdgesEnabled(collapseMutualEdgesEnabledRef.current)
      nextAdapter.setEdgeViewportCullingEnabled(edgeViewportCullingEnabledRef.current)
      nextAdapter.setAggressiveBarnesHutEnabled(aggressiveBarnesHutEnabledRef.current)
      if (avatarRuntimeOptionsRef.current) {
        nextAdapter.setAvatarRuntimeOptions(avatarRuntimeOptionsRef.current)
      }
      if (connectionVisualConfigRef.current) {
        nextAdapter.setConnectionVisualConfig(connectionVisualConfigRef.current)
      }

      adapter = nextAdapter
      adapterRef.current = nextAdapter

      const nextOverlay = createActivityOverlay(container, (pubkey) => {
        return resolveActivityOverlayCssPosition(adapter, pubkey)
      })
      overlay = nextOverlay
      overlayRef.current = nextOverlay
      detachOverlayRenderTicks = nextAdapter.subscribeToRenderTicks(() => {
        nextOverlay.redrawPausedFrame()
      })
    }

    const scheduleMount = () => {
      if (pendingMountFrame !== null) {
        return
      }
      pendingMountFrame = requestAnimationFrame(() => {
        pendingMountFrame = null
        mountAdapter()
      })
    }

    mountAdapter()
    if (adapter === null) {
      scheduleMount()
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (adapter === null) {
              scheduleMount()
            }
          })
    resizeObserver?.observe(container)

    return () => {
      disposed = true
      if (pendingMountFrame !== null) {
        cancelAnimationFrame(pendingMountFrame)
      }
      resizeObserver?.disconnect()
      detachOverlayRenderTicks()
      overlay?.dispose()
      overlayRef.current = null
      adapter?.dispose()
      adapterRef.current = null
    }
  }, [callbacks])

  const getDebugNodePosition = (pubkey: string) =>
    adapterRef.current?.getNodePosition(pubkey) ?? null

  const getDebugViewportPosition = (pubkey: string) => {
    const viewportPosition = adapterRef.current?.getViewportPosition(pubkey)
    const rect = containerRef.current?.getBoundingClientRect()

    if (!viewportPosition || !rect) {
      return null
    }

    return {
      x: viewportPosition.x,
      y: viewportPosition.y,
      clientX: rect.left + viewportPosition.x,
      clientY: rect.top + viewportPosition.y,
    }
  }

  const getDebugDragRuntimeState = () =>
    adapterRef.current?.getDragRuntimeState() ?? createEmptyDragRuntimeState()

  const getDebugDragTimeline = () =>
    adapterRef.current?.getDragTimeline() ?? []

  const getDebugProjectionDiagnostics = () =>
    adapterRef.current?.getProjectionDiagnostics() ??
    createEmptyProjectionDiagnostics()

  const getDebugRenderPhysicsPosition = (pubkey: string) =>
    adapterRef.current?.getRenderPhysicsPosition(pubkey) ??
    createEmptyRenderPhysicsPosition()

  const getDebugRenderInvalidationState = () =>
    adapterRef.current?.getRenderInvalidationState() ??
    createEmptyRenderInvalidationState()

  useImperativeHandle(
    ref,
    () => ({
      playZap: (zap) => overlayRef.current?.playZap(zap) ?? false,
      playZapArrival: (zap) => overlayRef.current?.playZapArrival(zap) ?? false,
      playGraphEvent: (event) => overlayRef.current?.play(event) ?? false,
      setActivityOverlayPaused: (paused) => overlayRef.current?.setPaused(paused),
      setZapOverlayPaused: (paused) => overlayRef.current?.setPaused(paused),
      recenterCamera: () => adapterRef.current?.recenterCamera(),
      fitCameraToGraph: () => adapterRef.current?.fitCameraToGraph(),
      fitCameraToGraphAfterPhysicsSettles: () =>
        adapterRef.current?.fitCameraToGraphAfterPhysicsSettles(),
      fitCameraToGraphWhilePhysicsSettles: () =>
        adapterRef.current?.fitCameraToGraphWhilePhysicsSettles(),
      zoomIn: () => adapterRef.current?.zoomIn(),
      zoomOut: () => adapterRef.current?.zoomOut(),
      placeDetachedNode: (pubkey) =>
        adapterRef.current?.placeDetachedNode(pubkey) ?? false,
      setNodePinned: (pubkey, pinned) => adapterRef.current?.setNodePinned(pubkey, pinned),
      setPhysicsSuspended: (suspended) => adapterRef.current?.setPhysicsSuspended(suspended),
      getMinimapSnapshot: () => adapterRef.current?.getMinimapSnapshot() ?? null,
      getMinimapViewport: () => adapterRef.current?.getMinimapViewport() ?? null,
      panCameraToGraph: (x, y, opts) => adapterRef.current?.panCameraToGraph(x, y, opts),
      subscribeToCameraTicks: (listener) =>
        adapterRef.current?.subscribeToCameraTicks(listener) ?? (() => {}),
      subscribeToRenderTicks: (listener) =>
        adapterRef.current?.subscribeToRenderTicks(listener) ?? (() => {}),
      getNodePosition: getDebugNodePosition,
      getViewportPosition: getDebugViewportPosition,
      getVisibleNodePubkeys: () =>
        adapterRef.current?.getVisibleNodePubkeys() ?? [],
      setAvatarDebugDetailsEnabled: (enabled) =>
        adapterRef.current?.setAvatarDebugDetailsEnabled(enabled),
      getAvatarRuntimeDebugSnapshot: (options) =>
        adapterRef.current?.getAvatarRuntimeDebugSnapshot(options) ?? null,
      getDragRuntimeState: getDebugDragRuntimeState,
      getDragTimeline: getDebugDragTimeline,
      getProjectionDiagnostics: getDebugProjectionDiagnostics,
      getRenderPhysicsPosition: getDebugRenderPhysicsPosition,
      getRenderInvalidationState: getDebugRenderInvalidationState,
      getPhysicsDiagnostics: () =>
        adapterRef.current?.getPhysicsDiagnostics() ?? null,
    }),
    [],
  )

  useEffect(() => {
    adapterRef.current?.update(scene)
  }, [scene])

  useEffect(() => {
    adapterRef.current?.setDragInfluenceTuning(dragInfluenceTuning ?? {})
  }, [dragInfluenceTuning])

  useEffect(() => {
    adapterRef.current?.setPhysicsTuning(physicsTuning ?? {})
  }, [physicsTuning])

  useEffect(() => {
    adapterRef.current?.setAutoFreezeEnabled(physicsAutoFreezeEnabled)
  }, [physicsAutoFreezeEnabled])

  useEffect(() => {
    adapterRef.current?.setHideAvatarsOnMove(hideAvatarsOnMove)
  }, [hideAvatarsOnMove])

  useEffect(() => {
    adapterRef.current?.setAvatarImagesEnabled(avatarImagesEnabled)
  }, [avatarImagesEnabled])

  useEffect(() => {
    adapterRef.current?.setHideConnectionsForLowPerformance(
      hideConnectionsForLowPerformance,
    )
  }, [hideConnectionsForLowPerformance])

  useEffect(() => {
    adapterRef.current?.setEdgeZoomLodEnabled(edgeZoomLodEnabled)
  }, [edgeZoomLodEnabled])

  useEffect(() => {
    adapterRef.current?.setCollapseMutualEdgesEnabled(collapseMutualEdgesEnabled)
  }, [collapseMutualEdgesEnabled])

  useEffect(() => {
    adapterRef.current?.setEdgeViewportCullingEnabled(edgeViewportCullingEnabled)
  }, [edgeViewportCullingEnabled])

  useEffect(() => {
    adapterRef.current?.setAggressiveBarnesHutEnabled(aggressiveBarnesHutEnabled)
  }, [aggressiveBarnesHutEnabled])

  useEffect(() => {
    if (!connectionVisualConfig) {
      return
    }
    adapterRef.current?.setConnectionVisualConfig(connectionVisualConfig)
  }, [connectionVisualConfig])

  useEffect(() => {
    if (!avatarRuntimeOptions) {
      return
    }
    adapterRef.current?.setAvatarRuntimeOptions(avatarRuntimeOptions)
  }, [avatarRuntimeOptions])

  useEffect(() => {
    if (!onAvatarPerfSnapshot) {
      return
    }

    const emitSnapshot = () => {
      const snapshot = adapterRef.current?.getAvatarPerfSnapshot() ?? null
      const key = getAvatarPerfSnapshotKey(snapshot)
      if (key === lastAvatarPerfSnapshotKeyRef.current) {
        return
      }
      lastAvatarPerfSnapshotKeyRef.current = key
      onAvatarPerfSnapshot(snapshot)
    }

    emitSnapshot()
    const intervalId = window.setInterval(emitSnapshot, 1000)
    return () => window.clearInterval(intervalId)
  }, [onAvatarPerfSnapshot])

  useEffect(() => {
    if (!enableDebugProbe || typeof window === 'undefined') {
      return
    }

    const debugApi: SigmaLabDebugApi = {
      getNodePosition: getDebugNodePosition,
      getViewportPosition: getDebugViewportPosition,
      getNeighborGroups: (pubkey) => adapterRef.current?.getNeighborGroups(pubkey) ?? null,
      findDragCandidate: (query) => adapterRef.current?.findDragCandidate(query) ?? null,
      isNodeFixed: (pubkey) => adapterRef.current?.isNodeFixed(pubkey) ?? false,
      getSelectionState: () => ({
        selectedNodePubkey: sceneRef.current.render.selection.selectedNodePubkey,
        pinnedNodePubkeys: [...sceneRef.current.render.pins.pubkeys],
      }),
      getDragRuntimeState: getDebugDragRuntimeState,
      getDragTimeline: getDebugDragTimeline,
      getProjectionDiagnostics: getDebugProjectionDiagnostics,
      getRenderPhysicsPosition: getDebugRenderPhysicsPosition,
      getRenderInvalidationState: getDebugRenderInvalidationState,
      getPhysicsDiagnostics: () =>
        adapterRef.current?.getPhysicsDiagnostics() ?? null,
    }

    window.__sigmaLabDebug = debugApi

    return () => {
      if (window.__sigmaLabDebug === debugApi) {
        delete window.__sigmaLabDebug
      }
    }
  }, [enableDebugProbe])

  useEffect(() => {
    const host = hostRef.current
    const backdropCanvas = backdropCanvasRef.current
    if (!host || !backdropCanvas) {
      return
    }

    const ctx = backdropCanvas.getContext('2d')
    if (!ctx) {
      return
    }

    let disposed = false
    let pendingAttachFrame: number | null = null
    let detachCameraListener = () => {}

    const drawBackdrop = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        ctx.clearRect(0, 0, backdropCanvas.width, backdropCanvas.height)
        return
      }

      syncBackdropCanvasSize(backdropCanvas, rect.width, rect.height)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const adapter = adapterRef.current
      const backdropFrame = resolveBackdropFrame(
        adapter,
        rect.width,
        rect.height,
      )
      drawBackdropGrid(ctx, rect.width, rect.height, backdropFrame)
    }

    const attachCameraListener = () => {
      pendingAttachFrame = null

      if (disposed) {
        return
      }

      const adapter = adapterRef.current
      if (!adapter) {
        pendingAttachFrame = requestAnimationFrame(attachCameraListener)
        return
      }

      detachCameraListener()
      detachCameraListener = adapter.subscribeToCameraTicks(drawBackdrop)
      drawBackdrop()
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            drawBackdrop()
          })

    resizeObserver?.observe(host)
    drawBackdrop()
    attachCameraListener()

    return () => {
      disposed = true
      if (pendingAttachFrame !== null) {
        cancelAnimationFrame(pendingAttachFrame)
      }
      resizeObserver?.disconnect()
      detachCameraListener()
    }
  }, [])

  return (
    <div
      className="sg-canvas-host relative h-full min-h-[32rem] w-full"
      data-testid="sigma-canvas-host"
      ref={hostRef}
    >
      <canvas
        aria-hidden="true"
        className="sg-canvas-backdrop"
        ref={backdropCanvasRef}
      />
      <div className="sg-canvas-stage" ref={containerRef} />
    </div>
  )
  },
)

const getAvatarPerfSnapshotKey = (snapshot: PerfBudgetSnapshot | null) => {
  if (!snapshot) {
    return 'none'
  }

  return [
    snapshot.baseTier,
    snapshot.tier,
    snapshot.isDegraded ? 'degraded' : 'base',
    Math.round(snapshot.emaFrameMs),
    snapshot.budget.sizeThreshold,
    snapshot.budget.zoomThreshold,
    snapshot.budget.concurrency,
    snapshot.budget.maxBucket,
    snapshot.budget.lruCap,
    snapshot.budget.maxAvatarDrawsPerFrame,
    snapshot.budget.maxImageDrawsPerFrame,
  ].join('|')
}

const syncBackdropCanvasSize = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) => {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = Math.max(1, Math.round(width))
  const cssHeight = Math.max(1, Math.round(height))
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr))
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr))

  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight
  }

  if (canvas.style.width !== `${cssWidth}px`) {
    canvas.style.width = `${cssWidth}px`
  }
  if (canvas.style.height !== `${cssHeight}px`) {
    canvas.style.height = `${cssHeight}px`
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const resolveBackdropFrame = (
  adapter: SigmaRendererAdapter | null,
  width: number,
  height: number,
) => {
  if (!adapter) {
    return {
      originX: width / 2,
      originY: height / 2,
      majorSpacingX: BACKDROP_GRID_WORLD_STEP,
      majorSpacingY: BACKDROP_GRID_WORLD_STEP,
    }
  }

  const origin = adapter.graphToViewport({ x: 0, y: 0 })
  const majorX = adapter.graphToViewport({ x: BACKDROP_GRID_WORLD_STEP, y: 0 })
  const majorY = adapter.graphToViewport({ x: 0, y: BACKDROP_GRID_WORLD_STEP })

  const majorSpacingX =
    origin && majorX
      ? Math.abs(majorX.x - origin.x)
      : BACKDROP_GRID_WORLD_STEP
  const majorSpacingY =
    origin && majorY
      ? Math.abs(majorY.y - origin.y)
      : BACKDROP_GRID_WORLD_STEP

  return {
    originX:
      origin && Number.isFinite(origin.x) ? origin.x : width / 2,
    originY:
      origin && Number.isFinite(origin.y) ? origin.y : height / 2,
    majorSpacingX:
      Number.isFinite(majorSpacingX) && majorSpacingX > 0
        ? majorSpacingX
        : BACKDROP_GRID_WORLD_STEP,
    majorSpacingY:
      Number.isFinite(majorSpacingY) && majorSpacingY > 0
        ? majorSpacingY
        : BACKDROP_GRID_WORLD_STEP,
  }
}

const drawBackdropGrid = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: {
    originX: number
    originY: number
    majorSpacingX: number
    majorSpacingY: number
  },
) => {
  drawBackdropGridLayer(ctx, width, height, {
    offsetX: positiveModulo(frame.originX, frame.majorSpacingX),
    offsetY: positiveModulo(frame.originY, frame.majorSpacingY),
    spacingX: frame.majorSpacingX,
    spacingY: frame.majorSpacingY,
    color: BACKDROP_GRID_MAJOR_COLOR,
    lineWidth: BACKDROP_GRID_MAJOR_WIDTH,
  })

  const minorSpacingX = frame.majorSpacingX / BACKDROP_GRID_MINOR_DIVISOR
  const minorSpacingY = frame.majorSpacingY / BACKDROP_GRID_MINOR_DIVISOR
  if (minorSpacingX <= 14 || minorSpacingY <= 14) {
    return
  }

  drawBackdropGridLayer(ctx, width, height, {
    offsetX: positiveModulo(frame.originX, minorSpacingX),
    offsetY: positiveModulo(frame.originY, minorSpacingY),
    spacingX: minorSpacingX,
    spacingY: minorSpacingY,
    color: BACKDROP_GRID_MINOR_COLOR,
    lineWidth: BACKDROP_GRID_MINOR_WIDTH,
  })
}

const drawBackdropGridLayer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  grid: {
    offsetX: number
    offsetY: number
    spacingX: number
    spacingY: number
    color: string
    lineWidth: number
  },
) => {
  if (
    !Number.isFinite(grid.spacingX) ||
    !Number.isFinite(grid.spacingY) ||
    grid.spacingX <= 0 ||
    grid.spacingY <= 0
  ) {
    return
  }

  ctx.save()
  ctx.strokeStyle = grid.color
  ctx.lineWidth = grid.lineWidth
  ctx.beginPath()

  const alignedVertical = alignBackdropLine(grid.offsetX, grid.lineWidth)
  for (let x = alignedVertical; x <= width; x += grid.spacingX) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }

  const alignedHorizontal = alignBackdropLine(grid.offsetY, grid.lineWidth)
  for (let y = alignedHorizontal; y <= height; y += grid.spacingY) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }

  ctx.stroke()
  ctx.restore()
}

const positiveModulo = (value: number, divisor: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) {
    return 0
  }

  return ((value % divisor) + divisor) % divisor
}

const alignBackdropLine = (value: number, lineWidth: number) =>
  lineWidth >= 1 ? Math.round(value) + 0.5 : Math.round(value * 2) / 2
