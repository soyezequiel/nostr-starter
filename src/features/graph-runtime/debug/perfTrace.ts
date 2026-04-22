type PerfTraceDetails = Record<string, unknown> | (() => Record<string, unknown>)

type PerfTraceEnvName =
  | 'NEXT_PUBLIC_GRAPH_V2_PERF'
  | 'NEXT_PUBLIC_GRAPH_V2_TRACE_PERF'
  | 'NEXT_PUBLIC_GRAPH_V2_TRACE_PERF_VERBOSE'

const readEnvFlag = (name: PerfTraceEnvName) => {
  if (typeof process === 'undefined') {
    return false
  }

  switch (name) {
    case 'NEXT_PUBLIC_GRAPH_V2_PERF':
      return process.env.NEXT_PUBLIC_GRAPH_V2_PERF === '1'
    case 'NEXT_PUBLIC_GRAPH_V2_TRACE_PERF':
      return process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_PERF === '1'
    case 'NEXT_PUBLIC_GRAPH_V2_TRACE_PERF_VERBOSE':
      return process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_PERF_VERBOSE === '1'
  }

  return false
}

export function isGraphPerfTraceEnabled(): boolean {
  return readEnvFlag('NEXT_PUBLIC_GRAPH_V2_TRACE_PERF')
}

export function isGraphPerfStatsEnabled(): boolean {
  return readEnvFlag('NEXT_PUBLIC_GRAPH_V2_PERF') || isGraphPerfTraceEnabled()
}

export function isGraphPerfTraceVerbose(): boolean {
  return readEnvFlag('NEXT_PUBLIC_GRAPH_V2_TRACE_PERF_VERBOSE')
}

export function nowGraphPerfMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

const resolvePerfTraceDetails = (
  stage: string,
  details: PerfTraceDetails,
): Record<string, unknown> => {
  try {
    return typeof details === 'function' ? details() : details
  } catch (error) {
    return {
      detailsError:
        error instanceof Error ? error.message : 'Failed to resolve perf details.',
      detailsStage: stage,
    }
  }
}

export function traceGraphPerf(
  stage: string,
  details: PerfTraceDetails = {},
): void {
  if (!isGraphPerfStatsEnabled()) {
    return
  }

  const resolvedDetails = resolvePerfTraceDetails(stage, details)

  console.info(`[graph-v2:trace-perf] ${stage}`, {
    stage,
    verbose: isGraphPerfTraceVerbose(),
    ...resolvedDetails,
  })
}

export function traceGraphPerfDuration(
  stage: string,
  startedAtMs: number,
  details: PerfTraceDetails = {},
  options: { thresholdMs?: number } = {},
): number {
  const durationMs = nowGraphPerfMs() - startedAtMs
  if (
    !isGraphPerfTraceEnabled() ||
    (!isGraphPerfTraceVerbose() && durationMs < (options.thresholdMs ?? 16))
  ) {
    return durationMs
  }

  traceGraphPerf(stage, () => ({
    durationMs: Math.round(durationMs * 10) / 10,
    ...resolvePerfTraceDetails(stage, details),
  }))

  return durationMs
}
