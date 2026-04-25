import type { Event, Filter } from 'nostr-tools'

import type {
  AppStore,
  GraphNode,
  RelayHealth,
  RelayHealthStatus as StoreRelayHealthStatus,
} from '@/features/graph-runtime/app/store'
import type { ProfileRecord } from '@/features/graph-runtime/db/entities'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  isAccountTraceTarget,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import { deriveDirectedEvidence } from '@/features/graph-runtime/evidence/directedEvidence'
import {
  normalizeRelayUrl,
  type RelayCountResult,
  type RelayEventEnvelope,
  type RelayHealthSnapshot,
  type RelayQueryFilter,
  type RelaySubscribeOptions,
  type RelaySubscriptionSummary,
} from '@/features/graph-runtime/nostr'
import type { NodeDetailProfile } from '@/features/graph-runtime/kernel/runtime'
import {
  MAX_SESSION_RELAYS,
  MAX_ZAP_RECEIPTS,
  NODE_EXPAND_INBOUND_PARSE_CONCURRENCY,
  NODE_EXPAND_INBOUND_QUERY_LIMIT,
  ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY,
  ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY,
  ROOT_INBOUND_DISCOVERY_RELAY_LIMIT,
} from '@/features/graph-runtime/kernel/modules/constants'
import type { RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import type {
  EventsWorkerActionMap,
  ParseContactListResult,
  ZapReceiptInput,
} from '@/features/graph-runtime/workers/events/contracts'
import type { WorkerClient } from '@/features/graph-runtime/workers/shared/runtime'
import { normalizeMediaUrl } from '@/lib/media'

const RECIPROCAL_AUTHOR_CHUNK_SIZE = 100
const RECIPROCAL_QUERY_CONCURRENCY = 2

export interface MergedRelayEventEnvelope {
  event: Event
  relayUrls: string[]
  relayUrl: string
  receivedAtMs: number
}

export interface RelayCollectionResult {
  events: RelayEventEnvelope[]
  summary: RelaySubscriptionSummary | null
  error: Error | null
}

export interface RelayCollectionProgress {
  eventCount: number
  latestBatchCount: number
  latestBatchEnvelopes: readonly RelayEventEnvelope[]
  latestEnvelope: RelayEventEnvelope | null
  envelopes: readonly RelayEventEnvelope[]
}

export type RelayCollectionOptions = RelaySubscribeOptions & {
  onProgress?: (progress: RelayCollectionProgress) => void
  hardTimeoutMs?: number
  signal?: AbortSignal
}

const createRelayCollectionCancelledError = () => {
  const error = new Error('Relay collection cancelled.')
  error.name = 'AbortError'
  return error
}

export interface InboundFollowerEvidence {
  followerPubkeys: string[]
  partial: boolean
}

export type PaginatedInboundStopReason =
  | 'count-reached'
  | 'empty-page'
  | 'error'
  | 'max-pages'
  | 'not-needed'
  | 'short-page'
  | 'stale'

export interface PaginatedInboundFollowerPageProgress {
  relayUrl: string
  pageIndex: number
  eventCount: number
  newEventCount: number
  totalNewEventCount: number
  knownCount: number | null
  until: number | null
  newEnvelopes: readonly RelayEventEnvelope[]
}

export interface PaginatedInboundFollowerRelaySummary {
  relayUrl: string
  seedEventCount: number
  knownCount: number | null
  requestedPageCount: number
  collectedEventCount: number
  newEventCount: number
  stoppedReason: PaginatedInboundStopReason
}

export interface PaginatedInboundFollowerCollectionResult
  extends RelayCollectionResult {
  pageCount: number
  relaySummaries: PaginatedInboundFollowerRelaySummary[]
}

export type RelayOverrideValidationResult =
  | {
    status: 'valid'
    relayUrls: string[]
    diagnostics: string[]
  }
  | {
    status: 'invalid'
    relayUrls: []
    message: string
    diagnostics: string[]
  }

export type KernelCommandErrorCode =
  | 'NODE_NOT_FOUND'
  | 'CAP_REACHED'
  | 'COMMAND_FAILED'

export class KernelCommandError extends Error {
  public readonly code: KernelCommandErrorCode
  public readonly details: Record<string, unknown>

  constructor(
    code: KernelCommandErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'KernelCommandError'
    this.code = code
    this.details = details
  }
}

export function buildMutualAdjacency(
  state: Pick<AppStore, 'links' | 'inboundLinks' | 'nodes'>,
): Record<string, string[]> {
  const evidence = deriveDirectedEvidence({
    links: state.links,
    inboundLinks: state.inboundLinks,
  })

  return Object.fromEntries(
    Object.keys(state.nodes)
      .sort()
      .map((pubkey) => [pubkey, evidence.mutualAdjacency[pubkey] ?? []]),
  )
}

export function mapRelayHealthStatus(
  status: RelayHealthSnapshot['status'],
): StoreRelayHealthStatus {
  switch (status) {
    case 'healthy':
      return 'connected'
    case 'degraded':
      return 'degraded'
    case 'offline':
      return 'offline'
    default:
      return 'unknown'
  }
}

export function validateRelayOverrideInput(
  rawRelayUrls: readonly string[],
): RelayOverrideValidationResult {
  const dedupedRelayUrls = Array.from(
    new Set(rawRelayUrls.map((relayUrl) => relayUrl.trim()).filter(Boolean)),
  )

  if (dedupedRelayUrls.length === 0) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: 'Debes ingresar al menos un relay valido.',
      diagnostics: [],
    }
  }

  if (dedupedRelayUrls.length > MAX_SESSION_RELAYS) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: `El limite de relays por sesion es ${MAX_SESSION_RELAYS}.`,
      diagnostics: [],
    }
  }

  const normalizedRelayUrls: string[] = []
  const diagnostics: string[] = []

  for (const relayUrl of dedupedRelayUrls) {
    try {
      normalizedRelayUrls.push(normalizeRelayUrl(relayUrl))
    } catch (error) {
      diagnostics.push(
        `${relayUrl}: ${error instanceof Error ? error.message : 'URL invalida.'}`,
      )
    }
  }

  if (diagnostics.length > 0) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: 'Hay URLs de relay invalidas. Revisa los diagnosticos.',
      diagnostics,
    }
  }

  return {
    status: 'valid',
    relayUrls: normalizedRelayUrls,
    diagnostics,
  }
}

export function mergeRelayUrlSets(
  ...relayGroups: Array<readonly string[] | undefined>
): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  for (const group of relayGroups) {
    for (const relayUrl of group ?? []) {
      if (!relayUrl || seen.has(relayUrl)) {
        continue
      }

      seen.add(relayUrl)
      merged.push(relayUrl)
    }
  }

  return merged
}

export function mergeBoundedRelayUrlSets(
  limit: number,
  ...relayGroups: Array<readonly string[] | undefined>
): string[] {
  if (limit <= 0) {
    return []
  }

  return mergeRelayUrlSets(...relayGroups).slice(0, limit)
}

export interface RelayUrlSetUsage {
  discoveredRelayUrls: string[]
  usedRelayUrls: string[]
  droppedRelayUrls: string[]
}

export function analyzeRelayUrlSetUsage(
  limit: number,
  ...relayGroups: Array<readonly string[] | undefined>
): RelayUrlSetUsage {
  const discoveredRelayUrls = mergeRelayUrlSets(...relayGroups)
  if (limit <= 0) {
    return {
      discoveredRelayUrls,
      usedRelayUrls: [],
      droppedRelayUrls: discoveredRelayUrls.slice(),
    }
  }

  return {
    discoveredRelayUrls,
    usedRelayUrls: discoveredRelayUrls.slice(0, limit),
    droppedRelayUrls: discoveredRelayUrls.slice(limit),
  }
}

export function parseRelayListEvent(envelope: RelayEventEnvelope): {
  readRelays: string[]
  writeRelays: string[]
  relays: string[]
} {
  const readRelays = new Set<string>()
  const writeRelays = new Set<string>()
  const relays = new Set<string>()

  for (const tag of envelope.event.tags) {
    if (tag[0] !== 'r' || !tag[1]) {
      continue
    }

    let relayUrl: string
    try {
      relayUrl = normalizeRelayUrl(tag[1])
    } catch {
      continue
    }

    const marker = tag[2]?.trim().toLowerCase()
    relays.add(relayUrl)

    if (marker === 'read') {
      readRelays.add(relayUrl)
    } else if (marker === 'write') {
      writeRelays.add(relayUrl)
    } else {
      readRelays.add(relayUrl)
      writeRelays.add(relayUrl)
    }
  }

  return {
    readRelays: Array.from(readRelays).sort(),
    writeRelays: Array.from(writeRelays).sort(),
    relays: Array.from(relays).sort(),
  }
}

export function createIdleRelayHealthSnapshotMap(
  relayUrls: readonly string[],
  now: number,
): Record<string, RelayHealthSnapshot> {
  return Object.fromEntries(
    relayUrls.map((relayUrl) => [
      relayUrl,
      {
        url: relayUrl,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: now,
      } satisfies RelayHealthSnapshot,
    ]),
  )
}

export function createRelayHealthSnapshotFromStore(
  relayUrl: string,
  relayHealth: RelayHealth | undefined,
  now: number,
): RelayHealthSnapshot {
  if (!relayHealth) {
    return {
      url: relayUrl,
      status: 'idle',
      attempt: 0,
      activeSubscriptions: 0,
      consecutiveFailures: 0,
      lastChangeMs: now,
    }
  }

  return {
    url: relayUrl,
    status: mapStoreRelayHealthStatus(relayHealth.status),
    attempt: 0,
    activeSubscriptions: 0,
    consecutiveFailures: 0,
    lastChangeMs: relayHealth.lastCheckedAt ?? now,
    lastNotice: relayHealth.lastNotice ?? undefined,
  }
}

export function mapStoreRelayHealthStatus(
  status: StoreRelayHealthStatus,
): RelayHealthSnapshot['status'] {
  switch (status) {
    case 'connected':
      return 'healthy'
    case 'degraded':
    case 'partial':
      return 'degraded'
    case 'offline':
      return 'offline'
    default:
      return 'idle'
  }
}

export async function collectRelayEvents(
  adapter: RelayAdapterInstance,
  filters: RelayQueryFilter[],
  options?: RelayCollectionOptions,
): Promise<RelayCollectionResult> {
  return new Promise<RelayCollectionResult>((resolve) => {
    const events: RelayEventEnvelope[] = []
    const { hardTimeoutMs, onProgress, signal, ...subscribeOptions } = options ?? {}
    let settled = false
    let cancel = () => {}
    let detachAbortListener = () => {}
    let hardTimeout: ReturnType<typeof setTimeout> | null =
      typeof hardTimeoutMs === 'number' && hardTimeoutMs > 0
        ? setTimeout(() => {
            finalize({
              events,
              summary: null,
              error: new Error(`Relay collection timed out after ${hardTimeoutMs}ms.`),
            })
          }, hardTimeoutMs)
        : null

    const reportProgress = (latestBatch: readonly RelayEventEnvelope[]) => {
      if (!onProgress || latestBatch.length === 0) {
        return
      }

      onProgress({
        eventCount: events.length,
        latestBatchCount: latestBatch.length,
        latestBatchEnvelopes: latestBatch,
        latestEnvelope: latestBatch[latestBatch.length - 1] ?? null,
        envelopes: events,
      })
    }

    const finalize = (result: RelayCollectionResult) => {
      if (settled) {
        return
      }

      settled = true
      detachAbortListener()
      if (hardTimeout !== null) {
        clearTimeout(hardTimeout)
        hardTimeout = null
      }
      cancel()
      resolve(result)
    }

    if (signal?.aborted) {
      finalize({
        events,
        summary: null,
        error: createRelayCollectionCancelledError(),
      })
      return
    }

    if (signal) {
      const handleAbort = () => {
        finalize({
          events,
          summary: null,
          error: createRelayCollectionCancelledError(),
        })
      }
      signal.addEventListener('abort', handleAbort, { once: true })
      detachAbortListener = () => {
        signal.removeEventListener('abort', handleAbort)
      }
    }

    cancel = adapter.subscribe(filters, subscribeOptions).subscribe({
      next: (value) => {
        events.push(value)
        reportProgress([value])
      },
      nextBatch: (values) => {
        events.push(...values)
        reportProgress(values)
      },
      error: (error) => {
        finalize({
          events,
          summary: null,
          error,
        })
      },
      complete: (summary) => {
        finalize({
          events,
          summary,
          error: null,
        })
      },
    })
  })
}

export async function collectInboundFollowerEvidence(
  eventsWorker: WorkerClient<EventsWorkerActionMap>,
  envelopes: readonly RelayEventEnvelope[],
  targetPubkey: string,
  options?: {
    onContactListParsed?: (
      envelope: RelayEventEnvelope,
      parsed: ParseContactListResult,
    ) => void | Promise<void>
  },
): Promise<InboundFollowerEvidence> {
  if (envelopes.length === 0) {
    return {
      followerPubkeys: [],
      partial: false,
    }
  }

  const debugEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_DEBUG === '1'
  const traceConfig = getAccountTraceConfig()
  const traceThisRoot = isAccountTraceRoot(targetPubkey)
  const uniqueEnvelopeAuthorCount = new Set(
    envelopes.map((envelope) => envelope.event.pubkey),
  ).size

  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectInboundFollowerEvidence: envelopes',
      {
        targetPubkey,
        envelopeCount: envelopes.length,
        uniqueEnvelopeAuthorCount,
        authorPubkeys: envelopes.map((envelope) => envelope.event.pubkey),
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    const traceTargetEnvelopes = envelopes.filter((envelope) =>
      isAccountTraceTarget(envelope.event.pubkey),
    )
    traceAccountFlow('collectInboundFollowerEvidence.envelopes', {
      targetPubkey,
      envelopeCount: envelopes.length,
      uniqueEnvelopeAuthorCount,
      hasTraceTargetEnvelope: traceTargetEnvelopes.length > 0,
      traceTargetEnvelopeCount: traceTargetEnvelopes.length,
      traceTargetEventIds: traceTargetEnvelopes.map((envelope) => envelope.event.id),
      traceTargetRelayUrls: Array.from(
        new Set(traceTargetEnvelopes.map((envelope) => envelope.relayUrl)),
      ),
    })
  }

  const followerPubkeys = new Set<string>()
  let partial = false
  let acceptedEnvelopeCount = 0
  let missingRootEnvelopeCount = 0
  let selfEnvelopeCount = 0
  let parseErrorCount = 0

  await runWithConcurrencyLimit(
    envelopes,
    NODE_EXPAND_INBOUND_PARSE_CONCURRENCY,
    async (envelope) => {
      try {
        const parsedContactList = await eventsWorker.invoke(
          'PARSE_CONTACT_LIST',
          {
            event: serializeContactListEvent(envelope.event),
          },
        )

        const includesRoot =
          parsedContactList.followPubkeys.includes(targetPubkey)
        if (includesRoot && envelope.event.pubkey !== targetPubkey) {
          followerPubkeys.add(envelope.event.pubkey)
          acceptedEnvelopeCount += 1
        } else if (envelope.event.pubkey === targetPubkey) {
          selfEnvelopeCount += 1
        } else {
          missingRootEnvelopeCount += 1
        }

        if (debugEnabled) {
          console.info(
            '[graph-v2:debug] collectInboundFollowerEvidence: parsed',
            {
              authorPubkey: envelope.event.pubkey,
              eventId: envelope.event.id,
              createdAt: envelope.event.created_at,
              relayUrl: envelope.relayUrl,
              followCount: parsedContactList.followPubkeys.length,
              includesRoot,
              accepted:
                includesRoot && envelope.event.pubkey !== targetPubkey,
            },
          )
        }
        if (traceThisRoot && isAccountTraceTarget(envelope.event.pubkey)) {
          traceAccountFlow('collectInboundFollowerEvidence.parsedTraceTarget', {
            eventId: envelope.event.id,
            createdAt: envelope.event.created_at,
            relayUrl: envelope.relayUrl,
            followCount: parsedContactList.followPubkeys.length,
            includesRoot,
            accepted: includesRoot && envelope.event.pubkey !== targetPubkey,
          })
        }

        await options?.onContactListParsed?.(envelope, parsedContactList)
      } catch (error) {
        partial = true
        parseErrorCount += 1
        if (debugEnabled) {
          console.info(
            '[graph-v2:debug] collectInboundFollowerEvidence: parse error',
            {
              authorPubkey: envelope.event.pubkey,
              eventId: envelope.event.id,
              error,
            },
          )
        }
        if (traceThisRoot && isAccountTraceTarget(envelope.event.pubkey)) {
          traceAccountFlow('collectInboundFollowerEvidence.parseErrorTraceTarget', {
            eventId: envelope.event.id,
            error,
          })
        }
      }
    },
  )

  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectInboundFollowerEvidence: result',
      {
        targetPubkey,
        followerCount: followerPubkeys.size,
        acceptedEnvelopeCount,
        missingRootEnvelopeCount,
        selfEnvelopeCount,
        parseErrorCount,
        partial,
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    traceAccountFlow('collectInboundFollowerEvidence.result', {
      targetPubkey,
      followerCount: followerPubkeys.size,
      includesTraceTarget: followerPubkeys.has(traceConfig.targetPubkey),
      acceptedEnvelopeCount,
      missingRootEnvelopeCount,
      selfEnvelopeCount,
      parseErrorCount,
      partial,
    })
  }

  return {
    followerPubkeys: Array.from(followerPubkeys).sort(),
    partial,
  }
}

export function mergeInboundFollowerEvidence(
  ...evidenceItems: readonly InboundFollowerEvidence[]
): InboundFollowerEvidence {
  const followerPubkeys = new Set<string>()

  for (const evidence of evidenceItems) {
    for (const pubkey of evidence.followerPubkeys) {
      followerPubkeys.add(pubkey)
    }
  }

  return {
    followerPubkeys: Array.from(followerPubkeys).sort(),
    partial: evidenceItems.some((evidence) => evidence.partial),
  }
}

export async function collectTargetedReciprocalFollowerEvidence({
  adapter,
  eventsWorker,
  followPubkeys,
  targetPubkey,
}: {
  adapter: RelayAdapterInstance
  eventsWorker: WorkerClient<EventsWorkerActionMap>
  followPubkeys: readonly string[]
  targetPubkey: string
}): Promise<InboundFollowerEvidence> {
  const candidatePubkeys = Array.from(
    new Set(
      followPubkeys
        .map((pubkey) => pubkey.trim())
        .filter((pubkey) => pubkey.length > 0 && pubkey !== targetPubkey),
    ),
  ).sort()

  if (candidatePubkeys.length === 0) {
    return {
      followerPubkeys: [],
      partial: false,
    }
  }

  const debugEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_DEBUG === '1'
  const traceConfig = getAccountTraceConfig()
  const traceThisRoot = isAccountTraceRoot(targetPubkey)

  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectTargetedReciprocalFollowerEvidence: start',
      {
        targetPubkey,
        candidateCount: candidatePubkeys.length,
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    const traceTargetIndex = candidatePubkeys.indexOf(traceConfig.targetPubkey)
    traceAccountFlow('collectTargetedReciprocalFollowerEvidence.start', {
      targetPubkey,
      candidateCount: candidatePubkeys.length,
      hasTraceTargetCandidate: traceTargetIndex >= 0,
      traceTargetCandidateIndex: traceTargetIndex,
    })
  }

  const reciprocalEnvelopes: RelayEventEnvelope[] = []
  let partial = false

  await runWithConcurrencyLimit(
    chunkIntoBatches(candidatePubkeys, RECIPROCAL_AUTHOR_CHUNK_SIZE),
    RECIPROCAL_QUERY_CONCURRENCY,
    async (authorPubkeys) => {
      const result = await collectRelayEvents(adapter, [
        {
          authors: authorPubkeys,
          kinds: [3],
          '#p': [targetPubkey],
          limit: Math.min(
            NODE_EXPAND_INBOUND_QUERY_LIMIT,
            Math.max(50, authorPubkeys.length),
          ),
        } satisfies Filter & { '#p': string[] },
      ])

      reciprocalEnvelopes.push(...result.events)
      partial = partial || result.error !== null
      const traceTargetEvents = traceThisRoot
        ? result.events.filter((envelope) => isAccountTraceTarget(envelope.event.pubkey))
        : []

      if (debugEnabled) {
        console.info(
          '[graph-v2:debug] collectTargetedReciprocalFollowerEvidence: chunk',
          {
            targetPubkey,
            authorCount: authorPubkeys.length,
            eventCount: result.events.length,
            partial: result.error !== null,
          },
        )
      }
      if (traceThisRoot && traceConfig && authorPubkeys.includes(traceConfig.targetPubkey)) {
        traceAccountFlow('collectTargetedReciprocalFollowerEvidence.chunkTraceTarget', {
          targetPubkey,
          authorCount: authorPubkeys.length,
          eventCount: result.events.length,
          partial: result.error !== null,
          hasTraceTargetEvent: traceTargetEvents.length > 0,
          traceTargetEventIds: traceTargetEvents.map((envelope) => envelope.event.id),
          traceTargetRelayUrls: Array.from(
            new Set(traceTargetEvents.map((envelope) => envelope.relayUrl)),
          ),
        })
      }
    },
  )

  const latestReciprocalEnvelopes =
    selectLatestReplaceableEventsByPubkey(reciprocalEnvelopes)
  if (traceThisRoot && traceConfig) {
    const traceTargetRawEvents = reciprocalEnvelopes.filter((envelope) =>
      isAccountTraceTarget(envelope.event.pubkey),
    )
    const traceTargetLatestEvents = latestReciprocalEnvelopes.filter((envelope) =>
      isAccountTraceTarget(envelope.event.pubkey),
    )
    traceAccountFlow('collectTargetedReciprocalFollowerEvidence.beforeParse', {
      targetPubkey,
      rawEnvelopeCount: reciprocalEnvelopes.length,
      latestEnvelopeCount: latestReciprocalEnvelopes.length,
      hasTraceTargetRawEvent: traceTargetRawEvents.length > 0,
      hasTraceTargetLatestEvent: traceTargetLatestEvents.length > 0,
      traceTargetRawEventIds: traceTargetRawEvents.map((envelope) => envelope.event.id),
      traceTargetLatestEventIds: traceTargetLatestEvents.map(
        (envelope) => envelope.event.id,
      ),
    })
  }

  const parsedEvidence = await collectInboundFollowerEvidence(
    eventsWorker,
    latestReciprocalEnvelopes,
    targetPubkey,
  )

  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectTargetedReciprocalFollowerEvidence: result',
      {
        targetPubkey,
        envelopeCount: reciprocalEnvelopes.length,
        followerCount: parsedEvidence.followerPubkeys.length,
        partial: partial || parsedEvidence.partial,
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    traceAccountFlow('collectTargetedReciprocalFollowerEvidence.result', {
      targetPubkey,
      envelopeCount: reciprocalEnvelopes.length,
      followerCount: parsedEvidence.followerPubkeys.length,
      includesTraceTarget: parsedEvidence.followerPubkeys.includes(
        traceConfig.targetPubkey,
      ),
      partial: partial || parsedEvidence.partial,
    })
  }

  return {
    followerPubkeys: parsedEvidence.followerPubkeys,
    partial: partial || parsedEvidence.partial,
  }
}

export async function collectAdditionalPaginatedInboundFollowerEvents({
  adapter,
  countResults = [],
  isStale = () => false,
  maxPagesPerRelay = ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY,
  onPage,
  pageConcurrency = ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY,
  pageLimit = NODE_EXPAND_INBOUND_QUERY_LIMIT,
  relayLimit = ROOT_INBOUND_DISCOVERY_RELAY_LIMIT,
  relayUrls,
  seedEnvelopes,
  targetPubkey,
}: {
  adapter: RelayAdapterInstance
  countResults?: readonly RelayCountResult[]
  isStale?: () => boolean
  maxPagesPerRelay?: number
  onPage?: (progress: PaginatedInboundFollowerPageProgress) => void
  pageConcurrency?: number
  pageLimit?: number
  relayLimit?: number
  relayUrls: readonly string[]
  seedEnvelopes: readonly RelayEventEnvelope[]
  targetPubkey: string
}): Promise<PaginatedInboundFollowerCollectionResult> {
  const normalizedPageLimit = Math.max(1, Math.floor(pageLimit))
  const normalizedMaxPagesPerRelay = Math.max(1, Math.floor(maxPagesPerRelay))
  const normalizedRelayLimit = Math.max(0, Math.floor(relayLimit))
  const normalizedPageConcurrency = Math.max(1, Math.floor(pageConcurrency))
  const countByRelayUrl = new Map(
    countResults
      .filter((result) => result.supported && result.count !== null)
      .map((result) => [result.relayUrl, result.count ?? 0]),
  )
  const seedEnvelopesByRelayUrl = groupRelayEventsByRelayUrl(seedEnvelopes)
  const seedEventIds = new Set(
    seedEnvelopes.map((envelope) => envelope.event.id),
  )
  const selectedRelayUrls = selectPaginatedInboundRelayUrls({
    countByRelayUrl,
    pageLimit: normalizedPageLimit,
    relayLimit: normalizedRelayLimit,
    relayUrls,
    seedEnvelopesByRelayUrl,
  })
  const debugEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_DEBUG === '1'
  const traceConfig = getAccountTraceConfig()
  const traceThisRoot = isAccountTraceRoot(targetPubkey)

  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectAdditionalPaginatedInboundFollowerEvents: start',
      {
        targetPubkey,
        selectedRelayUrls,
        pageLimit: normalizedPageLimit,
        maxPagesPerRelay: normalizedMaxPagesPerRelay,
        relayLimit: normalizedRelayLimit,
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    traceAccountFlow('collectAdditionalPaginatedInboundFollowerEvents.start', {
      selectedRelayUrls,
      pageLimit: normalizedPageLimit,
      maxPagesPerRelay: normalizedMaxPagesPerRelay,
      relayLimit: normalizedRelayLimit,
      countResults: Array.from(countByRelayUrl, ([relayUrl, count]) => ({
        relayUrl,
        count,
      })),
    })
  }

  const events: RelayEventEnvelope[] = []
  const relaySummaries: PaginatedInboundFollowerRelaySummary[] = []
  let firstError: Error | null = null
  let pageCount = 0
  let totalNewEventCount = 0

  await runWithConcurrencyLimit(
    selectedRelayUrls,
    normalizedPageConcurrency,
    async (relayUrl) => {
      const seedForRelay = seedEnvelopesByRelayUrl.get(relayUrl) ?? []
      const seedEventCount = new Set(
        seedForRelay.map((envelope) => envelope.event.id),
      ).size
      const knownCount = countByRelayUrl.get(relayUrl) ?? null

      if (knownCount !== null && seedEventCount >= knownCount) {
        relaySummaries.push({
          relayUrl,
          seedEventCount,
          knownCount,
          requestedPageCount: 0,
          collectedEventCount: seedEventCount,
          newEventCount: 0,
          stoppedReason: 'not-needed',
        })
        return
      }

      let requestedPageCount = 0
      let collectedEventCount = seedEventCount
      let relayNewEventCount = 0
      let stoppedReason: PaginatedInboundStopReason = 'max-pages'
      let until = findOldestCreatedAt(seedForRelay)
      let pageIndex = seedEventCount > 0 ? 2 : 1

      while (pageIndex <= normalizedMaxPagesPerRelay) {
        if (isStale()) {
          stoppedReason = 'stale'
          break
        }

        const filter: Filter & { '#p': string[] } = {
          kinds: [3],
          '#p': [targetPubkey],
          limit: normalizedPageLimit,
        }
        if (until !== null) {
          filter.until = Math.max(0, until - 1)
        }

        const result = await collectRelayEvents(adapter, [filter], {
          priority: 'background',
          relayUrls: [relayUrl],
        })
        requestedPageCount += 1
        pageCount += 1

        if (result.error !== null) {
          firstError = firstError ?? result.error
          stoppedReason = 'error'
        }

        const pageEventIds = new Set<string>()
        const newEnvelopes: RelayEventEnvelope[] = []
        for (const envelope of result.events) {
          pageEventIds.add(envelope.event.id)
          if (seedEventIds.has(envelope.event.id)) {
            continue
          }

          seedEventIds.add(envelope.event.id)
          events.push(envelope)
          newEnvelopes.push(envelope)
        }

        collectedEventCount += pageEventIds.size
        relayNewEventCount += newEnvelopes.length
        totalNewEventCount += newEnvelopes.length
        const currentUntil = filter.until ?? null
        onPage?.({
          relayUrl,
          pageIndex,
          eventCount: result.events.length,
          newEventCount: newEnvelopes.length,
          totalNewEventCount,
          knownCount,
          until: currentUntil,
          newEnvelopes,
        })

        if (debugEnabled) {
          console.info(
            '[graph-v2:debug] collectAdditionalPaginatedInboundFollowerEvents: page',
            {
              targetPubkey,
              relayUrl,
              pageIndex,
              eventCount: result.events.length,
              newEventCount: newEnvelopes.length,
              knownCount,
              until: currentUntil,
              errorMessage: result.error?.message ?? null,
            },
          )
        }
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('collectAdditionalPaginatedInboundFollowerEvents.page', {
            relayUrl,
            pageIndex,
            eventCount: result.events.length,
            newEventCount: newEnvelopes.length,
            knownCount,
            until: currentUntil,
            hasTraceTargetEvent: result.events.some((envelope) =>
              isAccountTraceTarget(envelope.event.pubkey),
            ),
            traceTargetNewEvent: newEnvelopes.some((envelope) =>
              isAccountTraceTarget(envelope.event.pubkey),
            ),
            errorMessage: result.error?.message ?? null,
          })
        }

        if (result.error !== null) {
          break
        }
        if (result.events.length === 0) {
          stoppedReason = 'empty-page'
          break
        }
        if (knownCount !== null && collectedEventCount >= knownCount) {
          stoppedReason = 'count-reached'
          break
        }
        if (result.events.length < normalizedPageLimit) {
          stoppedReason = 'short-page'
          break
        }

        until = findOldestCreatedAt(result.events)
        if (until === null || until <= 0) {
          stoppedReason = 'empty-page'
          break
        }

        pageIndex += 1
      }

      relaySummaries.push({
        relayUrl,
        seedEventCount,
        knownCount,
        requestedPageCount,
        collectedEventCount,
        newEventCount: relayNewEventCount,
        stoppedReason,
      })
    },
  )

  const sortedRelaySummaries = relaySummaries.sort((left, right) => {
    const leftKnown = left.knownCount ?? -1
    const rightKnown = right.knownCount ?? -1
    if (leftKnown !== rightKnown) {
      return rightKnown - leftKnown
    }

    return left.relayUrl.localeCompare(right.relayUrl)
  })

  const finalError = firstError as Error | null
  if (debugEnabled) {
    console.info(
      '[graph-v2:debug] collectAdditionalPaginatedInboundFollowerEvents: result',
      {
        targetPubkey,
        eventCount: events.length,
        pageCount,
        relaySummaries: sortedRelaySummaries,
        errorMessage: finalError?.message ?? null,
      },
    )
  }
  if (traceThisRoot && traceConfig) {
    traceAccountFlow('collectAdditionalPaginatedInboundFollowerEvents.result', {
      eventCount: events.length,
      pageCount,
      relaySummaries: sortedRelaySummaries,
      includesTraceTarget: events.some((envelope) =>
        isAccountTraceTarget(envelope.event.pubkey),
      ),
      errorMessage: finalError?.message ?? null,
    })
  }

  return {
    events,
    summary: null,
    error: firstError,
    pageCount,
    relaySummaries: sortedRelaySummaries,
  }
}

export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      await runWorker()
    }),
  )
}

export function selectLatestReplaceableEvent(
  events: RelayEventEnvelope[],
): RelayEventEnvelope | null {
  if (events.length === 0) {
    return null
  }

  return events
    .slice()
    .sort((left, right) => {
      if (left.event.created_at !== right.event.created_at) {
        return right.event.created_at - left.event.created_at
      }

      return left.event.id.localeCompare(right.event.id)
    })[0]
}

export function selectLatestReplaceableEventsByPubkey(
  events: RelayEventEnvelope[],
): RelayEventEnvelope[] {
  const latestByPubkey = new Map<string, RelayEventEnvelope>()

  for (const envelope of events) {
    const current = latestByPubkey.get(envelope.event.pubkey)
    if (!current) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
      continue
    }

    if (envelope.event.created_at > current.event.created_at) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
      continue
    }

    if (
      envelope.event.created_at === current.event.created_at &&
      envelope.event.id.localeCompare(current.event.id) < 0
    ) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
    }
  }

  return Array.from(latestByPubkey.values()).sort((left, right) =>
    left.event.pubkey.localeCompare(right.event.pubkey),
  )
}

export function serializeContactListEvent(event: Event) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    createdAt: event.created_at,
    tags: event.tags,
  }
}

export function safeParseProfile(content: string): {
  name: string | null
  about: string | null
  picture: string | null
  pictureSource: string | null
  nip05: string | null
  lud16: string | null
} | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const pictureSource = firstString(parsed.picture, parsed.image)
    return {
      name: firstString(parsed.display_name, parsed.name),
      about: firstString(parsed.about),
      picture: normalizeOptionalMediaUrl(pictureSource),
      pictureSource,
      nip05: firstString(parsed.nip05),
      lud16: firstString(parsed.lud16),
    }
  } catch {
    return null
  }
}

export function mapProfileRecordToNodeProfile(
  profile: ProfileRecord,
): NodeDetailProfile {
  return {
    eventId: profile.eventId,
    fetchedAt: profile.fetchedAt,
    profileSource: profile.profileSource ?? null,
    name: profile.name,
    about: profile.about,
    picture: normalizeOptionalMediaUrl(profile.picture),
    nip05: profile.nip05,
    lud16: profile.lud16,
  }
}

export function buildNodeProfileFromNode(node: GraphNode): NodeDetailProfile {
  return {
    eventId: node.profileEventId ?? '',
    fetchedAt: node.profileFetchedAt ?? 0,
    profileSource: node.profileSource ?? null,
    name: node.label ?? null,
    about: node.about ?? null,
    picture: normalizeOptionalMediaUrl(node.picture),
    nip05: node.nip05 ?? null,
    lud16: node.lud16 ?? null,
  }
}

export function tokenizeKeyword(keyword: string): string[] {
  return [
    ...new Set(
      keyword
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 1),
    ),
  ].sort()
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function normalizeOptionalMediaUrl(value: unknown): string | null {
  return normalizeMediaUrl(value) ?? null
}

export function chunkIntoBatches<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    return [items.slice()]
  }

  const batches: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }

  return batches
}

export function findDTag(event: Event): string | null {
  return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
}

export function findEventTagValue(
  tags: string[][],
  tagName: string,
): string | null {
  return tags.find((tag) => tag[0] === tagName)?.[1] ?? null
}

export function buildZapReceiptsFilter(
  visiblePubkeys: readonly string[],
): Filter & { '#p': string[] } {
  return {
    kinds: [9735],
    '#p': [...visiblePubkeys],
    limit: Math.min(
      MAX_ZAP_RECEIPTS,
      Math.max(50, visiblePubkeys.length * 20),
    ),
  }
}

export function mergeRelayEventsById(
  events: readonly RelayEventEnvelope[],
): MergedRelayEventEnvelope[] {
  const mergedById = new Map<string, MergedRelayEventEnvelope>()

  for (const envelope of events) {
    const existing = mergedById.get(envelope.event.id)

    if (!existing) {
      mergedById.set(envelope.event.id, {
        event: envelope.event,
        relayUrls: [envelope.relayUrl],
        relayUrl: envelope.relayUrl,
        receivedAtMs: envelope.receivedAtMs,
      })
      continue
    }

    existing.relayUrls = Array.from(
      new Set([...existing.relayUrls, envelope.relayUrl]),
    ).sort()
    existing.receivedAtMs = Math.max(
      existing.receivedAtMs,
      envelope.receivedAtMs,
    )
  }

  return Array.from(mergedById.values()).sort((left, right) => {
    if (left.event.created_at !== right.event.created_at) {
      return left.event.created_at - right.event.created_at
    }

    return left.event.id.localeCompare(right.event.id)
  })
}

export function serializeZapReceiptEvent(event: Event): ZapReceiptInput {
  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.created_at,
    tags: event.tags,
  }
}

function groupRelayEventsByRelayUrl(
  envelopes: readonly RelayEventEnvelope[],
): Map<string, RelayEventEnvelope[]> {
  const grouped = new Map<string, RelayEventEnvelope[]>()

  for (const envelope of envelopes) {
    const current = grouped.get(envelope.relayUrl)
    if (current) {
      current.push(envelope)
    } else {
      grouped.set(envelope.relayUrl, [envelope])
    }
  }

  return grouped
}

function findOldestCreatedAt(
  envelopes: readonly RelayEventEnvelope[],
): number | null {
  let oldest: number | null = null

  for (const envelope of envelopes) {
    if (oldest === null || envelope.event.created_at < oldest) {
      oldest = envelope.event.created_at
    }
  }

  return oldest
}

function selectPaginatedInboundRelayUrls({
  countByRelayUrl,
  pageLimit,
  relayLimit,
  relayUrls,
  seedEnvelopesByRelayUrl,
}: {
  countByRelayUrl: ReadonlyMap<string, number>
  pageLimit: number
  relayLimit: number
  relayUrls: readonly string[]
  seedEnvelopesByRelayUrl: ReadonlyMap<string, readonly RelayEventEnvelope[]>
}): string[] {
  if (relayLimit <= 0) {
    return []
  }

  return relayUrls
    .map((relayUrl, index) => {
      const seedEventCount = new Set(
        (seedEnvelopesByRelayUrl.get(relayUrl) ?? []).map(
          (envelope) => envelope.event.id,
        ),
      ).size
      const knownCount = countByRelayUrl.get(relayUrl) ?? null
      const hasKnownMore = knownCount !== null && knownCount > seedEventCount
      const hasUsefulKnownCountWithThinSeed =
        knownCount !== null && knownCount > 0 && seedEventCount < pageLimit
      const likelyHasMoreWithoutCount =
        knownCount === null && seedEventCount >= pageLimit

      return {
        relayUrl,
        index,
        seedEventCount,
        knownCount,
        shouldPaginate:
          hasKnownMore ||
          hasUsefulKnownCountWithThinSeed ||
          likelyHasMoreWithoutCount,
      }
    })
    .filter((relay) => relay.shouldPaginate)
    .sort((left, right) => {
      const leftKnown = left.knownCount ?? -1
      const rightKnown = right.knownCount ?? -1
      if (leftKnown !== rightKnown) {
        return rightKnown - leftKnown
      }

      if (left.seedEventCount !== right.seedEventCount) {
        return right.seedEventCount - left.seedEventCount
      }

      return left.index - right.index
    })
    .slice(0, relayLimit)
    .map((relay) => relay.relayUrl)
}
