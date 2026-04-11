import type { Event } from 'nostr-tools'

import { detectDevicePerformance } from '@/features/graph/devicePerformance'

const VERIFY_WORKER_SCRIPT_URL = '/workers/verify.worker.js'

type PendingRequest = {
  resolve: (value: boolean) => void
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
        const worker = new Worker(VERIFY_WORKER_SCRIPT_URL, {
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
          (event: MessageEvent<{ id?: string; valid?: boolean }>) => {
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
            request.resolve(event.data.valid === true)
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

  public async verify(event: Event): Promise<boolean> {
    const workerSlots = this.initializeWorkers()

    if (workerSlots && workerSlots.length > 0) {
      const slot = workerSlots[this.nextWorkerIndex % workerSlots.length]
      this.nextWorkerIndex =
        (this.nextWorkerIndex + 1) % Math.max(1, workerSlots.length)
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}:${Math.random().toString(36).slice(2)}`

      return new Promise<boolean>((resolve, reject) => {
        slot.pending.set(requestId, { resolve, reject })

        try {
          slot.worker.postMessage({
            id: requestId,
            event,
          })
        } catch (error) {
          slot.pending.delete(requestId)
          reject(error)
        }
      }).catch(async () => {
        const { validateEvent, verifyEvent } = await this.loadFallback()
        return validateEvent(event) && verifyEvent(event)
      })
    }

    const { validateEvent, verifyEvent } = await this.loadFallback()
    return validateEvent(event) && verifyEvent(event)
  }

  public terminate() {
    this.disposeWorkers()
  }
}

export const globalVerifyPool = new VerifyWorkerPool()

export function isVerifiedEventAsync(event: Event): Promise<boolean> {
  return globalVerifyPool.verify(event)
}
