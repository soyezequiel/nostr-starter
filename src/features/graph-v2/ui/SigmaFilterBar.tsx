'use client'

import { memo } from 'react'

export interface FilterPill {
  id: 'all' | 'following' | 'followers' | 'mutuals' | 'oneway'
  label: string
  count: number | null
  swatch: string
}

interface Props {
  activeId: FilterPill['id']
  pills: FilterPill[]
  onSelect: (id: FilterPill['id']) => void
}

export const SigmaFilterBar = memo(function SigmaFilterBar({
  activeId,
  pills,
  onSelect,
}: Props) {
  return (
    <div className="sg-filter-bar">
      {pills.map((pill) => (
        <button
          className={`sg-filter-pill${pill.id === activeId ? ' sg-filter-pill--active' : ''}`}
          key={pill.id}
          onClick={() => onSelect(pill.id)}
          type="button"
        >
          <span
            className="sg-filter-pill__swatch"
            style={{ background: pill.swatch }}
          />
          {pill.label}
          <span
            className="sg-filter-pill__count"
            style={{
              color:
                pill.id === activeId
                  ? 'oklch(16% 0 0 / 0.5)'
                  : 'var(--sg-fg-faint)',
            }}
          >
            {pill.count ?? '—'}
          </span>
        </button>
      ))}
    </div>
  )
})
