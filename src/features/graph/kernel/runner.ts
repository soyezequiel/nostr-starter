import type { UiLayer } from '@/features/graph/app/store'
import type { KeywordExtractInput } from '@/features/graph/workers/events/contracts'
import type {
  AppKernel,
  LoadRootResult,
  ExpandNodeResult,
  SearchKeywordResult,
  FindPathResult,
  ToggleLayerResult,
  SelectNodeResult,
} from '@/features/graph/kernel/runtime'
import { KernelCommandError } from '@/features/graph/kernel/runtime'

export type ScenarioCommand =
  | { type: 'loadRoot'; pubkey: string }
  | { type: 'expandNode'; pubkey: string }
  | { type: 'searchKeyword'; keyword: string; extracts: KeywordExtractInput[] }
  | { type: 'toggleLayer'; layer: UiLayer }
  | { type: 'findPath'; source: string; target: string; algorithm?: 'bfs' | 'dijkstra' }
  | { type: 'selectNode'; pubkey: string | null }

export type ScenarioCommandResult =
  | { type: 'loadRoot'; result: LoadRootResult }
  | { type: 'expandNode'; result: ExpandNodeResult }
  | { type: 'searchKeyword'; result: SearchKeywordResult }
  | { type: 'toggleLayer'; result: ToggleLayerResult }
  | { type: 'findPath'; result: FindPathResult }
  | { type: 'selectNode'; result: SelectNodeResult }

export interface ScenarioStepReport {
  stepIndex: number
  command: ScenarioCommand
  result: ScenarioCommandResult | null
  error: ScenarioStepError | null
  durationMs: number
}

export interface ScenarioStepError {
  code: string
  message: string
  details: Record<string, unknown>
}

export interface ScenarioGraphSnapshot {
  nodeCount: number
  linkCount: number
  rootNodePubkey: string | null
  capReached: boolean
}

export interface ScenarioRelayHealthSnapshot {
  relayUrls: string[]
  relayHealth: Record<string, { status: string }>
}

export interface ScenarioReport {
  name: string
  status: 'completed' | 'failed' | 'partial'
  startedAtMs: number
  finishedAtMs: number
  steps: ScenarioStepReport[]
  failedAtStep: number | null
  finalState: {
    graph: ScenarioGraphSnapshot
    relays: ScenarioRelayHealthSnapshot
    ui: {
      activeLayer: string
      selectedNodePubkey: string | null
      currentKeyword: string
      rootLoadStatus: string
    }
    analysis: {
      status: string
      isStale: boolean
      confidence: string | null
      mode: string | null
    }
    export: {
      phase: string
      percent: number
    }
  }
}

export interface ScenarioDefinition {
  name: string
  commands: ScenarioCommand[]
}

export async function runScenario(
  kernel: AppKernel,
  scenario: ScenarioDefinition,
  clock: () => number,
): Promise<ScenarioReport> {
  const startedAtMs = clock()
  const steps: ScenarioStepReport[] = []
  let failedAtStep: number | null = null

  for (let i = 0; i < scenario.commands.length; i++) {
    const command = scenario.commands[i]
    const stepStart = clock()
    let result: ScenarioCommandResult | null = null
    let error: ScenarioStepError | null = null

    try {
      result = await executeCommand(kernel, command)
    } catch (err) {
      error = normalizeStepError(err)
      failedAtStep = i
    }

    steps.push({
      stepIndex: i,
      command,
      result,
      error,
      durationMs: clock() - stepStart,
    })

    if (error) break
  }

  await kernel.settleBackgroundTasks()
  const state = kernel.getState()
  const finishedAtMs = clock()

  return {
    name: scenario.name,
    status: failedAtStep !== null
      ? 'failed'
      : steps.length === scenario.commands.length
        ? 'completed'
        : 'partial',
    startedAtMs,
    finishedAtMs,
    steps,
    failedAtStep,
    finalState: {
      graph: {
        nodeCount: Object.keys(state.nodes).length,
        linkCount: state.links.length,
        rootNodePubkey: state.rootNodePubkey,
        capReached: state.graphCaps.capReached,
      },
      relays: {
        relayUrls: state.relayUrls,
        relayHealth: Object.fromEntries(
          Object.entries(state.relayHealth).map(([url, h]) => [url, { status: h.status }]),
        ),
      },
      ui: {
        activeLayer: state.activeLayer,
        selectedNodePubkey: state.selectedNodePubkey,
        currentKeyword: state.currentKeyword,
        rootLoadStatus: state.rootLoad.status,
      },
      analysis: {
        status: state.graphAnalysis.status,
        isStale: state.graphAnalysis.isStale,
        confidence: state.graphAnalysis.result?.confidence ?? null,
        mode: state.graphAnalysis.result?.mode ?? null,
      },
      export: {
        phase: state.exportJob.phase,
        percent: state.exportJob.percent,
      },
    },
  }
}

async function executeCommand(
  kernel: AppKernel,
  command: ScenarioCommand,
): Promise<ScenarioCommandResult> {
  switch (command.type) {
    case 'loadRoot': {
      const result = await kernel.loadRoot(command.pubkey)
      return { type: 'loadRoot', result }
    }
    case 'expandNode': {
      const result = await kernel.expandNode(command.pubkey)
      return { type: 'expandNode', result }
    }
    case 'searchKeyword': {
      const result = await kernel.searchKeyword(command.keyword, command.extracts)
      return { type: 'searchKeyword', result }
    }
    case 'toggleLayer': {
      const result = kernel.toggleLayer(command.layer)
      return { type: 'toggleLayer', result }
    }
    case 'findPath': {
      const result = await kernel.findPath(command.source, command.target, command.algorithm)
      return { type: 'findPath', result }
    }
    case 'selectNode': {
      const result = kernel.selectNode(command.pubkey)
      return { type: 'selectNode', result }
    }
  }
}

function isNormalizedWorkerError(err: unknown): err is { code: string; message: string; source: string; details?: Record<string, unknown> } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    typeof (err as Record<string, unknown>).message === 'string'
  )
}

function normalizeStepError(err: unknown): ScenarioStepError {
  if (err instanceof KernelCommandError) {
    return {
      code: err.code,
      message: err.message,
      details: err.details,
    }
  }

  if (err instanceof Error) {
    return {
      code: 'COMMAND_FAILED',
      message: err.message,
      details: {},
    }
  }

  if (isNormalizedWorkerError(err)) {
    return {
      code: err.code,
      message: err.message,
      details: err.details ?? {},
    }
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(err),
    details: {},
  }
}
