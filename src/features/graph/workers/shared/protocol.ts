export interface NormalizedWorkerError {
  code: string
  message: string
  source: 'worker'
  retryable: boolean
  details?: Record<string, unknown>
}

export class WorkerProtocolError extends Error {
  public readonly code: string
  public readonly details?: Record<string, unknown>
  public readonly retryable: boolean

  public constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryable = false,
  ) {
    super(message)
    this.name = 'WorkerProtocolError'
    this.code = code
    this.details = details
    this.retryable = retryable
  }
}

export type WorkerActionMap = Record<
  string,
  {
    request: unknown
    response: unknown
  }
>

export type WorkerActionName<TMap extends WorkerActionMap> = Extract<keyof TMap, string>

export interface WorkerRequestEnvelope<TAction extends string = string, TPayload = unknown> {
  requestId: string
  action: TAction
  payload: TPayload
}

export interface WorkerSuccessEnvelope<TAction extends string = string, TResult = unknown> {
  requestId: string
  action: TAction
  ok: true
  payload: TResult
}

export interface WorkerFailureEnvelope<TAction extends string = string> {
  requestId: string
  action: TAction
  ok: false
  error: NormalizedWorkerError
}

export type WorkerResponseEnvelope<TAction extends string = string, TResult = unknown> =
  | WorkerSuccessEnvelope<TAction, TResult>
  | WorkerFailureEnvelope<TAction>

export type WorkerRequestForMap<TMap extends WorkerActionMap> = {
  [TAction in WorkerActionName<TMap>]: WorkerRequestEnvelope<TAction, TMap[TAction]['request']>
}[WorkerActionName<TMap>]

export type WorkerResponseForMap<TMap extends WorkerActionMap> = {
  [TAction in WorkerActionName<TMap>]: WorkerResponseEnvelope<TAction, TMap[TAction]['response']>
}[WorkerActionName<TMap>]

export interface WorkerDiagnostic {
  code: string
  message: string
  detail?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toNormalizedWorkerError(error: unknown): NormalizedWorkerError {
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    error.source === 'worker' &&
    typeof error.retryable === 'boolean'
  ) {
    return {
      code: error.code,
      message: error.message,
      source: 'worker',
      retryable: error.retryable,
      details: isRecord(error.details) ? error.details : undefined,
    }
  }

  if (error instanceof WorkerProtocolError) {
    return {
      code: error.code,
      message: error.message,
      source: 'worker',
      retryable: error.retryable,
      details: error.details,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'WORKER_HANDLER_FAILED',
      message: error.message,
      source: 'worker',
      retryable: false,
    }
  }

  return {
    code: 'WORKER_HANDLER_FAILED',
    message: 'The worker handler failed with an unknown error.',
    source: 'worker',
    retryable: false,
    details: isRecord(error) ? error : undefined,
  }
}
