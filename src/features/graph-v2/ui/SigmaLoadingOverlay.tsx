'use client'

import { memo, useEffect, useMemo, useRef } from 'react'

interface Props {
  identityLabel?: string | null
  message: string | null
  nodeCount: number
}

interface GraphLoaderNode {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

type GraphLoaderEdge = [source: number, target: number, length: number]

interface LogLine {
  msg: string
  level?: 'good' | 'warn'
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

export const SigmaLoadingOverlay = memo(function SigmaLoadingOverlay({
  identityLabel,
  message,
  nodeCount,
}: Props) {
  const progress = nodeCount > 0 ? Math.min(0.88, 0.24 + nodeCount * 0.00012) : 0.19
  const displayName = identityLabel?.trim() || 'identidad'
  const label = message ?? 'resolviendo nprofile -> relays'
  const log = useMemo<LogLine[]>(() => {
    const entries: LogLine[] = [
      { msg: label },
      { msg: 'wss://relay.damus.io - conectado', level: 'good' },
      { msg: 'wss://nos.lol - conectado', level: 'good' },
      { msg: 'wss://relay.primal.net - conectado', level: 'good' },
    ]
    if (nodeCount > 0) {
      entries.push({ msg: `${nodeCount} nodos recibidos` })
    }
    return entries
  }, [label, nodeCount])

  return (
    <div className="sg-loading-overlay" aria-live="polite">
      <div className="sg-loader-grid" aria-hidden="true">
        <GraphLoader size={190} seed={7} />
        <GraphLoader size={190} seed={19} />
        <GraphLoader size={190} seed={41} />
        <GraphLoader size={190} seed={73} />
      </div>
      <div className="sg-loading-status">
        <div className="sg-loading-percent">{Math.round(progress * 100)}%</div>
        <div className="sg-loading-title">Mapeando {displayName}</div>
        <div className="sg-loading-log">
          {log.map((line, index) => (
            <div
              className={`sg-loading-log__line${line.level ? ` sg-loading-log__line--${line.level}` : ''}`}
              key={`${line.msg}-${index}`}
            >
              {line.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
