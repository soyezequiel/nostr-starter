'use client'

import { memo } from 'react'
import type { ReactNode } from 'react'

export interface RailButton {
  id: string
  tip: string
  icon: ReactNode
  active?: boolean
  badge?: number
  onClick: () => void
  dividerAfter?: boolean
}

interface Props {
  buttons: RailButton[]
}

export const SigmaSideRail = memo(function SigmaSideRail({ buttons }: Props) {
  return (
    <div className="sg-rail">
      {buttons.map((btn) => (
        <div key={btn.id}>
          <button
            aria-label={btn.tip}
            className={`sg-rail-btn${btn.active ? ' sg-rail-btn--active' : ''}`}
            data-tip={btn.tip}
            onClick={btn.onClick}
            type="button"
          >
            {btn.icon}
            {btn.badge && btn.badge > 0 ? (
              <span className="sg-rail-btn__badge">{btn.badge > 99 ? '99+' : btn.badge}</span>
            ) : null}
          </button>
          {btn.dividerAfter && <div className="sg-rail-divider" />}
        </div>
      ))}
    </div>
  )
})
