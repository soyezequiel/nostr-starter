import type { Filter } from 'nostr-tools'
import { isVerifiedEventAsync } from '@/features/graph/workers/verifyWorkerPool'

import { createRelayAdapterError } from './errors'
import { normalizeRelayUrl } from './relay-url'
import { NostrToolsRelayTransport } from './relay-transport'
import type {
  RelayAdapterOptions,
  RelayClock,
  RelayConnection,
  RelayEventObservable,
  RelayHealthSnapshot,
  RelayObserver,
  RelaySubscriptionHandle,
  RelaySubscriptionStats,
} from './types'

const DEFAULT_CONNECT_TIMEOUT_MS = 4_000
const DEFAULT_PAGE_TIMEOUT_MS = 6_000
const DEFAULT_RETRY_COUNT = 1
const DEFAULT_STRAGGLER_GRACE_MS = 250
const DEFAULT_MAX_AUTHORS_PER_FILTER = 50

type TerminalKind = 'eose' | 'timeout' | 'closed' | 'cancelled'

interface ActiveRelayAttempt {
  url: string
  attempt: number
  connection?: RelayConnection
  subscription?: RelaySubscriptionHandle
  pageTimeoutHandle?: ReturnType<typeof setTimeout>
  graceTimeoutHandle?: ReturnType<typeof setTimeout>
  finished: boolean
}

interface ConnectionEntry {
  connectionPromise?: Promise<RelayConnection>
  connection?: RelayConnection
  detachNotice?: () => void
}

export class RelayPoolAdapter {
  private readonly transport
  private readonly clock: RelayClock
  private readonly relayUrls: string[]
  private readonly connectTimeoutMs: number
  private readonly pageTimeoutMs: number
  private readonly retryCount: number
  private readonly stragglerGraceMs: number
  private readonly maxAuthorsPerFilter: number
  private readonly connections = new Map<string, ConnectionEntry>()
  private readonly relayHealth = new Map<string, RelayHealthSnapshot>()
  private readonly healthListeners = new Set<
    (snapshot: Record<string, RelayHealthSnapshot>) => void
  >()

  constructor(options: RelayAdapterOptions) {
    this.transport = options.transport ?? new NostrToolsRelayTransport()
    this.clock = options.clock ?? {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
    }
    this.relayUrls = dedupeRelayUrls(
      options.relayUrls.map((url) =>
        normalizeRelayUrl(url, {
          allowInsecureWs: options.allowInsecureWs,
          allowLocalAddresses: options.allowLocalAddresses,
        }),
      ),
    )
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS
    this.retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT
    this.stragglerGraceMs =
      options.stragglerGraceMs ?? DEFAULT_STRAGGLER_GRACE_MS
    this.maxAuthorsPerFilter =
      options.maxAuthorsPerFilter ?? DEFAULT_MAX_AUTHORS_PER_FILTER

    for (const url of this.relayUrls) {
      this.relayHealth.set(url, {
        url,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: this.clock.now(),
      })
    }
  }

  subscribe(filters: Filter[]): RelayEventObservable {
    const normalizedFilters = batchFilters(filters, this.maxAuthorsPerFilter)

    return {
      subscribe: (observer) => this.runSubscription(normalizedFilters, observer),
    }
  }

  getRelayHealth(): Record<string, RelayHealthSnapshot> {
    return this.snapshotRelayHealth()
  }

  subscribeToRelayHealth(
    listener: (snapshot: Record<string, RelayHealthSnapshot>) => void,
  ): () => void {
    this.healthListeners.add(listener)
    listener(this.snapshotRelayHealth())

    return () => {
      this.healthListeners.delete(listener)
    }
  }

  close(): void {
    for (const url of this.relayUrls) {
      this.evictConnection(url)
      this.updateRelayHealth(url, (current) => ({
        ...current,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        lastCloseReason: undefined,
        lastErrorCode: undefined,
      }))
    }
  }

  private runSubscription(filters: Filter[], observer: RelayObserver): () => void {
    const stats: RelaySubscriptionStats = {
      acceptedEvents: 0,
      duplicateRelayEvents: 0,
      rejectedEvents: 0,
    }
    const startedAtMs = this.clock.now()
    const activeAttempts = new Map<string, ActiveRelayAttempt>()

    // Bounded LRU dedup set. Using Map instead of Set because Map preserves
    // insertion order in V8, giving us O(1) LRU eviction via .keys().next().
    // An unbounded Set would grow indefinitely on noisy relays (tens of MB over time).
    const MAX_SEEN_RELAY_EVENTS = 10_000
    const seenRelayEvents = new Map<string, undefined>()
    const addSeenRelayEvent = (key: string): void => {
      if (seenRelayEvents.size >= MAX_SEEN_RELAY_EVENTS) {
        const oldest = seenRelayEvents.keys().next().value
        if (oldest !== undefined) seenRelayEvents.delete(oldest)
      }
      seenRelayEvents.set(key, undefined)
    }

    let cancelled = false
    let completed = false
    let pendingRelays = this.relayUrls.length

    const finalize = () => {
      if (completed || cancelled || pendingRelays > 0) {
        return
      }

      completed = true
      observer.complete?.({
        filters,
        startedAtMs,
        finishedAtMs: this.clock.now(),
        relayHealth: this.snapshotRelayHealth(),
        stats,
      })
    }

    const finishRelay = (url: string) => {
      if (!activeAttempts.has(url)) {
        return
      }

      activeAttempts.delete(url)
      pendingRelays -= 1
      finalize()
    }

    const settleRelay = (
      attempt: ActiveRelayAttempt,
      terminalKind: TerminalKind,
      reason?: string,
    ) => {
      if (attempt.finished) {
        return
      }

      if (attempt.pageTimeoutHandle) {
        this.clock.clearTimeout(attempt.pageTimeoutHandle)
      }
      if (attempt.graceTimeoutHandle) {
        this.clock.clearTimeout(attempt.graceTimeoutHandle)
      }

      attempt.finished = true
      this.decrementActiveSubscriptions(attempt.url)

      if (cancelled) {
        finishRelay(attempt.url)
        return
      }

      const retryable = terminalKind === 'timeout' || terminalKind === 'closed'
      const shouldRetry = retryable && attempt.attempt <= this.retryCount

      if (terminalKind === 'eose') {
        this.updateRelayHealth(attempt.url, (current) => ({
          ...current,
          status: 'healthy',
          lastCloseReason: 'eose',
          lastEoseMs: this.clock.now(),
          lastErrorCode: undefined,
          consecutiveFailures: 0,
        }))
      } else if (terminalKind === 'cancelled') {
        this.updateRelayHealth(attempt.url, (current) => ({
          ...current,
          lastCloseReason: 'cancelled',
          lastErrorCode: 'RELAY_CANCELLED',
        }))
      } else if (terminalKind === 'timeout') {
        this.updateRelayHealth(attempt.url, (current) => ({
          ...current,
          status: shouldRetry ? 'degraded' : current.status,
          consecutiveFailures: current.consecutiveFailures + 1,
          lastCloseReason: 'timeout',
          lastErrorCode: 'RELAY_PAGE_TIMEOUT',
        }))
      } else {
        this.updateRelayHealth(attempt.url, (current) => ({
          ...current,
          status: shouldRetry ? 'degraded' : current.status,
          consecutiveFailures: current.consecutiveFailures + 1,
          lastCloseReason: reason ?? 'closed',
          lastErrorCode: 'RELAY_SUBSCRIPTION_CLOSED',
        }))
      }

      if (shouldRetry) {
        this.evictConnection(attempt.url)
        void startRelay(attempt.url, attempt.attempt + 1)
        return
      }

      if (terminalKind === 'timeout' || terminalKind === 'closed') {
        this.updateRelayHealth(attempt.url, (current) => ({
          ...current,
          status: current.lastEventMs ? 'degraded' : 'offline',
        }))
      }

      finishRelay(attempt.url)
    }

    const startRelay = async (url: string, attemptNumber: number) => {
      const activeAttempt: ActiveRelayAttempt = {
        url,
        attempt: attemptNumber,
        finished: false,
      }
      activeAttempts.set(url, activeAttempt)

      this.updateRelayHealth(url, (current) => ({
        ...current,
        status: current.status === 'degraded' ? 'degraded' : 'connecting',
        attempt: attemptNumber,
      }))

      let connection: RelayConnection

      try {
        connection = await this.withTimeout(
          this.getOrCreateConnection(url),
          this.connectTimeoutMs,
          () =>
            createRelayAdapterError({
              code: 'RELAY_CONNECT_TIMEOUT',
              message: 'Timed out while connecting to relay.',
              relayUrl: url,
              retryable: true,
              details: { attempt: attemptNumber },
            }),
        )
      } catch (error) {
        const relayError =
          error instanceof Error
            ? error
            : createRelayAdapterError({
                code: 'RELAY_CONNECT_FAILED',
                message: 'Relay connection failed.',
                relayUrl: url,
                retryable: true,
                details: { attempt: attemptNumber },
              })

        this.updateRelayHealth(url, (current) => ({
          ...current,
          status: attemptNumber <= this.retryCount ? 'degraded' : 'offline',
          attempt: attemptNumber,
          consecutiveFailures: current.consecutiveFailures + 1,
          lastErrorCode:
            relayError instanceof Error && 'code' in relayError
              ? (relayError.code as RelayHealthSnapshot['lastErrorCode'])
              : 'RELAY_CONNECT_FAILED',
          lastCloseReason: relayError.message,
        }))

        if (attemptNumber <= this.retryCount && !cancelled) {
          this.evictConnection(url)
          void startRelay(url, attemptNumber + 1)
          return
        }

        this.evictConnection(url)

        const shouldEmitError =
          !completed &&
          !cancelled &&
          stats.acceptedEvents === 0 &&
          pendingRelays === 1

        if (shouldEmitError) {
          completed = true
          observer.error?.(relayError)
        }

        finishRelay(url)

        return
      }

      if (cancelled) {
        finishRelay(url)
        return
      }

      activeAttempt.connection = connection
      this.incrementActiveSubscriptions(url, attemptNumber)

      activeAttempt.pageTimeoutHandle = this.clock.setTimeout(() => {
        settleRelay(activeAttempt, 'timeout')
        activeAttempt.subscription?.close('timeout')
      }, this.pageTimeoutMs)

      activeAttempt.subscription = connection.subscribe(filters, {
        onEvent: async (event) => {
          if (cancelled || activeAttempt.finished) {
            return
          }

          const relayEventKey = `${url}:${event.id}`

          if (seenRelayEvents.has(relayEventKey)) {
            stats.duplicateRelayEvents += 1
            return
          }

          addSeenRelayEvent(relayEventKey)

          const isValid = await isVerifiedEventAsync(event)

          // After await, we must re-check if the subscription was closed
          if (cancelled || activeAttempt.finished) {
            return
          }

          if (!isValid) {
            stats.rejectedEvents += 1
            this.updateRelayHealth(url, (current) => ({
              ...current,
              lastErrorCode: 'RELAY_EVENT_INVALID',
            }))
            return
          }

          stats.acceptedEvents += 1
          this.updateRelayHealth(url, (current) => ({
            ...current,
            status: 'healthy',
            consecutiveFailures: 0,
            lastErrorCode: undefined,
            lastEventMs: this.clock.now(),
          }))
          observer.next?.({
            event,
            relayUrl: url,
            receivedAtMs: this.clock.now(),
            attempt: attemptNumber,
          })
        },
        onEose: () => {
          if (cancelled || activeAttempt.finished) {
            return
          }

          this.updateRelayHealth(url, (current) => ({
            ...current,
            status: 'healthy',
            lastEoseMs: this.clock.now(),
            consecutiveFailures: 0,
            lastErrorCode: undefined,
          }))

          activeAttempt.graceTimeoutHandle = this.clock.setTimeout(() => {
            settleRelay(activeAttempt, 'eose')
            activeAttempt.subscription?.close('eose')
          }, this.stragglerGraceMs)
        },
        onClose: (reason) => {
          if (cancelled || activeAttempt.finished) {
            return
          }

          settleRelay(activeAttempt, 'closed', reason)
        },
      })
    }

    if (this.relayUrls.length === 0) {
      observer.complete?.({
        filters,
        startedAtMs,
        finishedAtMs: this.clock.now(),
        relayHealth: {},
        stats,
      })
      return () => {}
    }

    for (const url of this.relayUrls) {
      void startRelay(url, 1)
    }

    return () => {
      if (cancelled) {
        return
      }

      cancelled = true

      for (const attempt of activeAttempts.values()) {
        if (attempt.pageTimeoutHandle) {
          this.clock.clearTimeout(attempt.pageTimeoutHandle)
        }
        if (attempt.graceTimeoutHandle) {
          this.clock.clearTimeout(attempt.graceTimeoutHandle)
        }
        attempt.finished = true
        this.decrementActiveSubscriptions(attempt.url)
        attempt.subscription?.close('cancelled')
      }

      activeAttempts.clear()
    }
  }

  private async getOrCreateConnection(url: string): Promise<RelayConnection> {
    const existing = this.connections.get(url)

    if (existing?.connection) {
      return existing.connection
    }

    if (existing?.connectionPromise) {
      return existing.connectionPromise
    }

    const connectionEntry: ConnectionEntry = {}
    const promise = this.transport.connect(url).then((connection) => {
      connectionEntry.connection = connection
      connectionEntry.connectionPromise = undefined
      connectionEntry.detachNotice = connection.onNotice((message) => {
        this.updateRelayHealth(url, (current) => ({
          ...current,
          lastNotice: message,
        }))
      })
      return connection
    })

    connectionEntry.connectionPromise = promise
    this.connections.set(url, connectionEntry)

    return promise
  }

  private evictConnection(url: string): void {
    const existing = this.connections.get(url)

    if (!existing) {
      return
    }

    existing.detachNotice?.()
    existing.connection?.close()
    this.connections.delete(url)
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    buildError: () => Error,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handle = this.clock.setTimeout(() => {
        reject(buildError())
      }, timeoutMs)

      promise.then(
        (value) => {
          this.clock.clearTimeout(handle)
          resolve(value)
        },
        (error) => {
          this.clock.clearTimeout(handle)
          reject(error)
        },
      )
    })
  }

  private incrementActiveSubscriptions(url: string, attempt: number): void {
    this.updateRelayHealth(url, (current) => ({
      ...current,
      status: 'healthy',
      attempt,
      activeSubscriptions: current.activeSubscriptions + 1,
      consecutiveFailures: 0,
      lastErrorCode: undefined,
    }))
  }

  private decrementActiveSubscriptions(url: string): void {
    this.updateRelayHealth(url, (current) => ({
      ...current,
      activeSubscriptions: Math.max(0, current.activeSubscriptions - 1),
    }))
  }

  private updateRelayHealth(
    url: string,
    updater: (current: RelayHealthSnapshot) => RelayHealthSnapshot,
  ): void {
    const current =
      this.relayHealth.get(url) ??
      ({
        url,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: this.clock.now(),
      } satisfies RelayHealthSnapshot)

    const next = {
      ...updater(current),
      lastChangeMs: this.clock.now(),
    }

    this.relayHealth.set(url, next)
    this.publishHealth()
  }

  private snapshotRelayHealth(): Record<string, RelayHealthSnapshot> {
    return Object.fromEntries(
      [...this.relayHealth.entries()].map(([url, snapshot]) => [
        url,
        { ...snapshot },
      ]),
    )
  }

  private publishHealth(): void {
    const snapshot = this.snapshotRelayHealth()

    for (const listener of this.healthListeners) {
      listener(snapshot)
    }
  }
}

export function createRelayPoolAdapter(
  options: RelayAdapterOptions,
): RelayPoolAdapter {
  return new RelayPoolAdapter(options)
}

function dedupeRelayUrls(relayUrls: string[]): string[] {
  return [...new Set(relayUrls)]
}

function batchFilters(filters: Filter[], maxAuthorsPerFilter: number): Filter[] {
  const batched: Filter[] = []

  for (const filter of filters) {
    if (!filter.authors || filter.authors.length <= maxAuthorsPerFilter) {
      batched.push({ ...filter })
      continue
    }

    for (let index = 0; index < filter.authors.length; index += maxAuthorsPerFilter) {
      batched.push({
        ...filter,
        authors: filter.authors.slice(index, index + maxAuthorsPerFilter),
      })
    }
  }

  return batched
}
