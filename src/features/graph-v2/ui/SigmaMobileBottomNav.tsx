'use client'

import { memo } from 'react'
import type { ReactNode } from 'react'

export interface MobileNavButton {
  id: string
  label: string
  tip: string
  icon: ReactNode
  active?: boolean
  badge?: number
  onClick: () => void
}

interface Props {
  buttons: MobileNavButton[]
}

export const SigmaMobileBottomNav = memo(function SigmaMobileBottomNav({
  buttons,
}: Props) {
  return (
    <nav className="sg-mobile-nav" aria-label="Navegacion principal del grafo">
      {buttons.map((button) => (
        <button
          aria-label={button.tip}
          className={`sg-mobile-nav__item${button.active ? ' sg-mobile-nav__item--active' : ''}`}
          key={button.id}
          onClick={button.onClick}
          type="button"
        >
          <span className="sg-mobile-nav__icon">
            {button.icon}
            {button.badge && button.badge > 0 ? (
              <span className="sg-mobile-nav__badge">
                {button.badge > 99 ? '99+' : button.badge}
              </span>
            ) : null}
          </span>
          <span className="sg-mobile-nav__label">{button.label}</span>
        </button>
      ))}
    </nav>
  )
})
