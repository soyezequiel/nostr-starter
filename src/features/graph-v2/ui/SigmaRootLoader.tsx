'use client'

import type { ReactNode } from 'react'

interface Props {
  canClose: boolean
  onClose: () => void
  savedRootsSlot: ReactNode
  manualInputSlot: ReactNode
  feedback?: string | null
  title?: string
  copy?: string
}

export function SigmaRootLoader({
  canClose,
  onClose,
  savedRootsSlot,
  manualInputSlot,
  feedback,
  title = 'Cargar identidad',
  copy = 'Pegá un npub o nprofile — Sigma consultará tus relays y proyectará su vecindario.',
}: Props) {
  return (
    <div className="sg-loader">
      <div className="sg-loader__card">
        <div className="sg-loader__head">
          <h1>{title}</h1>
          <p>{copy}</p>
        </div>
        <div className="sg-loader__body">
          {manualInputSlot}

          <div className="sg-loader__divider">Identidades recientes</div>

          {savedRootsSlot}

          {feedback ? (
            <p className="sg-loader__feedback">{feedback}</p>
          ) : null}

          {canClose ? (
            <div className="sg-loader__cancel">
              <button
                className="sg-btn sg-btn--ghost"
                onClick={onClose}
                style={{ flex: 'none' }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
