'use client'

import { memo, useId } from 'react'
import type { ReactNode } from 'react'

interface Props {
  canClose: boolean
  onClose: () => void
  savedRootsSlot: ReactNode
  manualInputSlot: ReactNode
  title?: string
  copy?: string
}

const SIGMA_LOADER_AMBIENT = (
  <div className="sg-loader__ambient" aria-hidden="true">
    <div className="sg-loader__grid" />
    <svg className="sg-loader__map" viewBox="0 0 420 420" role="presentation">
      <g className="sg-loader__map-edges">
        <path d="M86 134 168 96 248 142 335 105" />
        <path d="M118 272 196 220 304 254 354 182" />
        <path d="M168 96 196 220 248 142 354 182" />
        <path d="M86 134 118 272 196 220" />
        <path d="M248 142 304 254 228 334" />
      </g>
      <g className="sg-loader__map-nodes">
        <circle cx="86" cy="134" r="9" />
        <circle cx="168" cy="96" r="14" />
        <circle cx="248" cy="142" r="10" />
        <circle cx="335" cy="105" r="7" />
        <circle cx="118" cy="272" r="11" />
        <circle cx="196" cy="220" r="18" />
        <circle cx="304" cy="254" r="13" />
        <circle cx="354" cy="182" r="9" />
        <circle cx="228" cy="334" r="8" />
      </g>
    </svg>
  </div>
)

export const SigmaRootLoader = memo(function SigmaRootLoader({
  canClose,
  onClose,
  savedRootsSlot,
  manualInputSlot,
  title = 'Cargar identidad',
  copy = 'Pegá un npub o nprofile — Sigma consultará tus relays y proyectará su vecindario.',
}: Props) {
  const titleId = useId()

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="sg-loader"
      role="dialog"
    >
      {SIGMA_LOADER_AMBIENT}

      <div className="sg-loader__card">
        <div className="sg-loader__chrome" aria-hidden="true">
          <span>SIGMA</span>
          <span>labs/sigma</span>
        </div>
        <div className="sg-loader__head">
          <h1 id={titleId}>{title}</h1>
          <p>{copy}</p>
        </div>
        <div className="sg-loader__body">
          {manualInputSlot}

          <div className="sg-loader__divider">Identidades recientes</div>

          {savedRootsSlot}

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
})
