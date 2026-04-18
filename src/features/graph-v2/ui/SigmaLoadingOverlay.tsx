'use client'

import { memo } from 'react'

interface Props {
  message: string | null
  nodeCount: number
}

/**
 * Full-canvas overlay shown while the root graph is loading.
 * Sits between the canvas and the chrome so the user knows data
 * is arriving even before nodes appear.
 */
export const SigmaLoadingOverlay = memo(function SigmaLoadingOverlay({
  message,
  nodeCount,
}: Props) {
  const label = message ?? 'Cargando…'
  return (
    <div className="sg-loading-overlay" aria-live="polite">
      <div className="sg-loading-overlay__card">
        <div className="sg-loading-overlay__ring" aria-hidden="true">
          <div />
        </div>
        <p className="sg-loading-overlay__label">{label}</p>
        {nodeCount > 0 && (
          <p className="sg-loading-overlay__count">{nodeCount} nodos</p>
        )}
      </div>
    </div>
  )
})
