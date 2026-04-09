import type { Event } from 'nostr-tools'

export class VerifyWorkerPool {
  private isFallbackLoaded = false
  private validateEventFallback: typeof import('nostr-tools').validateEvent | null =
    null
  private verifyEventFallback: typeof import('nostr-tools').verifyEvent | null =
    null

  public async verify(event: Event): Promise<boolean> {
    if (!this.isFallbackLoaded) {
      const { validateEvent, verifyEvent } = await import('nostr-tools')
      this.validateEventFallback = validateEvent
      this.verifyEventFallback = verifyEvent
      this.isFallbackLoaded = true
    }

    return this.validateEventFallback!(event) && this.verifyEventFallback!(event)
  }

  public terminate() {}
}

export const globalVerifyPool = new VerifyWorkerPool()

export function isVerifiedEventAsync(event: Event): Promise<boolean> {
  return globalVerifyPool.verify(event)
}
