import { Relay, type Filter } from 'nostr-tools'

import type {
  RelayConnection,
  RelaySubscribeHandlers,
  RelaySubscriptionHandle,
  RelayTransport,
} from './types'

class NostrToolsRelayConnection implements RelayConnection {
  readonly url: string

  private readonly noticeListeners = new Set<(message: string) => void>()
  private readonly relay: Relay

  constructor(relay: Relay) {
    this.relay = relay
    this.url = relay.url
    relay.onnotice = (message) => {
      for (const listener of this.noticeListeners) {
        listener(message)
      }
    }
  }

  subscribe(
    filters: Filter[],
    handlers: RelaySubscribeHandlers,
  ): RelaySubscriptionHandle {
    const subscription = this.relay.subscribe(filters, {
      onevent: handlers.onEvent,
      oneose: handlers.onEose,
      onclose: handlers.onClose,
    })

    return {
      close: (reason?: string) => {
        subscription.close(reason)
      },
    }
  }

  onNotice(listener: (message: string) => void): () => void {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  close(): void {
    this.relay.close()
  }
}

export class NostrToolsRelayTransport implements RelayTransport {
  async connect(url: string): Promise<RelayConnection> {
    const relay = new Relay(url)
    await relay.connect()
    return new NostrToolsRelayConnection(relay)
  }
}
