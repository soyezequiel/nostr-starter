'use client'

import type { ReactNode } from 'react'

export interface RailButton {
  id: string
  tip: string
  icon: ReactNode
  active?: boolean
  onClick: () => void
  dividerAfter?: boolean
}

interface Props {
  buttons: RailButton[]
}

export function SigmaSideRail({ buttons }: Props) {
  return (
    <div className="sg-rail">
      {buttons.map((btn) => (
        <div key={btn.id}>
          <button
            className={`sg-rail-btn${btn.active ? ' sg-rail-btn--active' : ''}`}
            data-tip={btn.tip}
            onClick={btn.onClick}
            type="button"
          >
            {btn.icon}
          </button>
          {btn.dividerAfter && <div className="sg-rail-divider" />}
        </div>
      ))}
    </div>
  )
}
