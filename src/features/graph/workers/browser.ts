import type { EventsWorkerActionMap } from '@/features/graph/workers/events/contracts'
import type { GraphWorkerActionMap } from '@/features/graph/workers/graph/contracts'
import {
  createInlineEventsWorkerGateway,
  createInlineGraphWorkerGateway,
} from '@/features/graph/workers/gateway'
import type {
  WorkerActionMap,
  WorkerActionName,
} from '@/features/graph/workers/shared/protocol'
import {
  TypedWorkerClient,
  WORKER_PROBE_ACTION,
  type WorkerClient,
  type WorkerLike,
} from '@/features/graph/workers/shared/runtime'

const INLINE_WORKERS_FLAG = '1'
const WORKER_PROBE_TIMEOUT_MS = 1_500
const EVENTS_WORKER_SCRIPT_URL = '/workers/events.worker.js'
const GRAPH_WORKER_SCRIPT_URL = '/workers/graph.worker.js'

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

function probeNativeWorker(worker: Worker, workerName: string): Promise<void> {
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
    EVENTS_WORKER_SCRIPT_URL,
    'events.worker',
    createInlineEventsWorkerGateway,
  )
}

export function createGraphWorkerGateway(): WorkerClient<GraphWorkerActionMap> {
  return createNativeWorkerGateway<GraphWorkerActionMap>(
    GRAPH_WORKER_SCRIPT_URL,
    'graph.worker',
    createInlineGraphWorkerGateway,
  )
}
