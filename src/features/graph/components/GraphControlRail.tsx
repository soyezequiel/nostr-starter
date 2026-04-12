import { memo } from 'react'
import type { ReactNode } from 'react'

import type { AppStore } from '@/features/graph/app/store/types'

interface RelationshipToggleState {
  following: boolean
  followers: boolean
  onlyNonReciprocal: boolean
}

interface ControlFeedback {
  label: string
  value: string
  detail: string
  tone: 'neutral' | 'mint' | 'amber' | 'blue'
}

interface GraphControlRailProps {
  activeLayer: AppStore['activeLayer']
  relationshipToggleState: RelationshipToggleState
  canToggleOnlyNonReciprocal: boolean
  onlyOneRelationshipSideActive: boolean
  onToggleLayer: (layer: AppStore['activeLayer']) => void
  onToggleRelationship: (role: 'following' | 'followers') => void
  onToggleOnlyNonReciprocal: () => void
}

const resolveControlFeedback = (
  activeLayer: AppStore['activeLayer'],
  relationshipToggleState: RelationshipToggleState,
): ControlFeedback => {
  switch (activeLayer) {
    case 'connections':
      if (
        relationshipToggleState.following &&
        relationshipToggleState.followers
      ) {
        return {
          label: 'Viendo',
          value: 'Conexiones entre mutuos',
          detail: 'Solo enlaces internos entre cuentas con relacion reciproca con el root.',
          tone: 'blue',
        }
      }
      if (relationshipToggleState.following) {
        return {
          label: 'Viendo',
          value: relationshipToggleState.onlyNonReciprocal
            ? 'Conexiones entre sigo sin reciprocidad'
            : 'Conexiones entre sigo',
          detail: relationshipToggleState.onlyNonReciprocal
            ? 'Subgrafo inducido sobre las cuentas que sigue el root y no devuelven follow.'
            : 'Subgrafo inducido sobre las cuentas que sigue el root.',
          tone: 'blue',
        }
      }
      if (relationshipToggleState.followers) {
        return {
          label: 'Viendo',
          value: relationshipToggleState.onlyNonReciprocal
            ? 'Conexiones entre me siguen sin reciprocidad'
            : 'Conexiones entre me siguen',
          detail: relationshipToggleState.onlyNonReciprocal
            ? 'Subgrafo inducido sobre cuentas que siguen al root sin recibir follow-back.'
            : 'Subgrafo inducido sobre las cuentas que siguen al root.',
          tone: 'blue',
        }
      }
      return {
        label: 'Viendo',
        value: 'Conexiones internas',
        detail: 'Solo enlaces internos entre los nodos visibles de la vista actual.',
        tone: 'blue',
      }
    case 'following':
      return {
        label: 'Viendo',
        value: 'Solo sigo',
        detail: 'Muestra solo las cuentas que sigue el root.',
        tone: 'mint',
      }
    case 'following-non-followers':
      return {
        label: 'Viendo',
        value: 'Sigo sin reciprocidad',
        detail: 'Cuentas que sigue el root y que no le siguen de vuelta.',
        tone: 'amber',
      }
    case 'followers':
      return {
        label: 'Viendo',
        value: 'Solo me siguen',
        detail: 'Muestra solo las cuentas que siguen al root.',
        tone: 'mint',
      }
    case 'nonreciprocal-followers':
      return {
        label: 'Viendo',
        value: 'Me siguen sin reciprocidad',
        detail: 'Cuentas que siguen al root y que el root no sigue.',
        tone: 'amber',
      }
    case 'mutuals':
      return {
        label: 'Viendo',
        value: 'Mutuos',
        detail: 'Relaciones reciprocas detectadas para el root.',
        tone: 'mint',
      }
    case 'keywords':
      return {
        label: 'Viendo',
        value: 'Palabras',
        detail: 'Filtra el grafo por coincidencias de texto.',
        tone: 'blue',
      }
    case 'zaps':
      return {
        label: 'Viendo',
        value: 'Zaps',
        detail: 'Superpone actividad de zaps sobre el grafo.',
        tone: 'amber',
      }
    default:
      return {
        label: 'Viendo',
        value: 'Grafo',
        detail: 'Exploracion completa del vecindario descubierto.',
        tone: 'neutral',
      }
  }
}

export const GraphControlRail = memo(function GraphControlRail({
  activeLayer,
  relationshipToggleState,
  canToggleOnlyNonReciprocal,
  onlyOneRelationshipSideActive,
  onToggleLayer,
  onToggleRelationship,
  onToggleOnlyNonReciprocal,
}: GraphControlRailProps) {
  const controlFeedback = resolveControlFeedback(
    activeLayer,
    relationshipToggleState,
  )
  const isNonReciprocalAvailable =
    canToggleOnlyNonReciprocal && onlyOneRelationshipSideActive
  const isNonReciprocalActive =
    isNonReciprocalAvailable && relationshipToggleState.onlyNonReciprocal

  return (
    <div className="graph-panel__control-bar">
      <div
        className="graph-panel__control-summary"
        data-tone={controlFeedback.tone}
      >
        <span className="graph-panel__control-summary-label">
          {controlFeedback.label}
        </span>
        <strong className="graph-panel__control-summary-value">
          {controlFeedback.value}
        </strong>
        <p className="graph-panel__control-summary-copy">
          {controlFeedback.detail}
        </p>
      </div>

      <div className="graph-panel__control-actions">
        <div
          className="graph-panel__control-group graph-panel__control-group--primary"
          role="group"
          aria-label="Vista principal del grafo"
        >
          <button
            aria-pressed={activeLayer === 'graph'}
            className={`graph-panel__control-btn${
              activeLayer === 'graph' ? ' graph-panel__control-btn--primary' : ''
            }`}
            data-control-tone="neutral"
            onClick={() => onToggleLayer('graph')}
            type="button"
          >
            Grafo
          </button>
          <button
            aria-pressed={activeLayer === 'connections'}
            className={`graph-panel__control-btn${
              activeLayer === 'connections'
                ? ' graph-panel__control-btn--primary'
                : ''
            }`}
            data-control-tone="connections"
            onClick={() => onToggleLayer('connections')}
            type="button"
          >
            Conexiones
          </button>
          <button
            aria-pressed={relationshipToggleState.following}
            className={`graph-panel__control-btn${
              relationshipToggleState.following
                ? ' graph-panel__control-btn--primary'
                : ''
            }`}
            data-control-tone="relationship"
            onClick={() => onToggleRelationship('following')}
            type="button"
          >
            Sigo
          </button>
          <button
            aria-pressed={relationshipToggleState.followers}
            className={`graph-panel__control-btn${
              relationshipToggleState.followers
                ? ' graph-panel__control-btn--primary'
                : ''
            }`}
            data-control-tone="relationship"
            onClick={() => onToggleRelationship('followers')}
            type="button"
          >
            Me siguen
          </button>
        </div>

        <div
          aria-hidden={!isNonReciprocalAvailable}
          className="graph-panel__control-group graph-panel__control-group--aux"
          data-available={isNonReciprocalAvailable ? 'true' : 'false'}
          role="group"
          aria-label="Filtro de reciprocidad"
        >
          <button
            aria-pressed={isNonReciprocalActive}
            className={`graph-panel__control-btn graph-panel__control-btn--aux${
              isNonReciprocalActive ? ' graph-panel__control-btn--primary' : ''
            }`}
            data-control-tone="relationship"
            disabled={!isNonReciprocalAvailable}
            onClick={onToggleOnlyNonReciprocal}
            tabIndex={isNonReciprocalAvailable ? 0 : -1}
            type="button"
          >
            Sin reciprocidad
          </button>
        </div>
      </div>
    </div>
  )
})
