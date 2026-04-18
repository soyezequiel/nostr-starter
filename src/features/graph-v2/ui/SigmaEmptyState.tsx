'use client'

import { memo } from 'react'

interface Props {
  onLoadIdentity: () => void
}

export const SigmaEmptyState = memo(function SigmaEmptyState({ onLoadIdentity }: Props) {
  return (
    <div className="sg-empty">
      <div className="sg-empty__ring">
        <span className="sg-empty__ring-label">SIGMA</span>
      </div>
      <h1>Explorá cualquier identidad Nostr.</h1>
      <p className="sg-empty__sub">
        Cargá un npub o nprofile. Sigma consulta tus relays, descubre relaciones
        y proyecta el vecindario como un grafo vivo.
      </p>
      <button
        className="sg-empty__cta"
        onClick={onLoadIdentity}
        type="button"
      >
        Cargar identidad →
      </button>
      <span className="sg-empty__tip">
        tip: presioná &apos;/&apos; para cambiar identidad
      </span>
    </div>
  )
})
