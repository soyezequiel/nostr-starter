import { memo } from 'react'

import { truncatePubkey } from '@/features/graph/render/labels'
import type { AccessibleNodeSummary } from '@/features/graph/render/types'

interface NodeAccessRailProps {
  nodes: AccessibleNodeSummary[]
  selectedNodePubkey: string | null
  onSelectNode: (pubkey: string) => void
}

export const NodeAccessRail = memo(function NodeAccessRail({
  nodes,
  selectedNodePubkey,
  onSelectNode,
}: NodeAccessRailProps) {
  if (nodes.length === 0) {
    return null
  }

  return (
    <div className="graph-panel__node-rail">
      <div className="graph-panel__node-rail-header">
        <div>
          <p className="graph-panel__node-rail-title">Nodos accesibles</p>
          <p className="graph-panel__node-rail-copy">
            Tab + Enter abre el panel lateral desde esta lista.
          </p>
        </div>
        <p className="graph-panel__node-rail-count">
          {nodes.length} disponibles
        </p>
      </div>

      <div className="graph-panel__node-rail-list" role="list">
        {nodes.map((node) => {
          const isSelected = selectedNodePubkey === node.pubkey
          const subtitle = node.isRoot
            ? 'root'
            : truncatePubkey(node.pubkey, 6, 6)

          return (
            <button
              key={node.id}
              aria-label={`Abrir detalle de ${node.displayLabel}`}
              aria-pressed={isSelected}
              className={`graph-panel__node-chip${isSelected ? ' graph-panel__node-chip--selected' : ''}`}
              onClick={() => onSelectNode(node.pubkey)}
              type="button"
            >
              <span className="graph-panel__node-chip-label">{node.displayLabel}</span>
              <span className="graph-panel__node-chip-subtitle">{subtitle}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
