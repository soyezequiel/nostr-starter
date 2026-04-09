import { memo, useEffect, useRef, useState } from 'react'

import type { PerfCounters } from '@/features/graph/components/perfCounters'

export interface PerfOverlayProps {
  counters: React.RefObject<PerfCounters>
  nodeCount: number
  linkCount: number
  labelCount: number
  edgesThinned: number
  degradedReason: string
  visible: boolean
  onToggle: () => void
}

interface PerfSnapshot {
  reactRendersPerSec: number
  modelBuildsPerSec: number
  buildMs: number
  trigger: string
}

export const PerfOverlay = memo(function PerfOverlay({
  counters,
  nodeCount,
  linkCount,
  labelCount,
  edgesThinned,
  degradedReason,
  visible,
  onToggle,
}: PerfOverlayProps) {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>({
    reactRendersPerSec: 0,
    modelBuildsPerSec: 0,
    buildMs: 0,
    trigger: 'init',
  })
  const prevRef = useRef({
    reactRenders: 0,
    modelBuilds: 0,
    sampledAt: 0,
  })

  useEffect(() => {
    if (!visible) {
      return
    }

    const interval = window.setInterval(() => {
      const counterSnapshot = counters.current
      if (!counterSnapshot) {
        return
      }

      const previous = prevRef.current
      const now = performance.now()
      if (previous.sampledAt === 0) {
        previous.sampledAt = now
        return
      }

      const elapsed = (now - previous.sampledAt) / 1000
      if (elapsed <= 0) {
        return
      }

      const deltaRenders = counterSnapshot.reactRenders - previous.reactRenders
      const deltaBuilds = counterSnapshot.modelBuilds - previous.modelBuilds

      setSnapshot({
        reactRendersPerSec: Math.round((deltaRenders / elapsed) * 10) / 10,
        modelBuildsPerSec: Math.round((deltaBuilds / elapsed) * 10) / 10,
        buildMs: Math.round(counterSnapshot.avgBuildMs * 100) / 100,
        trigger: counterSnapshot.lastRenderTrigger,
      })

      previous.reactRenders = counterSnapshot.reactRenders
      previous.modelBuilds = counterSnapshot.modelBuilds
      previous.sampledAt = now
    }, 500)

    return () => window.clearInterval(interval)
  }, [counters, visible])

  return (
    <>
      <button
        aria-label="Toggle performance overlay"
        className="perf-toggle"
        onClick={onToggle}
        title={visible ? 'Ocultar perf overlay' : 'Mostrar perf overlay'}
        type="button"
      >
        perf
      </button>

      {visible ? (
        <div aria-live="off" className="perf-overlay">
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">react</span>
            <span className="perf-overlay__value">
              {snapshot.reactRendersPerSec}/s
            </span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">model</span>
            <span className="perf-overlay__value">
              {snapshot.modelBuildsPerSec}/s
            </span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">build</span>
            <span className="perf-overlay__value">
              {snapshot.buildMs}ms
            </span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">graph</span>
            <span className="perf-overlay__value">
              {nodeCount}n {linkCount}e
            </span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">labels</span>
            <span className="perf-overlay__value">{labelCount}</span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">thinned</span>
            <span className="perf-overlay__value">{edgesThinned}</span>
          </div>
          <div className="perf-overlay__row">
            <span className="perf-overlay__label">state</span>
            <span className="perf-overlay__value">{degradedReason}</span>
          </div>
          <div className="perf-overlay__row perf-overlay__row--trigger">
            <span className="perf-overlay__label">trigger</span>
            <span className="perf-overlay__value">{snapshot.trigger}</span>
          </div>
        </div>
      ) : null}
    </>
  )
})
