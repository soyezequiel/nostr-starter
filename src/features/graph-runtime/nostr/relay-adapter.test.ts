import assert from 'node:assert/strict'
import test from 'node:test'

import { createRelayPoolAdapter } from '@/features/graph-runtime/nostr/relay-adapter'
import type {
  RelayConnection,
  RelaySubscribeHandlers,
  RelayTransport,
} from '@/features/graph-runtime/nostr/types'
import type { Event, Filter } from 'nostr-tools'

class FailingTransport implements RelayTransport {
  public connectCalls = 0

  async connect(url: string): Promise<RelayConnection> {
    this.connectCalls += 1
    throw new Error(`cannot connect ${url}`)
  }
}

const createTestEvent = (): Event => ({
  id: 'f'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 1,
  kind: 3,
  tags: [],
  content: '',
  sig: 'b'.repeat(128),
})

class CountUnsupportedConnection implements RelayConnection {
  private readonly noticeListeners = new Set<(message: string) => void>()
  private readonly closeListeners = new Set<() => void>()
  private open = true

  constructor(readonly url: string) {}

  subscribe(
    _filters: Filter[],
    handlers: RelaySubscribeHandlers,
  ) {
    queueMicrotask(() => {
      handlers.onEvent(createTestEvent())
      handlers.onEose()
    })

    return {
      close: () => {},
    }
  }

  async count() {
    for (const listener of this.noticeListeners) {
      listener('ERROR: bad msg: unknown cmd')
    }
    throw new Error('Timed out while waiting for relay COUNT.')
  }

  onNotice(listener: (message: string) => void) {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  isOpen() {
    return this.open
  }

  close() {
    this.open = false
    for (const listener of this.closeListeners) {
      listener()
    }
  }
}

class CountUnsupportedTransport implements RelayTransport {
  public connectCalls = 0

  async connect(url: string): Promise<RelayConnection> {
    this.connectCalls += 1
    const connection = new CountUnsupportedConnection(url)
    return connection
  }
}

test('shares circuit breaker state across adapter instances', async () => {
  const transport = new FailingTransport()
  const adapterA = createRelayPoolAdapter({
    relayUrls: ['wss://relay.damus.io'],
    retryCount: 0,
    transport,
  })
  const adapterB = createRelayPoolAdapter({
    relayUrls: ['wss://relay.damus.io'],
    retryCount: 0,
    transport,
  })

  const first = await adapterA.count([{ authors: ['a'], kinds: [3] }])
  const second = await adapterB.count([{ authors: ['a'], kinds: [3] }])

  assert.equal(transport.connectCalls, 1)
  assert.equal(first[0]?.relayUrl, 'wss://relay.damus.io')
  assert.match(second[0]?.errorMessage ?? '', /temporarily skipped due to offline status/i)
})

test('skips subscription attempts for relays recently marked offline', async () => {
  const relayUrl = 'wss://relay-subscription.example'
  const transport = new FailingTransport()
  const adapterA = createRelayPoolAdapter({
    relayUrls: [relayUrl],
    retryCount: 0,
    transport,
  })

  const firstOutcome = await new Promise<string>((resolve) => {
    adapterA.subscribe([{ authors: ['a'], kinds: [3] }]).subscribe({
      error: (error) => resolve(error.message),
      complete: () => resolve('complete'),
    })
  })

  assert.match(firstOutcome, /cannot connect/)

  const adapterB = createRelayPoolAdapter({
    relayUrls: [relayUrl],
    retryCount: 0,
    transport,
  })

  const secondOutcome = await new Promise<string>((resolve) => {
    adapterB.subscribe([{ authors: ['a'], kinds: [3] }]).subscribe({
      error: (error) => resolve(error.message),
      complete: () => resolve('complete'),
    })
  })

  assert.equal(transport.connectCalls, 1)
  assert.equal(secondOutcome, 'complete')
})

test('COUNT unsupported notices do not circuit-break later subscriptions', async () => {
  const relayUrl = 'wss://relay-count-unsupported.example'
  const transport = new CountUnsupportedTransport()
  const adapterA = createRelayPoolAdapter({
    relayUrls: [relayUrl],
    retryCount: 0,
    transport,
  })

  const countResults = await adapterA.count([{ authors: ['a'], kinds: [3] }])
  assert.equal(countResults[0]?.supported, false)
  assert.match(countResults[0]?.errorMessage ?? '', /COUNT/i)

  const adapterB = createRelayPoolAdapter({
    relayUrls: [relayUrl],
    retryCount: 0,
    transport,
  })

  const outcome = await new Promise<{ status: string; events: number }>((resolve) => {
    let events = 0
    adapterB
      .subscribe([{ authors: ['a'], kinds: [3] }], {
        verificationMode: 'trusted-relay',
      })
      .subscribe({
        next: () => {
          events += 1
        },
        error: (error) => resolve({ status: error.message, events }),
        complete: () => resolve({ status: 'complete', events }),
      })
  })

  assert.equal(outcome.status, 'complete')
  assert.equal(outcome.events, 1)
  assert.equal(transport.connectCalls, 2)
})
