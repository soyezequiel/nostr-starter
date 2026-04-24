import type { Event } from 'nostr-tools'

import { detectDevicePerformance } from '@/features/graph-runtime/devicePerformance'
import { getVerifyWorkerScriptUrl } from '@/features/graph-runtime/workers/workerScriptUrl'

type PendingRequest = {
  resolve: (value: boolean | boolean[]) => void
  reject: (reason?: unknown) => void
}

type WorkerSlot = {
  worker: Worker
  pending: Map<string, PendingRequest>
}

const readOptionalNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const resolveVerifyWorkerCount = () => {
  if (typeof window === 'undefined') {
    return 0
  }

  const detection = detectDevicePerformance({
    isPointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    viewportWidth: window.innerWidth,
    deviceMemory: readOptionalNumber(
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    ),
    hardwareConcurrency: readOptionalNumber(navigator.hardwareConcurrency),
  })

  return detection.profile === 'low-end-mobile' ? 1 : 2
}

export class VerifyWorkerPool {
  private workerSlots: WorkerSlot[] | null = null
  private nextWorkerIndex = 0
  private requestSequence = 0
  private fallbackPromise:
    | Promise<{
        validateEvent: typeof import('nostr-tools').validateEvent
        verifyEvent: typeof import('nostr-tools').verifyEvent
      }>
    | null = null

  private async loadFallback() {
    this.fallbackPromise ??= import('nostr-tools').then(
      ({ validateEvent, verifyEvent }) => ({
        validateEvent,
        verifyEvent,
      }),
    )

    return this.fallbackPromise
  }

  private disposeWorkers() {
    if (!this.workerSlots) {
      return
    }

    for (const slot of this.workerSlots) {
      for (const pending of slot.pending.values()) {
        pending.reject(new Error('Verify worker pool terminated.'))
      }
      slot.pending.clear()
      slot.worker.terminate()
    }

    this.workerSlots = null
    this.nextWorkerIndex = 0
  }

  private createRequestId(): string {
    this.requestSequence += 1
    return `verify.worker:${this.requestSequence}`
  }

  private initializeWorkers() {
    if (this.workerSlots !== null || typeof Worker === 'undefined') {
      return this.workerSlots
    }

    const workerCount = resolveVerifyWorkerCount()
    if (workerCount <= 0) {
      return null
    }

    try {
      const workerSlots = Array.from({ length: workerCount }, () => {
        const worker = new Worker(getVerifyWorkerScriptUrl(), {
          type: 'module',
          name: 'verify.worker',
        })
        const pending = new Map<string, PendingRequest>()

        const slot: WorkerSlot = {
          worker,
          pending,
        }

        worker.addEventListener(
          'message',
          (
            event: MessageEvent<{
              id?: string
              valid?: boolean
              results?: boolean[]
            }>,
          ) => {
            const id =
              typeof event.data?.id === 'string' ? event.data.id : null
            if (!id) {
              return
            }

            const request = pending.get(id)
            if (!request) {
              return
            }

            pending.delete(id)
            request.resolve(
              Array.isArray(event.data.results)
                ? event.data.results
                : event.data.valid === true,
            )
          },
        )

        const handleWorkerFailure = () => {
          this.disposeWorkers()
        }

        worker.addEventListener('error', handleWorkerFailure)
        worker.addEventListener('messageerror', handleWorkerFailure)

        return slot
      })

      this.workerSlots = workerSlots
      return workerSlots
    } catch (error) {
      console.warn(
        '[graph] Falling back to inline event verification after worker construction failed.',
        error,
      )
      this.workerSlots = null
      return null
    }
  }

  private async verifyManyFallback(events: readonly Event[]): Promise<boolean[]> {
    const { validateEvent, verifyEvent } = await this.loadFallback()
    return events.map((event) => {
      try {
        return validateEvent(event) && verifyEvent(event)
      } catch {
        return false
      }
    })
  }

  private verifyManyWithWorker(events: readonly Event[]): Promise<boolean[]> | null {
    const workerSlots = this.initializeWorkers()

    if (workerSlots && workerSlots.length > 0) {
      const slot = workerSlots[this.nextWorkerIndex % workerSlots.length]
      this.nextWorkerIndex =
        (this.nextWorkerIndex + 1) % Math.max(1, workerSlots.length)
      const requestId = this.createRequestId()

      return new Promise<boolean[]>((resolve, reject) => {
        slot.pending.set(requestId, {
          resolve: (value) => {
            resolve(Array.isArray(value) ? value : [value === true])
          },
          reject,
        })

        try {
          slot.worker.postMessage(
            events.length === 1
              ? {
                  id: requestId,
                  event: events[0],
                }
              : {
                  id: requestId,
                  events,
                },
          )
        } catch (error) {
          slot.pending.delete(requestId)
          reject(error)
        }
      }).then((result) => events.map((_, index) => result[index] === true))
    }

    return null
  }

  public async verifyMany(events: readonly Event[]): Promise<boolean[]> {
    if (events.length === 0) {
      return []
    }

    const workerVerification = this.verifyManyWithWorker(events)
    if (workerVerification) {
      return workerVerification.catch(() => this.verifyManyFallback(events))
    }

    return this.verifyManyFallback(events)
  }

  public async verify(event: Event): Promise<boolean> {
    const [verified] = await this.verifyMany([event])
    return verified === true
  }

  public terminate() {
    this.disposeWorkers()
  }
}

export const globalVerifyPool = new VerifyWorkerPool()

export function isVerifiedEventAsync(event: Event): Promise<boolean> {
  return globalVerifyPool.verify(event)
}

export function isVerifiedEventsAsync(events: readonly Event[]): Promise<boolean[]> {
  return globalVerifyPool.verifyMany(events)
}
