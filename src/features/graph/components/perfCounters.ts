export interface PerfCounters {
  reactRenders: number
  modelBuilds: number
  lastBuildMs: number
  avgBuildMs: number
  lastRenderTrigger: string
}

export function createPerfCounters(): PerfCounters {
  return {
    reactRenders: 0,
    modelBuilds: 0,
    lastBuildMs: 0,
    avgBuildMs: 0,
    lastRenderTrigger: 'init',
  }
}
