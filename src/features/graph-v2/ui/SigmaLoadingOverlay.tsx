'use client'

import { memo } from 'react'

interface Props {
  message: string | null
  nodeCount: number
}

interface LoadingNode {
  x: string
  y: string
  r: number
}

interface LoadingEdge {
  from: number
  to: number
  opacity: string
}

const LOADING_NODES: LoadingNode[] = [
  { x: '22;44;22', y: '30;26;30', r: 10 },
  { x: '66;54;66', y: '62;72;62', r: 12 },
  { x: '108;116;108', y: '50;36;50', r: 10 },
  { x: '138;154;138', y: '70;78;70', r: 9 },
  { x: '112;100;112', y: '96;112;96', r: 15 },
  { x: '96;78;96', y: '136;128;136', r: 15 },
  { x: '136;150;136', y: '134;124;134', r: 13 },
  { x: '164;176;164', y: '110;102;110', r: 18 },
  { x: '204;194;204', y: '126;142;126', r: 10 },
  { x: '56;42;56', y: '184;172;184', r: 19 },
]

const LOADING_EDGES: LoadingEdge[] = [
  { from: 0, to: 1, opacity: '0.52;0.18;0.52' },
  { from: 1, to: 2, opacity: '0.50;0.24;0.50' },
  { from: 2, to: 3, opacity: '0.48;0.14;0.48' },
  { from: 2, to: 4, opacity: '0.44;0.70;0.44' },
  { from: 3, to: 4, opacity: '0.46;0;0.46' },
  { from: 4, to: 5, opacity: '0.60;0.26;0.60' },
  { from: 4, to: 6, opacity: '0.52;0.72;0.52' },
  { from: 4, to: 7, opacity: '0.38;0.68;0.38' },
  { from: 5, to: 6, opacity: '0.46;0;0.46' },
  { from: 5, to: 9, opacity: '0.54;0.34;0.54' },
  { from: 7, to: 8, opacity: '0.58;0.22;0.58' },
  { from: 1, to: 5, opacity: '0;0.52;0' },
  { from: 3, to: 7, opacity: '0;0.46;0' },
  { from: 6, to: 8, opacity: '0;0.44;0' },
]

export const SigmaLoadingOverlay = memo(function SigmaLoadingOverlay({
  message,
  nodeCount,
}: Props) {
  const label = message ?? 'resolviendo nprofile -> relays'
  const progress = nodeCount > 0 ? Math.min(74, 19 + nodeCount * 5) : 19

  return (
    <div className="sg-loading-overlay" aria-live="polite">
      <div className="sg-loading-overlay__visual" aria-hidden="true">
        <svg className="sg-loading-graph" viewBox="0 0 224 224" role="presentation">
          <g className="sg-loading-graph__edges">
            {LOADING_EDGES.map((edge, edgeIndex) => {
              const a = LOADING_NODES[edge.from]
              const b = LOADING_NODES[edge.to]
              return (
                <line key={edgeIndex}>
                  <animate attributeName="x1" dur="3.8s" repeatCount="indefinite" values={a.x} />
                  <animate attributeName="y1" dur="3.8s" repeatCount="indefinite" values={a.y} />
                  <animate attributeName="x2" dur="3.8s" repeatCount="indefinite" values={b.x} />
                  <animate attributeName="y2" dur="3.8s" repeatCount="indefinite" values={b.y} />
                  <animate attributeName="opacity" dur="3.8s" repeatCount="indefinite" values={edge.opacity} />
                </line>
              )
            })}
          </g>
          <g className="sg-loading-graph__nodes">
            {LOADING_NODES.map((node, nodeIndex) => (
              <g key={nodeIndex}>
                <circle className="sg-loading-graph__halo" r={node.r + 5}>
                  <animate attributeName="cx" dur="3.8s" repeatCount="indefinite" values={node.x} />
                  <animate attributeName="cy" dur="3.8s" repeatCount="indefinite" values={node.y} />
                  <animate attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0.22;0.48;0.22" />
                </circle>
                <circle className="sg-loading-graph__node" r={node.r}>
                  <animate attributeName="cx" dur="3.8s" repeatCount="indefinite" values={node.x} />
                  <animate attributeName="cy" dur="3.8s" repeatCount="indefinite" values={node.y} />
                </circle>
                <circle className="sg-loading-graph__core" r="1.6">
                  <animate attributeName="cx" dur="3.8s" repeatCount="indefinite" values={node.x} />
                  <animate attributeName="cy" dur="3.8s" repeatCount="indefinite" values={node.y} />
                </circle>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="sg-loading-overlay__center">
        <p className="sg-loading-overlay__progress">{progress}%</p>
        <h1>Mapeando identidad</h1>
        <div className="sg-loading-overlay__terminal">
          <p>{label}</p>
          <p className="sg-loading-overlay__ok">wss://relay.damus.io - conectado</p>
          {nodeCount > 0 ? (
            <p>{nodeCount} nodos recibidos</p>
          ) : (
            <p>esperando eventos de perfil y contactos</p>
          )}
        </div>
      </div>
    </div>
  )
})
