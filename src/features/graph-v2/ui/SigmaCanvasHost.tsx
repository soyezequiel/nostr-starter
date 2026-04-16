'use client'

import { useEffect, useRef } from 'react'

import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'
import { SigmaRendererAdapter } from '@/features/graph-v2/renderer/SigmaRendererAdapter'
import type { SigmaLabDebugApi } from '@/features/graph-v2/testing/browserDebug'

interface SigmaCanvasHostProps {
  scene: GraphSceneSnapshot
  callbacks: GraphInteractionCallbacks
  enableDebugProbe?: boolean
}

export function SigmaCanvasHost({
  scene,
  callbacks,
  enableDebugProbe = false,
}: SigmaCanvasHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const adapterRef = useRef<SigmaRendererAdapter | null>(null)
  const initialSceneRef = useRef(scene)
  const sceneRef = useRef(scene)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const adapter = new SigmaRendererAdapter()
    adapter.mount(containerRef.current, initialSceneRef.current, callbacks)
    adapterRef.current = adapter

    return () => {
      adapter.dispose()
      adapterRef.current = null
    }
  }, [callbacks])

  useEffect(() => {
    adapterRef.current?.update(scene)
  }, [scene])

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
        settlingDraggedNodePubkey: null,
        pendingDragGesturePubkey: null,
        settlingSpeed: null,
        forceAtlasRunning: false,
        forceAtlasSuspended: false,
        moveBodyCount: 0,
        flushCount: 0,
        lastMoveBodyPointer: null,
        lastScheduledGraphPosition: null,
        lastFlushedGraphPosition: null,
      },
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
      className="h-full min-h-[32rem] w-full"
      data-testid="sigma-canvas-host"
      ref={containerRef}
    />
  )
}
