import assert from 'node:assert/strict'
import test from 'node:test'

import { NostrToolsRelayTransport } from '@/features/graph/nostr/relay-transport'

class FakeRelay {
  public readonly url: string
  public readonly ws: { readyState: number; close: () => void }
  public onnotice?: (message: string) => void
  public onclose?: () => void
  public closeCalls = 0
  public connectCalls = 0

  public constructor(
    url: string,
    private readonly connectImpl: () => Promise<void> = async () => {},
  ) {
    this.url = url
    this.ws = {
      readyState: 1,
      close: () => {
        this.close()
      },
    }
  }

  public async connect() {
    this.connectCalls += 1
    await this.connectImpl()
  }

  public subscribe() {
    return {
      close: () => {},
    }
  }

  public async count() {
    return 0
  }

  public emitNotice(message: string) {
    this.onnotice?.(message)
  }

  public close() {
    this.closeCalls += 1
    this.ws.readyState = 3
    this.onclose?.()
  }
}

test('shares one underlying relay connection across transport instances', async () => {
  const relays = new Map<string, FakeRelay>()
  let createCount = 0
  const createRelay = (url: string) => {
    createCount += 1
    const relay = new FakeRelay(url)
    relays.set(url, relay)
    return relay
  }

  const transportA = new NostrToolsRelayTransport({ createRelay })
  const transportB = new NostrToolsRelayTransport({ createRelay })

  const connectionA = await transportA.connect('wss://shared.example')
  const connectionB = await transportB.connect('wss://shared.example')
  const relay = relays.get('wss://shared.example')

  assert.ok(relay)
  assert.equal(createCount, 1)

  const receivedNotices: string[] = []
  const disposeNotice = connectionB.onNotice((message) => {
    receivedNotices.push(message)
  })

  relay.emitNotice('hola')
  assert.deepEqual(receivedNotices, ['hola'])

  connectionA.close()
  assert.equal(relay.closeCalls, 0)

  disposeNotice()
  connectionB.close()
  assert.equal(relay.closeCalls, 1)
})

test('clears failed shared connection attempts so a later retry can reconnect', async () => {
  let attempt = 0
  const createRelay = (url: string) => {
    attempt += 1
    return new FakeRelay(url, async () => {
      if (attempt === 1) {
        throw new Error('boom')
      }
    })
  }

  const transport = new NostrToolsRelayTransport({ createRelay })

  await assert.rejects(
    transport.connect('wss://retry.example'),
    /boom/,
  )

  const connection = await transport.connect('wss://retry.example')
  assert.equal(connection.isOpen(), true)
  connection.close()
})
