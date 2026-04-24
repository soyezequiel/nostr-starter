import { verifyEvent, validateEvent, type Event } from 'nostr-tools'

const verifyNostrEvent = (event: Event): boolean => {
  try {
    return validateEvent(event) && verifyEvent(event)
  } catch {
    return false
  }
}

self.onmessage = (
  e: MessageEvent<{ id: string; event?: Event; events?: Event[] }>,
) => {
  const { id, event, events } = e.data

  if (Array.isArray(events)) {
    self.postMessage({ id, results: events.map(verifyNostrEvent) })
    return
  }

  self.postMessage({ id, valid: event ? verifyNostrEvent(event) : false })
}
