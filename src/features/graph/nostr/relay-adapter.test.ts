import assert from 'node:assert/strict'
import test from 'node:test'

import { createRelayPoolAdapter } from '@/features/graph/nostr/relay-adapter'
import type {
  RelayConnection,
  RelayTransport,
} from '@/features/graph/nostr/types'

class FailingTransport implements RelayTransport {
  public connectCalls = 0

  async connect(url: string): Promise<RelayConnection> {
    this.connectCalls += 1
    throw new Error(`cannot connect ${url}`)
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
