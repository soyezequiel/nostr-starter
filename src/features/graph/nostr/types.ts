import type { Event, Filter } from 'nostr-tools'

export type RelayQueryFilter = Filter & {
  search?: string
}

export type RelayHealthStatus =
  | 'idle'
  | 'connecting'
  | 'healthy'
  | 'degraded'
  | 'offline'

export type RelayAdapterErrorCode =
  | 'RELAY_URL_INVALID'
  | 'RELAY_CONNECT_TIMEOUT'
  | 'RELAY_CONNECT_FAILED'
  | 'RELAY_PAGE_TIMEOUT'
  | 'RELAY_SUBSCRIPTION_CLOSED'
  | 'RELAY_EVENT_INVALID'
  | 'RELAY_CANCELLED'

export interface RelayAdapterErrorDetails {
  attempt?: number
  reason?: string
  subscriptionLabel?: string
  [key: string]: unknown
}

export interface RelayHealthSnapshot {
  url: string
  status: RelayHealthStatus
  attempt: number
  activeSubscriptions: number
  consecutiveFailures: number
  lastChangeMs: number
  lastNotice?: string
  lastCloseReason?: string
  lastErrorCode?: RelayAdapterErrorCode
  lastEventMs?: number
  lastEoseMs?: number
}

export interface RelayEventEnvelope {
  event: Event
  relayUrl: string
  receivedAtMs: number
  attempt: number
}

export interface RelaySubscriptionStats {
  acceptedEvents: number
  duplicateRelayEvents: number
  rejectedEvents: number
}

export interface RelaySubscriptionSummary {
  filters: Filter[]
  startedAtMs: number
  finishedAtMs: number
  relayHealth: Record<string, RelayHealthSnapshot>
  stats: RelaySubscriptionStats
}

export interface RelayObserver {
  next?: (value: RelayEventEnvelope) => void
  error?: (error: Error) => void
  complete?: (summary: RelaySubscriptionSummary) => void
}

export interface RelayEventObservable {
  subscribe: (observer: RelayObserver) => () => void
}

export interface RelayClock {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

export interface RelaySubscriptionHandle {
  close: (reason?: string) => void
}

export interface RelaySubscribeHandlers {
  onEvent: (event: Event) => void
  onEose: () => void
  onClose: (reason: string) => void
}

export interface RelayConnection {
  readonly url: string
  subscribe: (
    filters: Filter[],
    handlers: RelaySubscribeHandlers,
  ) => RelaySubscriptionHandle
  onNotice: (listener: (message: string) => void) => () => void
  close: () => void
}

export interface RelayTransport {
  connect: (url: string) => Promise<RelayConnection>
}

export interface RelayUrlValidationOptions {
  allowInsecureWs?: boolean
  allowLocalAddresses?: boolean
}

export interface RelayAdapterOptions extends RelayUrlValidationOptions {
  relayUrls: string[]
  connectTimeoutMs?: number
  pageTimeoutMs?: number
  retryCount?: number
  stragglerGraceMs?: number
  maxAuthorsPerFilter?: number
  clock?: RelayClock
  transport?: RelayTransport
}
