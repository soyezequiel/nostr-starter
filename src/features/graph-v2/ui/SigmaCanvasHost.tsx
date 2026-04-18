'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'
import type { AvatarRuntimeOptions } from '@/features/graph-v2/renderer/avatar/types'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import { SigmaRendererAdapter } from '@/features/graph-v2/renderer/SigmaRendererAdapter'
import type { DragNeighborhoodInfluenceTuning } from '@/features/graph-v2/renderer/dragInfluence'
import type { ForceAtlasPhysicsTuning } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type { SigmaLabDebugApi } from '@/features/graph-v2/testing/browserDebug'
import { ZapElectronOverlay } from '@/features/graph-v2/zaps/zapElectronOverlay'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

interface SigmaCanvasHostProps {
  scene: GraphSceneSnapshot
  callbacks: GraphInteractionCallbacks
  enableDebugProbe?: boolean
  dragInfluenceTuning?: Partial<DragNeighborhoodInfluenceTuning>
  physicsTuning?: Partial<ForceAtlasPhysicsTuning>
  hideAvatarsOnMove?: boolean
  avatarRuntimeOptions?: AvatarRuntimeOptions
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
  recenterCamera: () => void
  zoomIn: () => void
  zoomOut: () => void
  setPhysicsSuspended: (suspended: boolean) => void
  getMinimapSnapshot: () => MinimapSnapshot | null
  getMinimapViewport: () => MinimapViewport
  panCameraToGraph: (graphX: number, graphY: number, options?: { animate?: boolean }) => void
  subscribeToCameraTicks: (listener: () => void) => () => void
  subscribeToRenderTicks: (listener: () => void) => () => void
}

export const SigmaCanvasHost = forwardRef<SigmaCanvasHostHandle, SigmaCanvasHostProps>(
  function SigmaCanvasHost(
    {
      scene,
      callbacks,
      enableDebugProbe = false,
      dragInfluenceTuning,
      physicsTuning,
      hideAvatarsOnMove = false,
      avatarRuntimeOptions,
      onAvatarPerfSnapshot,
    },
    ref,
  ) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const adapterRef = useRef<SigmaRendererAdapter | null>(null)
  const overlayRef = useRef<ZapElectronOverlay | null>(null)
  const initialSceneRef = useRef(scene)
  const sceneRef = useRef(scene)
  const lastAvatarPerfSnapshotKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const container = containerRef.current
    const adapter = new SigmaRendererAdapter()
    adapter.mount(container, initialSceneRef.current, callbacks)
    adapterRef.current = adapter

    const overlay = new ZapElectronOverlay(container, (pubkey) => {
      const viewportPosition = adapter.getViewportPosition(pubkey)
      const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
      if (!viewportPosition || !canvas) {
        return null
      }
      const canvasRect = canvas.getBoundingClientRect()
      const scaleX = canvas.width > 0 ? canvasRect.width / canvas.width : 1
      const scaleY = canvas.height > 0 ? canvasRect.height / canvas.height : 1
      return {
        x: viewportPosition.x * scaleX,
        y: viewportPosition.y * scaleY,
      }
    })
    overlayRef.current = overlay

    return () => {
      overlay.dispose()
      overlayRef.current = null
      adapter.dispose()
      adapterRef.current = null
    }
  }, [callbacks])

  useImperativeHandle(
    ref,
    () => ({
      playZap: (zap) => overlayRef.current?.play(zap) ?? false,
      recenterCamera: () => adapterRef.current?.recenterCamera(),
      zoomIn: () => adapterRef.current?.zoomIn(),
      zoomOut: () => adapterRef.current?.zoomOut(),
      setPhysicsSuspended: (suspended) => adapterRef.current?.setPhysicsSuspended(suspended),
      getMinimapSnapshot: () => adapterRef.current?.getMinimapSnapshot() ?? null,
      getMinimapViewport: () => adapterRef.current?.getMinimapViewport() ?? null,
      panCameraToGraph: (x, y, opts) => adapterRef.current?.panCameraToGraph(x, y, opts),
      subscribeToCameraTicks: (listener) =>
        adapterRef.current?.subscribeToCameraTicks(listener) ?? (() => {}),
      subscribeToRenderTicks: (listener) =>
        adapterRef.current?.subscribeToRenderTicks(listener) ?? (() => {}),
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
    adapterRef.current?.setHideAvatarsOnMove(hideAvatarsOnMove)
  }, [hideAvatarsOnMove])

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
    const intervalId = window.setInterval(emitSnapshot, 500)
    return () => window.clearInterval(intervalId)
  }, [onAvatarPerfSnapshot])

  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  useEffect(() => {
    if (!enableDebugProbe || typeof window === 'undefined') {
      return
    }

    const debugApi: SigmaLabDebugApi = {
      getNodePosition: (pubkey) => adapterRef.current?.getNodePosition(pubkey) ?? null,
      getViewportPosition: (pubkey) => {
        const viewportPosition = adapterRef.current?.getViewportPosition(pubkey)
        const rect = containerRef.current?.getBoundingClientRect()
        const canvas = containerRef.current?.querySelector('canvas')

        if (!viewportPosition || !rect) {
          return null
        }

        const canvasRect = canvas?.getBoundingClientRect() ?? rect
        const scaleX =
          canvas && canvas.width > 0 ? canvasRect.width / canvas.width : 1
        const scaleY =
          canvas && canvas.height > 0 ? canvasRect.height / canvas.height : 1
        const cssX = viewportPosition.x * scaleX
        const cssY = viewportPosition.y * scaleY

        return {
          x: cssX,
          y: cssY,
          clientX: canvasRect.left + cssX,
          clientY: canvasRect.top + cssY,
        }
      },
      getNeighborGroups: (pubkey) => adapterRef.current?.getNeighborGroups(pubkey) ?? null,
      findDragCandidate: (query) => adapterRef.current?.findDragCandidate(query) ?? null,
      isNodeFixed: (pubkey) => adapterRef.current?.isNodeFixed(pubkey) ?? false,
      getSelectionState: () => ({
        selectedNodePubkey: sceneRef.current.selection.selectedNodePubkey,
        pinnedNodePubkeys: [...sceneRef.current.pins.pubkeys],
      }),
      getDragRuntimeState: () => adapterRef.current?.getDragRuntimeState() ?? {
        draggedNodePubkey: null,
        pendingDragGesturePubkey: null,
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
      },
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

  return (
    <div
      className="relative h-full min-h-[32rem] w-full"
      data-testid="sigma-canvas-host"
      ref={containerRef}
    />
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
