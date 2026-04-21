'use client'

import { memo, useEffect, useMemo, useRef } from 'react'

import type { RootLoadState } from '@/features/graph-runtime/app/store/types'
import type { CanonicalRelayState } from '@/features/graph-v2/domain/types'
import { buildRootLoadProgressViewModel } from '@/features/graph-v2/ui/rootLoadProgressViewModel'

interface Props {
  identityLabel?: string | null
  message: string | null
  nodeCount: number
  relayState: CanonicalRelayState
  rootLoad: RootLoadState
}

interface GraphLoaderNode {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

type GraphLoaderEdge = [source: number, target: number, length: number]

interface LoadProgressProps {
  identityLabel?: string | null
  message?: string | null
  nodeCount: number
  rootLoad: RootLoadState
}

interface TerminalLine {
  text: string
  tone?: 'dim' | 'good' | 'warn'
}

function GraphLoader({ size = 190, seed = 1 }: { size?: number; seed?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const context = ctx

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    let seedState = seed * 9301 + 49297
    const random = () => {
      seedState = (seedState * 9301 + 49297) % 233280
      return seedState / 233280
    }

    const nodeCount = 11
    const nodes: GraphLoaderNode[] = []
    for (let i = 0; i < nodeCount; i += 1) {
      const angle = (i / nodeCount) * Math.PI * 2
      nodes.push({
        x: size / 2 + Math.cos(angle) * 30 + (random() - 0.5) * 10,
        y: size / 2 + Math.sin(angle) * 30 + (random() - 0.5) * 10,
        vx: 0,
        vy: 0,
        r: 2 + random() * 2.4,
      })
    }

    const edges: GraphLoaderEdge[] = []
    for (let i = 0; i < nodeCount; i += 1) {
      const edgeCount = 1 + Math.floor(random() * 2)
      for (let j = 0; j < edgeCount; j += 1) {
        const target =
          (i + 1 + Math.floor(random() * (nodeCount - 1))) % nodeCount
        if (target !== i) edges.push([i, target, 22 + random() * 18])
      }
    }

    const centerX = size / 2
    const centerY = size / 2
    let frameId = 0

    function step() {
      for (let i = 0; i < nodeCount; i += 1) {
        let forceX = 0
        let forceY = 0

        for (let j = 0; j < nodeCount; j += 1) {
          if (i === j) continue
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const distanceSquared = dx * dx + dy * dy + 0.01
          const force = 80 / distanceSquared
          forceX += dx * force
          forceY += dy * force
        }

        forceX += (centerX - nodes[i].x) * 0.012
        forceY += (centerY - nodes[i].y) * 0.012
        nodes[i].vx = (nodes[i].vx + forceX * 0.1) * 0.86
        nodes[i].vy = (nodes[i].vy + forceY * 0.1) * 0.86
      }

      for (const [source, target, length] of edges) {
        const sourceNode = nodes[source]
        const targetNode = nodes[target]
        const dx = targetNode.x - sourceNode.x
        const dy = targetNode.y - sourceNode.y
        const distance = Math.sqrt(dx * dx + dy * dy) + 0.001
        const force = (distance - length) * 0.04
        const unitX = dx / distance
        const unitY = dy / distance
        sourceNode.vx += unitX * force
        sourceNode.vy += unitY * force
        targetNode.vx -= unitX * force
        targetNode.vy -= unitY * force
      }

      for (const node of nodes) {
        node.x += node.vx
        node.y += node.vy

        const margin = 14
        if (node.x < margin) node.vx += (margin - node.x) * 0.05
        if (node.x > size - margin) node.vx -= (node.x - (size - margin)) * 0.05
        if (node.y < margin) node.vy += (margin - node.y) * 0.05
        if (node.y > size - margin) node.vy -= (node.y - (size - margin)) * 0.05
      }

      context.clearRect(0, 0, size, size)
      context.lineWidth = 0.7

      for (const [source, target] of edges) {
        const sourceNode = nodes[source]
        const targetNode = nodes[target]
        context.strokeStyle = 'oklch(98% 0 0 / 0.25)'
        context.beginPath()
        context.moveTo(sourceNode.x, sourceNode.y)
        context.lineTo(targetNode.x, targetNode.y)
        context.stroke()
      }

      for (const node of nodes) {
        const glow = context.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          node.r * 4,
        )
        glow.addColorStop(0, 'oklch(100% 0 0 / 0.35)')
        glow.addColorStop(1, 'oklch(100% 0 0 / 0)')
        context.fillStyle = glow
        context.beginPath()
        context.arc(node.x, node.y, node.r * 4, 0, Math.PI * 2)
        context.fill()

        context.fillStyle = 'oklch(98% 0 0)'
        context.beginPath()
        context.arc(node.x, node.y, node.r, 0, Math.PI * 2)
        context.fill()

        context.strokeStyle = 'oklch(0% 0 0 / 0.6)'
        context.lineWidth = 0.5
        context.beginPath()
        context.arc(node.x, node.y, node.r - 0.4, 0, Math.PI * 2)
        context.stroke()
      }

      frameId = requestAnimationFrame(step)
    }

    frameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameId)
  }, [seed, size])

  return <canvas ref={canvasRef} className="sg-graph-loader" width={size} height={size} />
}

const compactRelayUrl = (relayUrl: string) => {
  try {
    return new URL(relayUrl).host || relayUrl.replace(/^wss?:\/\//, '')
  } catch {
    return relayUrl.replace(/^wss?:\/\//, '')
  }
}

const buildTerminalLines = (
  rootLoad: RootLoadState,
  relayState: CanonicalRelayState,
  progressLabel: string,
): TerminalLine[] => {
  const lines: TerminalLine[] = [
    { text: 'resolviendo profile -> relays', tone: 'dim' },
  ]
  const progress = rootLoad.visibleLinkProgress
  const preferredRelayUrls = new Set<string>()

  if (progress?.lastRelayUrl) {
    preferredRelayUrls.add(progress.lastRelayUrl)
  }

  for (const relayUrl of relayState.urls) {
    preferredRelayUrls.add(relayUrl)
    if (preferredRelayUrls.size >= 4) break
  }

  for (const relayUrl of preferredRelayUrls) {
    const status = relayState.endpoints[relayUrl]?.status ?? 'unknown'
    const statusLabel =
      status === 'connected'
        ? 'conectado'
        : status === 'partial'
          ? 'parcial'
          : status === 'degraded'
            ? 'lento'
            : status === 'offline'
              ? 'sin respuesta'
              : 'pendiente'
    lines.push({
      text: `wss://${compactRelayUrl(relayUrl)} - ${statusLabel}`,
      tone:
        status === 'connected' || status === 'partial'
          ? 'good'
          : status === 'degraded' || status === 'offline'
            ? 'warn'
            : 'dim',
    })
  }

  if (progress) {
    lines.push(
      { text: `eventos kind:3 recibidos - ${progress.contactListEventCount}`, tone: 'dim' },
      {
        text: `inbound #p candidatos - ${progress.inboundCandidateEventCount}`,
        tone: 'dim',
      },
      { text: `links visibles - ${progressLabel}`, tone: 'dim' },
    )
  } else if (rootLoad.message) {
    lines.push({ text: rootLoad.message, tone: 'dim' })
  }

  return lines.slice(0, 8)
}

export const SigmaLoadingOverlay = memo(function SigmaLoadingOverlay({
  identityLabel,
  message,
  nodeCount,
  relayState,
  rootLoad,
}: Props) {
  const progress = useMemo(
    () =>
      buildRootLoadProgressViewModel({
        fallbackMessage: message,
        identityLabel,
        nodeCount,
        rootLoad,
      }),
    [identityLabel, message, nodeCount, rootLoad],
  )
  const progressBarClassName = `sg-load-bar__fill${
    progress.isIndeterminate ? ' sg-load-bar__fill--indeterminate' : ''
  }`
  const terminalLines = useMemo(
    () => buildTerminalLines(rootLoad, relayState, progress.progressLabel),
    [progress.progressLabel, relayState, rootLoad],
  )

  return (
    <div className="sg-loading-overlay" aria-label={progress.ariaLabel} aria-live="polite">
      <div className="sg-loading-loop-pill" aria-hidden="true">
        relay loop activo - sincronizando grafo
      </div>
      <div className="sg-loader-grid" aria-hidden="true">
        <GraphLoader size={170} seed={7} />
        <GraphLoader size={170} seed={19} />
        <GraphLoader size={170} seed={41} />
        <GraphLoader size={170} seed={73} />
      </div>

      <section className={`sg-loading-console sg-loading-console--${progress.tone}`}>
        <div className="sg-loading-statusline">
          <div className="sg-loading-percent">{progress.percent}%</div>
          <h2>{progress.title}</h2>
        </div>

        <div className="sg-loading-phase">
          Paso {progress.stepIndex} de {progress.stepCount} - {progress.phaseLabel}
        </div>

        <div className="sg-loading-total" aria-hidden="true">
          <span>{progress.progressLabel}</span>
          {progress.isEstimatedTotal ? <em>estimado</em> : null}
        </div>
        <div
          aria-hidden="true"
          className={`sg-load-bar${progress.isIndeterminate ? ' sg-load-bar--indeterminate' : ''}`}
        >
          <div
            className={progressBarClassName}
            style={{ width: progress.isIndeterminate ? '100%' : `${progress.percent}%` }}
          />
        </div>

        <div className="sg-loading-terminal">
          {terminalLines.map((line, index) => (
            <div
              className={`sg-loading-terminal__line${
                line.tone ? ` sg-loading-terminal__line--${line.tone}` : ''
              }`}
              key={`${line.text}-${index}`}
            >
              {line.text}
            </div>
          ))}
          <div className="sg-loading-terminal__fade" aria-hidden="true" />
        </div>
      </section>
    </div>
  )
})

export const SigmaLoadProgressHud = memo(function SigmaLoadProgressHud({
  identityLabel,
  message,
  nodeCount,
  rootLoad,
}: LoadProgressProps) {
  const progress = useMemo(
    () =>
      buildRootLoadProgressViewModel({
        fallbackMessage: message,
        identityLabel,
        nodeCount,
        rootLoad,
      }),
    [identityLabel, message, nodeCount, rootLoad],
  )

  if (progress.tone === 'idle' || progress.tone === 'ready') {
    return null
  }

  return (
    <div
      aria-label={progress.ariaLabel}
      aria-live="polite"
      className={`sg-load-hud sg-load-hud--${progress.tone}`}
    >
      <div className="sg-load-hud__main">
        <span>{progress.phaseLabel}</span>
        <strong>{progress.progressLabel}</strong>
      </div>
      <div
        aria-hidden="true"
        className={`sg-load-hud__bar${
          progress.isIndeterminate ? ' sg-load-hud__bar--indeterminate' : ''
        }`}
      >
        <span style={{ width: progress.isIndeterminate ? '100%' : `${progress.percent}%` }} />
      </div>
      <div className="sg-load-hud__meta">
        {progress.metrics.slice(0, 2).map((metric) => (
          <span key={metric.label}>
            {metric.label}: {metric.value}
          </span>
        ))}
      </div>
    </div>
  )
})
