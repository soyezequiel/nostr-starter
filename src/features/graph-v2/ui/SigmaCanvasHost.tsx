'use client'

import { useEffect, useRef } from 'react'

import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'
import { SigmaRendererAdapter } from '@/features/graph-v2/renderer/SigmaRendererAdapter'

interface SigmaCanvasHostProps {
  scene: GraphSceneSnapshot
  callbacks: GraphInteractionCallbacks
}

export function SigmaCanvasHost({
  scene,
  callbacks,
}: SigmaCanvasHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const adapterRef = useRef<SigmaRendererAdapter | null>(null)
  const initialSceneRef = useRef(scene)

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

  return <div className="h-full min-h-[32rem] w-full" ref={containerRef} />
}
