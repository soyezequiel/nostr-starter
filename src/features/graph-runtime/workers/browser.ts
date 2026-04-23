import type { EventsWorkerActionMap } from '@/features/graph-runtime/workers/events/contracts'
import type { GraphWorkerActionMap } from '@/features/graph-runtime/workers/graph/contracts'
import {
  createInlineEventsWorkerGateway,
  createInlineGraphWorkerGateway,
} from '@/features/graph-runtime/workers/gateway'
import type {
  WorkerActionMap,
  WorkerActionName,
} from '@/features/graph-runtime/workers/shared/protocol'
import {
  TypedWorkerClient,
  WORKER_PROBE_ACTION,
  type WorkerClient,
  type WorkerLike,
} from '@/features/graph-runtime/workers/shared/runtime'
import {
  getEventsWorkerScriptUrl,
  getGraphWorkerScriptUrl,
} from '@/features/graph-runtime/workers/workerScriptUrl'

const INLINE_WORKERS_FLAG = '1'
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'
const WORKER_PROBE_TIMEOUT_MS = IS_DEVELOPMENT ? 15_000 : 5_000
const WORKER_PROBE_ATTEMPTS = IS_DEVELOPMENT ? 3 : 2
const shouldForceInlineWorkers = () =>
  process.env.NEXT_PUBLIC_GRAPH_INLINE_WORKERS === INLINE_WORKERS_FLAG

const createProbeRequestId = (workerName: string) =>
  `${workerName}:probe:${
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString(36)
  }`

const isProbeResponse = (
  data: unknown,
  requestId: string,
): data is { requestId: string; ok: boolean } =>
  typeof data === 'object' &&
  data !== null &&
  'requestId' in data &&
  'ok' in data &&
  data.requestId === requestId

function probeNativeWorkerOnce(worker: Worker, workerName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = createProbeRequestId(workerName)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.removeEventListener('messageerror', handleMessageError)
    }

    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`${workerName} did not acknowledge the startup probe.`))
    }, WORKER_PROBE_TIMEOUT_MS)

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isProbeResponse(event.data, requestId)) {
        return
      }

      cleanup()

      if (event.data.ok === true) {
        resolve()
        return
      }

      reject(new Error(`${workerName} rejected the startup probe.`))
    }

    const handleError = () => {
      cleanup()
      reject(new Error(`${workerName} failed during startup.`))
    }

    const handleMessageError = () => {
      cleanup()
      reject(new Error(`${workerName} raised messageerror during startup.`))
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    worker.addEventListener('messageerror', handleMessageError)
    worker.postMessage({
      requestId,
      action: WORKER_PROBE_ACTION,
      payload: null,
    })
  })
}

const yieldToNextTask = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })

async function probeNativeWorker(worker: Worker, workerName: string): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= WORKER_PROBE_ATTEMPTS; attempt += 1) {
    try {
      await probeNativeWorkerOnce(worker, workerName)
      return
    } catch (error) {
      lastError = error

      const isTimeoutError =
        error instanceof Error &&
        error.message === `${workerName} did not acknowledge the startup probe.`

      if (!isTimeoutError || attempt >= WORKER_PROBE_ATTEMPTS) {
        throw error
      }

      // A busy main thread can delay delivery of an already-posted worker
      // message long enough for the timeout callback to win the race. Yield and
      // probe once more before assuming native workers are unavailable.
      await yieldToNextTask()
    }
  }

  throw lastError
}

class BrowserWorkerGateway<TMap extends WorkerActionMap>
  implements WorkerClient<TMap>
{
  private readonly activeClientPromise: Promise<WorkerClient<TMap>>
  private disposed = false

  public constructor(
    workerScriptUrl: string,
    workerName: string,
    createInlineGateway: () => TypedWorkerClient<TMap>,
  ) {
    this.activeClientPromise = this.createActiveClient(
      workerScriptUrl,
      workerName,
      createInlineGateway,
    )
  }

  private async createActiveClient(
    workerScriptUrl: string,
    workerName: string,
    createInlineGateway: () => TypedWorkerClient<TMap>,
  ): Promise<WorkerClient<TMap>> {
    if (shouldForceInlineWorkers() || typeof Worker === 'undefined') {
      return createInlineGateway()
    }

    let worker: Worker
    try {
      worker = new Worker(workerScriptUrl, {
        type: 'module',
        name: workerName,
      })
    } catch (error) {
      console.warn(
        `[graph] Falling back to inline ${workerName} gateway after native worker construction failed.`,
        error,
      )
      return createInlineGateway()
    }

    const nativeClient = new TypedWorkerClient(worker as WorkerLike, workerName)

    try {
      await probeNativeWorker(worker, workerName)
      if (this.disposed) {
        nativeClient.dispose()
      }
      return nativeClient
    } catch (error) {
      nativeClient.dispose()
      console.warn(
        `[graph] Falling back to inline ${workerName} gateway after native worker startup failed.`,
        error,
      )
      return createInlineGateway()
    }
  }

  public invoke<TAction extends WorkerActionName<TMap>>(
    action: TAction,
    payload: TMap[TAction]['request'],
  ): Promise<TMap[TAction]['response']> {
    return this.activeClientPromise.then((client) => client.invoke(action, payload))
  }

  public dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    void this.activeClientPromise.then((client) => {
      client.dispose()
    })
  }
}

function createNativeWorkerGateway<TMap extends WorkerActionMap>(
  workerScriptUrl: string,
  workerName: string,
  createInlineGateway: () => TypedWorkerClient<TMap>,
): WorkerClient<TMap> {
  return new BrowserWorkerGateway<TMap>(
    workerScriptUrl,
    workerName,
    createInlineGateway,
  )
}

export function createEventsWorkerGateway(): WorkerClient<EventsWorkerActionMap> {
  return createNativeWorkerGateway<EventsWorkerActionMap>(
    getEventsWorkerScriptUrl(),
    'events.worker',
    createInlineEventsWorkerGateway,
  )
}

export function createGraphWorkerGateway(): WorkerClient<GraphWorkerActionMap> {
  return createNativeWorkerGateway<GraphWorkerActionMap>(
    getGraphWorkerScriptUrl(),
    'graph.worker',
    createInlineGraphWorkerGateway,
  )
}
