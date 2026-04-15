import { Relay, type Filter } from 'nostr-tools'

import type {
  RelayConnection,
  RelayCountRequestOptions,
  RelaySubscribeHandlers,
  RelaySubscriptionHandle,
  RelayTransport,
} from './types'

interface RelayLike {
  url: string
  connect: () => Promise<void>
  subscribe: (
    filters: Filter[],
    handlers: {
      onevent: RelaySubscribeHandlers['onEvent']
      oneose: RelaySubscribeHandlers['onEose']
      onclose: RelaySubscribeHandlers['onClose']
    },
  ) => {
    close: (reason?: string) => void
  }
  count: (
    filters: Filter[],
    options?: RelayCountRequestOptions,
  ) => Promise<number>
  onnotice?: (message: string) => void
  onclose?: () => void
  ws?: WebSocket | { readyState?: number; close?: () => void }
  skipReconnection?: boolean
}

type RelayFactory = (url: string) => RelayLike

interface SharedConnectionEntry {
  connectionPromise?: Promise<NostrToolsRelayConnection>
  connection?: NostrToolsRelayConnection
  refCount: number
}

const sharedConnections = new Map<string, SharedConnectionEntry>()

class NostrToolsRelayConnection implements RelayConnection {
  readonly url: string

  private readonly noticeListeners = new Set<(message: string) => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly relay: RelayLike

  constructor(relay: RelayLike) {
    this.relay = relay
    this.url = relay.url
    relay.onnotice = (message) => {
      for (const listener of this.noticeListeners) {
        listener(message)
      }
    }
    relay.onclose = () => {
      for (const listener of this.closeListeners) {
        listener()
      }
    }
  }

  subscribe(
    filters: Filter[],
    handlers: RelaySubscribeHandlers,
  ): RelaySubscriptionHandle {
    if (!this.isOpen()) {
      throw new Error(`Relay ${this.url} is not open.`)
    }

    const subscription = this.relay.subscribe(filters, {
      onevent: handlers.onEvent,
      oneose: handlers.onEose,
      onclose: handlers.onClose,
    })

    let closed = false

    return {
      close: (reason?: string) => {
        if (closed || !this.isOpen()) {
          closed = true
          return
        }

        closed = true
        subscription.close(reason)
      },
    }
  }

  async count(
    filters: Filter[],
    options: RelayCountRequestOptions = {},
  ): Promise<number> {
    if (!this.isOpen()) {
      throw new Error(`Relay ${this.url} is not open.`)
    }

    return this.relay.count(filters, options)
  }

  onNotice(listener: (message: string) => void): () => void {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  isOpen(): boolean {
    return this.getReadyState() === this.getOpenReadyState()
  }

  private getReadyState(): number | undefined {
    return this.relay.ws?.readyState
  }

  private getNativeSocket():
    | WebSocket
    | { readyState?: number; close?: () => void }
    | undefined {
    return this.relay.ws
  }

  private getOpenReadyState(): number {
    return typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
  }

  close(): void {
    const socket = this.getNativeSocket()
    const openReadyState = this.getOpenReadyState()
    const connectingReadyState =
      typeof WebSocket !== 'undefined' ? WebSocket.CONNECTING : 0

    if (
      !socket ||
      (socket.readyState !== openReadyState &&
        socket.readyState !== connectingReadyState)
    ) {
      return
    }

    this.relay.skipReconnection = true
    socket.close?.()
  }
}

class SharedRelayConsumerConnection implements RelayConnection {
  readonly url: string

  private readonly noticeListeners = new Set<(message: string) => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly detachNotice: () => void
  private readonly detachClose: () => void
  private closed = false

  constructor(
    private readonly connection: NostrToolsRelayConnection,
    private readonly release: () => void,
  ) {
    this.url = connection.url
    this.detachNotice = connection.onNotice((message) => {
      for (const listener of this.noticeListeners) {
        listener(message)
      }
    })
    this.detachClose = connection.onClose(() => {
      for (const listener of this.closeListeners) {
        listener()
      }
    })
  }

  subscribe(
    filters: Filter[],
    handlers: RelaySubscribeHandlers,
  ): RelaySubscriptionHandle {
    return this.connection.subscribe(filters, handlers)
  }

  count(
    filters: Filter[],
    options?: RelayCountRequestOptions,
  ): Promise<number> {
    return this.connection.count(filters, options)
  }

  onNotice(listener: (message: string) => void): () => void {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  isOpen(): boolean {
    return this.connection.isOpen()
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.detachNotice()
    this.detachClose()
    this.release()
  }
}

export class NostrToolsRelayTransport implements RelayTransport {
  private readonly createRelay: RelayFactory

  constructor(options: { createRelay?: RelayFactory } = {}) {
    this.createRelay =
      options.createRelay ??
      ((url: string) => new Relay(url) as unknown as RelayLike)
  }

  async connect(url: string): Promise<RelayConnection> {
    const existing = sharedConnections.get(url)

    if (existing?.connection) {
      return this.attachConsumer(url, existing, existing.connection)
    }

    if (existing?.connectionPromise) {
      const connection = await existing.connectionPromise
      return this.attachConsumer(url, existing, connection)
    }

    const connectionEntry: SharedConnectionEntry = { refCount: 0 }
    const connectionPromise = this.createSharedConnection(url, connectionEntry)
    connectionEntry.connectionPromise = connectionPromise
    sharedConnections.set(url, connectionEntry)

    const connection = await connectionPromise
    return this.attachConsumer(url, connectionEntry, connection)
  }

  private attachConsumer(
    url: string,
    entry: SharedConnectionEntry,
    connection: NostrToolsRelayConnection,
  ): RelayConnection {
    entry.refCount += 1
    let released = false

    return new SharedRelayConsumerConnection(connection, () => {
      if (released) {
        return
      }

      released = true
      entry.refCount = Math.max(0, entry.refCount - 1)

      if (entry.refCount === 0) {
        if (sharedConnections.get(url) === entry) {
          sharedConnections.delete(url)
        }
        connection.close()
      }
    })
  }

  private async createSharedConnection(
    url: string,
    entry: SharedConnectionEntry,
  ): Promise<NostrToolsRelayConnection> {
    try {
      const relay = this.createRelay(url)
      await relay.connect()
      const connection = new NostrToolsRelayConnection(relay)
      connection.onClose(() => {
        if (sharedConnections.get(url) === entry) {
          sharedConnections.delete(url)
        }
      })
      entry.connection = connection
      entry.connectionPromise = undefined
      return connection
    } catch (error) {
      if (sharedConnections.get(url) === entry) {
        sharedConnections.delete(url)
      }
      entry.connectionPromise = undefined
      throw error
    }
  }
}
