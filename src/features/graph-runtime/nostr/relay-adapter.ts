import type { Filter } from 'nostr-tools'
import { isVerifiedEventAsync } from '@/features/graph-runtime/workers/verifyWorkerPool'

import { createRelayAdapterError } from './errors'
import { normalizeRelayUrl } from './relay-url'
import { NostrToolsRelayTransport } from './relay-transport'
import type {
  RelayAdapterOptions,
  RelayClock,
  RelayConnection,
  RelayCountOptions,
  RelayCountResult,
  RelayEventEnvelope,
  RelayEventObservable,
  RelayHealthSnapshot,
  RelayObserver,
  RelaySubscribeOptions,
  RelaySubscriptionHandle,
  RelaySubscriptionPriority,
  RelaySubscriptionStats,
  RelayVerificationMode,
} from './types'

const DEFAULT_CONNECT_TIMEOUT_MS = 4_000
const DEFAULT_PAGE_TIMEOUT_MS = 6_000
const DEFAULT_RETRY_COUNT = 1
const DEFAULT_STRAGGLER_GRACE_MS = 250
const DEFAULT_MAX_AUTHORS_PER_FILTER = 50
const INTERACTIVE_FLUSH_DELAY_MS = 32
// PERF: background subs do not need tight flush; this reduces microtask churn.
const BACKGROUND_FLUSH_DELAY_MS = 120
const HEALTH_PUBLISH_DELAY_MS = 100

const COUNT_UNSUPPORTED_PATTERNS = [
  'unknown cmd',
  'unsupported',
  'does not support nip-45',
  'count not supported',
  'count unsupported',
]

const sharedRelayHealth = new Map<string, RelayHealthSnapshot>()
const sharedHealthListeners = new Set<() => void>()
let sharedHealthPublishHandle: ReturnType<typeof setTimeout> | null = null

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
  detachClose?: () => void
}

const isCountUnsupportedFailure = (
  errorMessage: string | null | undefined,
  lastNotice: string | null | undefined,
) => {
  const text = `${errorMessage ?? ''} ${lastNotice ?? ''}`.toLowerCase()
  return COUNT_UNSUPPORTED_PATTERNS.some((pattern) => text.includes(pattern))
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
      ensureSharedRelayHealth(url, this.clock.now())
    }
  }

  subscribe(
    filters: Filter[],
    options: RelaySubscribeOptions = {},
  ): RelayEventObservable {
    const normalizedFilters = batchFilters(filters, this.maxAuthorsPerFilter)

    return {
      subscribe: (observer) =>
        this.runSubscription(normalizedFilters, observer, options),
    }
  }

  async count(
    filters: Filter[],
    options: RelayCountOptions = {},
  ): Promise<RelayCountResult[]> {
    const normalizedFilters = batchFilters(filters, this.maxAuthorsPerFilter)
    const activeRelayUrls = this.selectRelayUrls(options.relayUrls)

    return Promise.all(
      activeRelayUrls.map((url, index) =>
        this.countRelay(url, normalizedFilters, {
          timeoutMs: options.timeoutMs ?? this.pageTimeoutMs,
          id: `${options.idPrefix ?? 'count'}:${index + 1}`,
        }),
      ),
    )
  }

  getRelayHealth(): Record<string, RelayHealthSnapshot> {
    return this.snapshotRelayHealth()
  }

  subscribeToRelayHealth(
    listener: (snapshot: Record<string, RelayHealthSnapshot>) => void,
  ): () => void {
    listener(this.snapshotRelayHealth())
    const wrappedListener = () => {
      listener(this.snapshotRelayHealth())
    }
    sharedHealthListeners.add(wrappedListener)

    return () => {
      sharedHealthListeners.delete(wrappedListener)
    }
  }

  close(): void {
    for (const url of this.relayUrls) {
      this.evictConnection(url)
    }
  }

  private async countRelay(
    url: string,
    filters: Filter[],
    options: { timeoutMs: number; id: string },
  ): Promise<RelayCountResult> {
    const startedAtMs = this.clock.now()
    const health = sharedRelayHealth.get(url)

    // Circuit breaker: stop hammering relays that have recently failed.
    if (health) {
      const timeSinceChange = this.clock.now() - health.lastChangeMs
      if (health.status === 'offline' && timeSinceChange < 60_000) {
        return {
          relayUrl: url,
          count: null,
          supported: false,
          elapsedMs: 0,
          errorMessage: 'Relay is temporarily skipped due to offline status.',
        }
      }
      if (health.status === 'degraded' && timeSinceChange < 5_000) {
        return {
          relayUrl: url,
          count: null,
          supported: false,
          elapsedMs: 0,
          errorMessage: 'Relay is temporarily skipped due to degraded status.',
        }
      }
    }

    let connection: RelayConnection

    try {
      this.updateRelayHealth(url, (current) => ({
        ...current,
        status:
          current.status === 'healthy' || current.status === 'degraded'
            ? current.status
            : 'connecting',
      }))
      connection = await this.withTimeout(
        this.getOrCreateConnection(url),
        this.connectTimeoutMs,
        () =>
          createRelayAdapterError({
            code: 'RELAY_CONNECT_TIMEOUT',
            message: 'Timed out while connecting to relay for COUNT.',
            relayUrl: url,
            retryable: true,
          }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'COUNT connect failed.'
      this.updateRelayHealth(url, (current) => ({
        ...current,
        status: 'offline',
        consecutiveFailures: current.consecutiveFailures + 1,
        lastCloseReason: message,
        lastErrorCode: 'RELAY_CONNECT_FAILED',
      }))

      return {
        relayUrl: url,
        count: null,
        supported: false,
        elapsedMs: this.clock.now() - startedAtMs,
        errorMessage: message,
      }
    }

    try {
      const count = await this.withTimeout(
        connection.count(filters, { id: options.id }),
        options.timeoutMs,
        () =>
          createRelayAdapterError({
            code: 'RELAY_PAGE_TIMEOUT',
            message: 'Timed out while waiting for relay COUNT.',
            relayUrl: url,
            retryable: true,
          }),
      )
      this.updateRelayHealth(url, (current) => ({
        ...current,
        status: 'healthy',
        consecutiveFailures: 0,
        lastErrorCode: undefined,
        lastEventMs: this.clock.now(),
      }))

      return {
        relayUrl: url,
        count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null,
        supported: Number.isFinite(count),
        elapsedMs: this.clock.now() - startedAtMs,
        errorMessage: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'COUNT failed.'
      this.updateRelayHealth(url, (current) => {
        const countUnsupported = isCountUnsupportedFailure(
          message,
          current.lastNotice,
        )

        if (countUnsupported) {
          return {
            ...current,
            status: current.status === 'connecting' ? 'idle' : current.status,
            lastCloseReason: message,
          }
        }

        return {
          ...current,
          status: current.status === 'connecting' ? 'idle' : current.status,
          consecutiveFailures: current.consecutiveFailures + 1,
          lastCloseReason: message,
          lastErrorCode: 'RELAY_PAGE_TIMEOUT',
        }
      })
      if (!connection.isOpen()) {
        this.evictConnection(url)
      }

      return {
        relayUrl: url,
        count: null,
        supported: false,
        elapsedMs: this.clock.now() - startedAtMs,
        errorMessage: message,
      }
    }
  }

  private runSubscription(
    filters: Filter[],
    observer: RelayObserver,
    options: RelaySubscribeOptions,
  ): () => void {
    const stats: RelaySubscriptionStats = {
      acceptedEvents: 0,
      duplicateRelayEvents: 0,
      rejectedEvents: 0,
    }
    const startedAtMs = this.clock.now()
    const activeAttempts = new Map<string, ActiveRelayAttempt>()
    const activeRelayUrls = this.selectRelayUrls(options.relayUrls)
    const priority: RelaySubscriptionPriority =
      options.priority ?? 'interactive'
    const verificationMode: RelayVerificationMode =
      options.verificationMode ?? 'verify-worker'
    const flushDelayMs =
      priority === 'background'
        ? BACKGROUND_FLUSH_DELAY_MS
        : INTERACTIVE_FLUSH_DELAY_MS
    const pendingEvents: RelayEventEnvelope[] = []
    let flushHandle: ReturnType<typeof setTimeout> | null = null

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
    let pendingRelays = activeRelayUrls.length
    let pendingVerifications = 0

    const flushPendingEvents = () => {
      if (flushHandle !== null) {
        this.clock.clearTimeout(flushHandle)
        flushHandle = null
      }

      if (pendingEvents.length === 0 || cancelled || completed) {
        return
      }

      const nextBatch = pendingEvents.splice(0, pendingEvents.length)
      observer.nextBatch?.(nextBatch)

      if (!observer.nextBatch) {
        for (const envelope of nextBatch) {
          observer.next?.(envelope)
        }
      }
    }

    const scheduleFlush = () => {
      if (flushHandle !== null) {
        return
      }

      flushHandle = this.clock.setTimeout(() => {
        flushHandle = null
        flushPendingEvents()
      }, flushDelayMs)
    }

    const finalize = () => {
      if (
        completed ||
        cancelled ||
        pendingRelays > 0 ||
        pendingVerifications > 0
      ) {
        return
      }

      flushPendingEvents()
      completed = true
      observer.complete?.({
        filters,
        startedAtMs,
        finishedAtMs: this.clock.now(),
        relayHealth: this.snapshotRelayHealth(),
        stats,
      })
    }

    const finishRelay = (
      url: string,
      options: { requireActiveAttempt?: boolean } = {},
    ) => {
      const hadActiveAttempt = activeAttempts.delete(url)
      if (!hadActiveAttempt && options.requireActiveAttempt !== false) {
        return
      }

      pendingRelays = Math.max(0, pendingRelays - 1)
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

      if (
        (sharedRelayHealth.get(attempt.url)?.activeSubscriptions ?? 0) === 0
      ) {
        this.evictConnection(attempt.url)
      }

      finishRelay(attempt.url)
    }

    const startRelay = async (url: string, attemptNumber: number) => {
      const health = sharedRelayHealth.get(url)
      if (health) {
        const timeSinceChange = this.clock.now() - health.lastChangeMs
        // Circuit breaker: hold off retrying dead relays for 60s
        if (health.status === 'offline' && timeSinceChange < 60_000) {
          finishRelay(url, { requireActiveAttempt: false })
          return
        }
        // Circuit breaker: prevent new subscriptions from hammering a degraded relay
        if (attemptNumber === 1 && health.status === 'degraded' && timeSinceChange < 5_000) {
          finishRelay(url, { requireActiveAttempt: false })
          return
        }
      }

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
          await new Promise<void>((resolve) =>
            this.clock.setTimeout(resolve, 500 * attemptNumber),
          )
          if (!cancelled) {
            void startRelay(url, attemptNumber + 1)
          }
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

      try {
        activeAttempt.subscription = connection.subscribe(filters, {
          // PERF: keep the trusted-relay path non-async for callers that
          // explicitly opt into relay-side verification.
          onEvent: (event) => {
            if (cancelled || activeAttempt.finished) {
              return
            }

            const relayEventKey = `${url}:${event.id}`

            if (seenRelayEvents.has(relayEventKey)) {
              stats.duplicateRelayEvents += 1
              return
            }

            addSeenRelayEvent(relayEventKey)

            if (verificationMode === 'verify-worker') {
              // Async path only allocated when verification is required
              pendingVerifications += 1
              void isVerifiedEventAsync(event)
                .then((isValid) => {
                  if (cancelled || completed) {
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
                  this.acceptRelayEvent(url)
                  pendingEvents.push({
                    event,
                    relayUrl: url,
                    receivedAtMs: this.clock.now(),
                    attempt: attemptNumber,
                  })
                  scheduleFlush()
                })
                .catch(() => {
                  if (cancelled || completed) {
                    return
                  }

                  stats.rejectedEvents += 1
                  this.updateRelayHealth(url, (current) => ({
                    ...current,
                    lastErrorCode: 'RELAY_EVENT_INVALID',
                  }))
                })
                .finally(() => {
                  pendingVerifications = Math.max(0, pendingVerifications - 1)
                  finalize()
                })
              return
            }

            stats.acceptedEvents += 1
            // PERF: skip snapshot allocation when already healthy to avoid a
            // new object per relay event on the hot path.
            this.acceptRelayEvent(url)
            pendingEvents.push({
              event,
              relayUrl: url,
              receivedAtMs: this.clock.now(),
              attempt: attemptNumber,
            })
            scheduleFlush()
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
      } catch (error) {
        const relayError =
          error instanceof Error
            ? error
            : createRelayAdapterError({
                code: 'RELAY_SUBSCRIPTION_CLOSED',
                message: 'Relay subscription failed during startup.',
                relayUrl: url,
                retryable: true,
                details: { attempt: attemptNumber },
              })

        this.updateRelayHealth(url, (current) => ({
          ...current,
          status: attemptNumber <= this.retryCount ? 'degraded' : 'offline',
          attempt: attemptNumber,
            consecutiveFailures: current.consecutiveFailures + 1,
            lastErrorCode: 'RELAY_SUBSCRIPTION_CLOSED',
            lastCloseReason: relayError.message,
          }))

        if (attemptNumber <= this.retryCount && !cancelled) {
          this.evictConnection(url)
          await new Promise<void>((resolve) =>
            this.clock.setTimeout(resolve, 500 * attemptNumber),
          )
          if (!cancelled) {
            void startRelay(url, attemptNumber + 1)
          }
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

      this.incrementActiveSubscriptions(url, attemptNumber)
      activeAttempt.pageTimeoutHandle = this.clock.setTimeout(() => {
        settleRelay(activeAttempt, 'timeout')
        activeAttempt.subscription?.close('timeout')
      }, this.pageTimeoutMs)
    }

    if (activeRelayUrls.length === 0) {
      observer.complete?.({
        filters,
        startedAtMs,
        finishedAtMs: this.clock.now(),
        relayHealth: {},
        stats,
      })
      return () => {}
    }

    for (const url of activeRelayUrls) {
      void startRelay(url, 1)
    }

    return () => {
      if (cancelled) {
        return
      }

      cancelled = true
      flushPendingEvents()

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
      if (flushHandle !== null) {
        this.clock.clearTimeout(flushHandle)
        flushHandle = null
      }
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
      connectionEntry.detachClose = connection.onClose(() => {
        this.dropConnection(url, connectionEntry)
      })
      return connection
    })

    connectionEntry.connectionPromise = promise
    this.connections.set(url, connectionEntry)

    return promise
  }

  private selectRelayUrls(requestedRelayUrls?: readonly string[]): string[] {
    if (requestedRelayUrls === undefined) {
      return this.relayUrls
    }

    if (requestedRelayUrls.length === 0) {
      return []
    }

    const requested = new Set<string>()
    for (const relayUrl of requestedRelayUrls) {
      try {
        requested.add(normalizeRelayUrl(relayUrl))
      } catch {
        continue
      }
    }

    return this.relayUrls.filter((relayUrl) => requested.has(relayUrl))
  }

  private evictConnection(url: string): void {
    const existing = this.connections.get(url)

    if (!existing) {
      return
    }

    this.dropConnection(url, existing)
    existing.connection?.close()
  }

  private dropConnection(url: string, expected?: ConnectionEntry): void {
    const existing = this.connections.get(url)

    if (!existing || (expected !== undefined && existing !== expected)) {
      return
    }

    existing.detachNotice?.()
    existing.detachClose?.()
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

  // PERF: fast path for accepted events. This skips snapshot allocation when
  // the relay is already healthy because it runs on every accepted event.
  private acceptRelayEvent(url: string): void {
    const current = sharedRelayHealth.get(url)
    if (
      current &&
      current.status === 'healthy' &&
      current.consecutiveFailures === 0 &&
      current.lastErrorCode === undefined
    ) {
      // Mutate lastEventMs in place. snapshotRelayHealth() copies before
      // handing data to listeners. This timestamp is used by timeout handling;
      // UI subscribers do not need a publish when the visible health did not
      // change.
      current.lastEventMs = this.clock.now()
      return
    }
    this.updateRelayHealth(url, (c) => ({
      ...c,
      status: 'healthy',
      consecutiveFailures: 0,
      lastErrorCode: undefined,
      lastEventMs: this.clock.now(),
    }))
  }

  private updateRelayHealth(
    url: string,
    updater: (current: RelayHealthSnapshot) => RelayHealthSnapshot,
  ): void {
    updateSharedRelayHealth(url, updater, this.clock.now())
  }

  private snapshotRelayHealth(): Record<string, RelayHealthSnapshot> {
    return snapshotSharedRelayHealth(this.relayUrls)
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

function ensureSharedRelayHealth(url: string, now: number): void {
  if (sharedRelayHealth.has(url)) {
    return
  }

  sharedRelayHealth.set(url, {
    url,
    status: 'idle',
    attempt: 0,
    activeSubscriptions: 0,
    consecutiveFailures: 0,
    lastChangeMs: now,
  })
}

function updateSharedRelayHealth(
  url: string,
  updater: (current: RelayHealthSnapshot) => RelayHealthSnapshot,
  now: number,
): void {
  ensureSharedRelayHealth(url, now)
  const current = sharedRelayHealth.get(url)

  if (!current) {
    return
  }

  const next = {
    ...updater(current),
    lastChangeMs: now,
  }

  sharedRelayHealth.set(url, next)
  publishSharedHealth()
}

function snapshotSharedRelayHealth(relayUrls: readonly string[]) {
  const entries = relayUrls.map((url) => {
    const snapshot = sharedRelayHealth.get(url)

    if (snapshot) {
      return [url, { ...snapshot }] as const
    }

    return [
      url,
      {
        url,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: Date.now(),
      } satisfies RelayHealthSnapshot,
    ] as const
  })

  return Object.fromEntries(entries)
}

function publishSharedHealth(): void {
  if (
    sharedHealthListeners.size === 0 ||
    sharedHealthPublishHandle !== null
  ) {
    return
  }

  sharedHealthPublishHandle = setTimeout(() => {
    sharedHealthPublishHandle = null
    for (const listener of sharedHealthListeners) {
      listener()
    }
  }, HEALTH_PUBLISH_DELAY_MS)
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
