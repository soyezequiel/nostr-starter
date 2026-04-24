import assert from 'node:assert/strict'
import test from 'node:test'

import type { Event } from 'nostr-tools'

import { VerifyWorkerPool } from './verifyWorkerPool'

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

type MessageListener = (event: MessageEvent<VerifyWorkerResponse>) => void

const createEvent = (kind: number): Event => ({
  id: `${kind}`.padStart(64, 'a').slice(0, 64),
  pubkey: 'b'.repeat(64),
  created_at: 1,
  kind,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
})

class FakeVerifyWorker {
  static instances: FakeVerifyWorker[] = []

  public readonly messages: VerifyWorkerMessage[] = []
  private readonly messageListeners = new Set<MessageListener>()

  constructor() {
    FakeVerifyWorker.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== 'message') {
      return
    }

    this.messageListeners.add(listener as MessageListener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== 'message') {
      return
    }

    this.messageListeners.delete(listener as MessageListener)
  }

  postMessage(message: VerifyWorkerMessage) {
    this.messages.push(message)

    queueMicrotask(() => {
      const id = typeof message.id === 'string' ? message.id : ''
      const response: VerifyWorkerResponse = Array.isArray(message.events)
        ? {
            id,
            results: message.events.map((event) => event.kind === 3),
          }
        : {
            id,
            valid: message.event?.kind === 3,
          }

      for (const listener of this.messageListeners) {
        listener({ data: response } as MessageEvent<VerifyWorkerResponse>)
      }
    })
  }

  terminate() {
    return undefined
  }
}

function installFakeBrowserGlobals() {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  FakeVerifyWorker.instances = []

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

test('VerifyWorkerPool sends batch verification in one worker message', async () => {
  const restore = installFakeBrowserGlobals()
  const pool = new VerifyWorkerPool()

  try {
    const results = await pool.verifyMany([
      createEvent(3),
      createEvent(0),
      createEvent(3),
    ])

    assert.deepEqual(results, [true, false, true])
    assert.equal(FakeVerifyWorker.instances.length, 2)
    assert.equal(FakeVerifyWorker.instances[0]?.messages.length, 1)
    assert.deepEqual(
      FakeVerifyWorker.instances[0]?.messages[0]?.events?.map(
        (event) => event.kind,
      ),
      [3, 0, 3],
    )
  } finally {
    pool.terminate()
    restore()
  }
})
