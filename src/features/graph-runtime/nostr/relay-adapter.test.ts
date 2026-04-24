import assert from 'node:assert/strict'
import test from 'node:test'

import { createRelayPoolAdapter } from '@/features/graph-runtime/nostr/relay-adapter'
import { globalVerifyPool } from '@/features/graph-runtime/workers/verifyWorkerPool'
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

const createTestEvent = (id = 'f'.repeat(64)): Event => ({
  id,
  pubkey: 'a'.repeat(64),
  created_at: 1,
  kind: 3,
  tags: [],
  content: '',
  sig: 'b'.repeat(128),
})

type VerifyWorkerMessage = {
  id?: string
  event?: Event
  events?: Event[]
}

type VerifyWorkerResponse = {
  id: string
  valid?: boolean
  results?: boolean[]
}

type VerifyMessageListener = (event: MessageEvent<VerifyWorkerResponse>) => void

class FakeVerifyWorker {
  static messages: VerifyWorkerMessage[] = []

  private readonly messageListeners = new Set<VerifyMessageListener>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'message') {
      this.messageListeners.add(listener as VerifyMessageListener)
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'message') {
      this.messageListeners.delete(listener as VerifyMessageListener)
    }
  }

  postMessage(message: VerifyWorkerMessage) {
    FakeVerifyWorker.messages.push(message)
    queueMicrotask(() => {
      const id = typeof message.id === 'string' ? message.id : ''
      const response: VerifyWorkerResponse = Array.isArray(message.events)
        ? { id, results: message.events.map(() => true) }
        : { id, valid: true }

      for (const listener of this.messageListeners) {
        listener({ data: response } as MessageEvent<VerifyWorkerResponse>)
      }
    })
  }

  terminate() {
    return undefined
  }
}

function installFakeVerifyWorkerGlobals() {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  FakeVerifyWorker.messages = []

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: FakeVerifyWorker,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: 1440,
      matchMedia: () => ({ matches: false }),
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      deviceMemory: 8,
      hardwareConcurrency: 8,
    },
  })

  return () => {
    restoreGlobal('Worker', originalWorker)
    restoreGlobal('window', originalWindow)
    restoreGlobal('navigator', originalNavigator)
  }
}

function restoreGlobal(
  key: 'Worker' | 'window' | 'navigator',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor)
    return
  }

  delete (globalThis as Record<string, unknown>)[key]
}

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

class BurstConnection implements RelayConnection {
  private readonly noticeListeners = new Set<(message: string) => void>()
  private readonly closeListeners = new Set<() => void>()
  private open = true

  constructor(readonly url: string) {}

  subscribe(_filters: Filter[], handlers: RelaySubscribeHandlers) {
    queueMicrotask(() => {
      handlers.onEvent(createTestEvent('1'.repeat(64)))
      handlers.onEvent(createTestEvent('2'.repeat(64)))
      handlers.onEose()
    })

    return {
      close: () => {},
    }
  }

  async count() {
    return 0
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

class BurstTransport implements RelayTransport {
  async connect(url: string): Promise<RelayConnection> {
    return new BurstConnection(url)
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
  assert.equal(adapterA.getRelayHealth()[relayUrl]?.status, 'idle')
  assert.equal(
    adapterA.getRelayHealth()[relayUrl]?.lastNotice,
    'COUNT no soportado por este relay',
  )

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

test('verify-worker subscriptions batch relay events before publishing', async () => {
  const restore = installFakeVerifyWorkerGlobals()
  const relayUrl = 'wss://relay-batch-verification.example'
  const adapter = createRelayPoolAdapter({
    relayUrls: [relayUrl],
    retryCount: 0,
    stragglerGraceMs: 0,
    transport: new BurstTransport(),
  })

  try {
    const outcome = await new Promise<{ status: string; events: Event[] }>(
      (resolve) => {
        const events: Event[] = []
        adapter.subscribe([{ kinds: [3] }]).subscribe({
          nextBatch: (batch) => {
            events.push(...batch.map((item) => item.event))
          },
          error: (error) => resolve({ status: error.message, events }),
          complete: () => resolve({ status: 'complete', events }),
        })
      },
    )

    assert.equal(outcome.status, 'complete')
    assert.deepEqual(
      outcome.events.map((event) => event.id),
      ['1'.repeat(64), '2'.repeat(64)],
    )
    assert.equal(FakeVerifyWorker.messages.length, 1)
    assert.equal(FakeVerifyWorker.messages[0]?.events?.length, 2)
  } finally {
    globalVerifyPool.terminate()
    restore()
  }
})
