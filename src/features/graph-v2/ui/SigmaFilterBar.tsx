'use client'

import { memo, useEffect, useRef } from 'react'

export interface FilterPill {
  id: 'all' | 'following' | 'followers' | 'mutuals' | 'oneway' | 'connections'
  label: string
  count: number | null
  caption?: string
  swatch: string
  hint: string
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
  const stackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const stack = stackRef.current
    if (!stack || typeof window === 'undefined') return

    const app = stack.closest<HTMLElement>('[data-graph-v2]')
    if (!app) return

    const syncTopChrome = () => {
      const stackStyles = window.getComputedStyle(stack)
      if (stackStyles.top === 'auto') {
        app.style.removeProperty('--sg-filter-stack-bottom')
        return
      }

      const appRect = app.getBoundingClientRect()
      const stackRect = stack.getBoundingClientRect()
      const stackBottom = Math.max(0, Math.ceil(stackRect.bottom - appRect.top))

      app.style.setProperty('--sg-filter-stack-bottom', `${stackBottom}px`)
    }

    syncTopChrome()

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            syncTopChrome()
          })

    resizeObserver?.observe(stack)
    window.addEventListener('resize', syncTopChrome)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncTopChrome)
      app.style.removeProperty('--sg-filter-stack-bottom')
    }
  }, [activeId, pills])

  return (
    <div
      className="sg-filter-stack"
      ref={stackRef}
      role="region"
      aria-label="Filtros del grafo"
    >
      <div className="sg-filter-bar">
        {pills.map((pill) => (
          <button
            aria-label={`${pill.label}: ${pill.hint}`}
            className={`sg-filter-pill${pill.id === activeId ? ' sg-filter-pill--active' : ''}`}
            key={pill.id}
            onClick={() => onSelect(pill.id)}
            title={pill.hint}
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
              {pill.caption ?? pill.count ?? '-'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
})
