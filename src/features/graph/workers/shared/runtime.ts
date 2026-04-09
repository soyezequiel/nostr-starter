import {
  WorkerProtocolError,
  type WorkerActionMap,
  type WorkerActionName,
  type WorkerFailureEnvelope,
  type WorkerRequestEnvelope,
  type WorkerResponseEnvelope,
  type WorkerSuccessEnvelope,
  isRecord,
  toNormalizedWorkerError,
} from '@/features/graph/workers/shared/protocol'

export const WORKER_PROBE_ACTION = '__worker_probe__'

export interface WorkerActionHandler<TRequest, TResponse> {
  validate(payload: unknown): TRequest
  handle(payload: TRequest): TResponse | Promise<TResponse>
}

export type WorkerHandlerRegistry<TMap extends WorkerActionMap> = {
  [TAction in WorkerActionName<TMap>]: WorkerActionHandler<
    TMap[TAction]['request'],
    TMap[TAction]['response']
  >
}

export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  terminate?(): void
}

export interface WorkerClient<TMap extends WorkerActionMap> {
  invoke<TAction extends WorkerActionName<TMap>>(
    action: TAction,
    payload: TMap[TAction]['request'],
  ): Promise<TMap[TAction]['response']>
  dispose(): void
}

function buildFailureEnvelope(
  requestId: string,
  action: string,
  error: unknown,
): WorkerFailureEnvelope<string> {
  return {
    requestId,
    action,
    ok: false,
    error: toNormalizedWorkerError(error),
  }
}

export async function dispatchWorkerRequest<TMap extends WorkerActionMap>(
  registry: WorkerHandlerRegistry<TMap>,
  request: unknown,
): Promise<WorkerResponseEnvelope<string, unknown>> {
  const requestEnvelope = isRecord(request) ? request : {}
  const requestId =
    typeof requestEnvelope.requestId === 'string' && requestEnvelope.requestId.length > 0
      ? requestEnvelope.requestId
      : 'unknown-request'
  const action =
    typeof requestEnvelope.action === 'string' && requestEnvelope.action.length > 0
      ? requestEnvelope.action
      : 'UNKNOWN_ACTION'

  if (!isRecord(request)) {
    return buildFailureEnvelope(
      requestId,
      action,
      new WorkerProtocolError('INVALID_MESSAGE', 'Worker request must be an object.'),
    )
  }

  if (action === WORKER_PROBE_ACTION) {
    const response: WorkerSuccessEnvelope<string, { ready: true }> = {
      requestId,
      action,
      ok: true,
      payload: { ready: true },
    }

    return response
  }

  if (typeof request.payload === 'undefined') {
    return buildFailureEnvelope(
      requestId,
      action,
      new WorkerProtocolError('INVALID_MESSAGE', 'Worker request is missing payload.', {
        action,
      }),
    )
  }

  const handler = registry[action as WorkerActionName<TMap>]

  if (!handler) {
    return buildFailureEnvelope(
      requestId,
      action,
      new WorkerProtocolError('INVALID_ACTION', `Unknown worker action "${action}".`, {
        action,
      }),
    )
  }

  try {
    const normalizedPayload = handler.validate(request.payload)
    const payload = await handler.handle(normalizedPayload)
    const response: WorkerSuccessEnvelope<string, unknown> = {
      requestId,
      action,
      ok: true,
      payload,
    }

    return response
  } catch (error) {
    return buildFailureEnvelope(requestId, action, error)
  }
}

export function bindWorkerScope<TMap extends WorkerActionMap>(
  scope: Pick<DedicatedWorkerGlobalScope, 'addEventListener' | 'postMessage'>,
  registry: WorkerHandlerRegistry<TMap>,
): void {
  scope.addEventListener('message', (event: MessageEvent<unknown>) => {
    void dispatchWorkerRequest(registry, event.data).then((response) => {
      scope.postMessage(response)
    })
  })
}

export function createInlineWorkerLike(
  handleMessage: (request: unknown) => Promise<WorkerResponseEnvelope<string, unknown>>,
): WorkerLike {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>()

  return {
    postMessage(message: unknown) {
      queueMicrotask(() => {
        void handleMessage(message).then((response) => {
          const event = new MessageEvent<unknown>('message', { data: response })
          listeners.forEach((listener) => listener(event))
        })
      })
    },
    addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void) {
      if (type === 'message') {
        listeners.add(listener)
      }
    },
    removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void) {
      if (type === 'message') {
        listeners.delete(listener)
      }
    },
    terminate() {
      listeners.clear()
    },
  }
}

interface PendingWorkerRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export class TypedWorkerClient<TMap extends WorkerActionMap>
  implements WorkerClient<TMap>
{
  private readonly pending = new Map<string, PendingWorkerRequest>()
  private requestSequence = 0
  private disposed = false
  private readonly worker: WorkerLike
  private readonly workerName: string

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (!isRecord(event.data) || typeof event.data.requestId !== 'string') {
      return
    }

    const pendingRequest = this.pending.get(event.data.requestId)
    if (!pendingRequest) {
      return
    }

    this.pending.delete(event.data.requestId)

    if (event.data.ok === true) {
      pendingRequest.resolve(event.data.payload)
      return
    }

    pendingRequest.reject(toNormalizedWorkerError(event.data.error))
  }

  public constructor(worker: WorkerLike, workerName: string) {
    this.worker = worker
    this.workerName = workerName
    this.worker.addEventListener('message', this.handleMessage)
  }

  public invoke<TAction extends WorkerActionName<TMap>>(
    action: TAction,
    payload: TMap[TAction]['request'],
  ): Promise<TMap[TAction]['response']> {
    if (this.disposed) {
      return Promise.reject(
        toNormalizedWorkerError(
          new WorkerProtocolError('WORKER_DISPOSED', `${this.workerName} is already disposed.`),
        ),
      )
    }

    const requestId = `${this.workerName}:${this.requestSequence + 1}`
    this.requestSequence += 1

    const message: WorkerRequestEnvelope<TAction, TMap[TAction]['request']> = {
      requestId,
      action,
      payload,
    }

    return new Promise<TMap[TAction]['response']>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker.postMessage(message)
    })
  }

  public dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessage)

    const error = toNormalizedWorkerError(
      new WorkerProtocolError('WORKER_DISPOSED', `${this.workerName} has been disposed.`),
    )

    this.pending.forEach((pendingRequest) => pendingRequest.reject(error))
    this.pending.clear()
    this.worker.terminate?.()
  }
}
