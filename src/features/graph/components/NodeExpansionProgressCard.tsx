import { useState } from 'react'
import type { NodeExpansionState } from '@/features/graph/app/store/types'

interface NodeExpansionProgressCardProps {
  className?: string
  nodeLabel?: string | null
  state: NodeExpansionState
  title?: string
  variant?: 'panel' | 'overlay'
}

const joinClassNames = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(' ')

const formatPhaseLabel = (phase: NodeExpansionState['phase']) => {
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

function ChevronIcon({ className, direction = 'down' }: { className?: string, direction?: 'up' | 'down' }) {
  return (
    <svg
      className={className}
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
      style={{ 
        transform: direction === 'up' ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.2s ease'
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function NodeExpansionProgressCard({
  className,
  nodeLabel = null,
  state,
  title = 'Expansion en curso',
  variant = 'panel',
}: NodeExpansionProgressCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const progressStep = state.step ?? 0
  const progressTotalSteps = state.totalSteps ?? 0
  const hasProgress = progressStep > 0 && progressTotalSteps > 0
  const progressWidth = hasProgress
    ? `${Math.max(0, Math.min(100, (progressStep / progressTotalSteps) * 100))}%`
    : null

  const handleToggle = () => setIsCollapsed(!isCollapsed)

  return (
    <section
      aria-busy={state.status === 'loading'}
      className={joinClassNames(
        'node-expansion-progress',
        `node-expansion-progress--${variant}`,
        isCollapsed && 'node-expansion-progress--collapsed',
        className,
      )}
    >
      <div className="node-expansion-progress__header">
        <button 
          className="node-expansion-progress__toggle-btn"
          onClick={handleToggle}
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expandir progreso' : 'Colapsar progreso'}
        >
          <div className="node-expansion-progress__title-row">
            <span aria-hidden="true" className="node-expansion-progress__spinner" />
            <div className="node-expansion-progress__heading">
              <p className="node-expansion-progress__eyebrow">{title}</p>
              {nodeLabel ? (
                <h3 className="node-expansion-progress__node">{nodeLabel}</h3>
              ) : null}
            </div>
          </div>
          <ChevronIcon direction={isCollapsed ? 'down' : 'up'} />
        </button>

        {hasProgress ? (
          <span className="node-expansion-progress__step">
            Paso {progressStep} de {progressTotalSteps}
          </span>
        ) : null}
      </div>

      {!isCollapsed && (
        <div className="node-expansion-progress__body">
          <p
            aria-live="polite"
            className="node-expansion-progress__message"
            role="status"
          >
            {state.message ?? 'Procesando evidencia estructural...'}
          </p>

          {hasProgress && progressWidth ? (
            <div
              aria-hidden="true"
              className="node-expansion-progress__meter"
            >
              <span
                className="node-expansion-progress__meter-fill"
                style={{ width: progressWidth }}
              />
            </div>
          ) : null}

          {hasProgress ? (
            <div className="node-expansion-progress__meta">
              <span>Trabajando</span>
              {hasProgress ? <span>{formatPhaseLabel(state.phase)}</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
