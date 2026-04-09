import { verifyEvent, validateEvent, type Event } from 'nostr-tools'

self.onmessage = (e: MessageEvent<{ id: string; event: Event }>) => {
  const { id, event } = e.data

  try {
    const valid = validateEvent(event) && verifyEvent(event)
    self.postMessage({ id, valid })
  } catch {
    self.postMessage({ id, valid: false })
  }
}
