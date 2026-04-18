'use client'

import { memo } from 'react'

export interface HudStat {
  k: string
  v: string
  tone?: 'good' | 'warn' | 'default'
}

interface Props {
  stats: HudStat[]
}

export const SigmaHud = memo(function SigmaHud({ stats }: Props) {
  return (
    <div className="sg-hud">
      <div className="sg-hud-card">
        {stats.map((stat) => (
          <div className="sg-stat" key={stat.k}>
            <span className="sg-stat__k">{stat.k}</span>
            <span
              className={`sg-stat__v${
                stat.tone === 'good'
                  ? ' sg-stat__v--good'
                  : stat.tone === 'warn'
                    ? ' sg-stat__v--warn'
                    : ''
              }`}
            >
              {stat.v}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})
