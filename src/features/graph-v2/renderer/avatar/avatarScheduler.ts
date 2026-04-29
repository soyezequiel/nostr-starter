import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import {
  summarizeAvatarUrl,
  summarizeAvatarUrlKey,
  traceAvatarFlow,
  truncateAvatarPubkey,
} from '@/features/graph-runtime/debug/avatarTrace'
import {
  clearTerminalAvatarFailure,
  getTerminalAvatarFailure,
  isTerminalAvatarFailureReason,
  rememberTerminalAvatarFailure,
} from '@/features/graph-runtime/debug/avatarTerminalFailures'

import {
  AvatarBitmapCache,
  type MonogramInput,
} from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import type {
  AvatarSchedulerDebugSnapshot,
  AvatarSchedulerEventDebugSnapshot,
} from '@/features/graph-v2/renderer/avatar/avatarDebug'
import { readAvatarDebugHost } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'
import type {
  AvatarBudget,
  AvatarReadyEntry,
  AvatarUrlKey,
} from '@/features/graph-v2/renderer/avatar/types'

const BLOCKLIST_TTL_MS = 10 * 60 * 1000
const TRANSIENT_FAILURE_TTL_MS = 15 * 60 * 1000
const SEMI_PERSISTENT_FAILURE_TTL_MS = 30 * 60 * 1000
const URGENT_RETRY_TTL_MS = 15 * 1000
const OUT_OF_VIEWPORT_GRACE_MS = 1500
const MAX_RECENT_DEBUG_EVENTS = 200
const DISK_CACHE_CONCURRENCY_FLOOR = 8
const DISK_CACHE_CONCURRENCY_HEADROOM = 12
const DISK_CACHE_CONCURRENCY_MULTIPLIER = 4
const DISK_CACHE_PROBE_BATCH_SIZE = 16
const DISK_CACHE_MISS_PROBE_COOLDOWN_MS = 5000

const resolveTargetBucket = (
  candidate: AvatarCandidate,
  budget: AvatarBudget,
) => Math.min(candidate.bucket, budget.maxBucket) as ImageLodBucket

export interface AvatarCandidate {
  pubkey: string
  urlKey: AvatarUrlKey
  url: string
  bucket: ImageLodBucket
  priority: number
  urgent?: boolean
  monogram: MonogramInput
}

interface InflightEntry {
  urlKey: AvatarUrlKey
  controller: AbortController
  pubkey: string
  url: string
  bucket: ImageLodBucket
  priority: number
  urgent: boolean
  startedAt: number
  lastWantedAt: number
}

export interface AvatarSchedulerDeps {
  cache: AvatarBitmapCache
  loader: AvatarLoader
  onSettled?: () => void
  now?: () => number
}

export class AvatarScheduler {
  private readonly cache: AvatarBitmapCache
  private readonly loader: AvatarLoader
  private readonly onSettled: () => void
  private readonly now: () => number
  private readonly inflight = new Map<AvatarUrlKey, InflightEntry>()
  private readonly nextUrgentRetryAt = new Map<AvatarUrlKey, number>()
  private readonly diskCacheLaneProbes = new Set<AvatarUrlKey>()
  private readonly nextDiskCacheProbeAt = new Map<AvatarUrlKey, number>()
  private readonly recentEvents: AvatarSchedulerEventDebugSnapshot[] = []
  private disposed = false

  constructor({ cache, loader, onSettled, now }: AvatarSchedulerDeps) {
    this.cache = cache
    this.loader = loader
    this.onSettled = onSettled ?? (() => {})
    this.now = now ?? (() => Date.now())
  }

  public reconcile(candidates: readonly AvatarCandidate[], budget: AvatarBudget) {
    if (this.disposed || !budget.drawAvatars) {
      this.abortAll()
      return
    }

    const now = this.now()
    const candidateKeys = this.recordCandidateDemand(candidates, now)
    this.abortExpiredInflight(candidateKeys, now)
    this.kickoffCandidates(candidates, budget, now)
  }

  public prime(candidates: readonly AvatarCandidate[], budget: AvatarBudget) {
    if (this.disposed || !budget.drawAvatars) {
      return
    }

    const now = this.now()
    this.recordCandidateDemand(candidates, now)
    this.kickoffCandidates(candidates, budget, now)
  }

  public dispose() {
    this.disposed = true
    this.abortAll()
  }

  public inflightSize() {
    return this.inflight.size
  }

  public hasInflight(urlKey: AvatarUrlKey) {
    return this.inflight.has(urlKey)
  }

  public getDebugSnapshot(): AvatarSchedulerDebugSnapshot {
    const now = this.now()
    const inflight = [...this.inflight.values()]
      .map((entry) => ({
        urlKey: entry.urlKey,
        pubkey: entry.pubkey,
        url: entry.url,
        host: readAvatarDebugHost(entry.url),
        bucket: entry.bucket,
        priority: entry.priority,
        urgent: entry.urgent,
        startedAt: entry.startedAt,
        lastWantedAt: entry.lastWantedAt,
      }))
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          left.pubkey.localeCompare(right.pubkey),
      )

    const urgentRetries = [...this.nextUrgentRetryAt.entries()]
      .map(([urlKey, retryAt]) => ({
        urlKey,
        retryAt,
        retryInMs: Math.max(0, retryAt - now),
      }))
      .filter((entry) => entry.retryInMs > 0)
      .sort(
        (left, right) =>
          left.retryInMs - right.retryInMs ||
          left.urlKey.localeCompare(right.urlKey),
      )

    return {
      inflightCount: inflight.length,
      inflight,
      urgentRetries,
      recentEvents: [...this.recentEvents],
    }
  }

  private kickoffCandidates(
    candidates: readonly AvatarCandidate[],
    budget: AvatarBudget,
    now: number,
  ) {
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority)

    for (let index = 0; index < sorted.length; index += 1) {
      const candidate = sorted[index]
      if (!candidate) {
        continue
      }
      if (this.disposed) {
        return
      }

      const targetBucket = resolveTargetBucket(candidate, budget)
      const inflightEntry = this.inflight.get(candidate.urlKey)
      if (inflightEntry) {
        inflightEntry.lastWantedAt = now
        inflightEntry.priority = candidate.priority
        inflightEntry.urgent = inflightEntry.urgent || (candidate.urgent ?? false)
        continue
      }

      const existing = this.cache.get(candidate.urlKey)
      const preserveReadyEntry =
        existing &&
        existing.state === 'ready' &&
        existing.bucket < targetBucket
          ? existing
          : null
      if (
        existing &&
        (existing.state === 'ready' || existing.state === 'loading') &&
        preserveReadyEntry === null
      ) {
        continue
      }
      if (existing && existing.state === 'failed') {
        if (!this.prepareUrgentRetry(candidate)) {
          continue
        }
      }
      if (this.loader.isBlocked(candidate.urlKey)) {
        if (!this.prepareUrgentRetry(candidate)) {
          continue
        }
      }

      while (
        this.inflight.size >= budget.concurrency &&
        (this.abortExpiredInflightEntry(now) ||
          this.abortLowerPriorityInflight(candidate))
      ) {
        // keep reclaiming obsolete slots until the candidate can start or no slot can be freed
      }
      if (this.inflight.size >= budget.concurrency) {
        this.queueDiskCacheLaneCandidates(sorted.slice(index), budget)
        break
      }

      this.kickoff(candidate, budget, now, { preserveReadyEntry })
    }
  }

  private queueDiskCacheLaneCandidates(
    candidates: readonly AvatarCandidate[],
    budget: AvatarBudget,
  ) {
    const diskCacheConcurrency = resolveDiskCacheConcurrencyLimit(
      budget.concurrency,
    )
    if (
      diskCacheConcurrency <= budget.concurrency ||
      this.inflight.size + this.diskCacheLaneProbes.size >= diskCacheConcurrency
    ) {
      return
    }

    const diskCacheProbe = this.loader.hasDiskCached
    if (typeof diskCacheProbe !== 'function') {
      return
    }

    let queued = 0
    for (const candidate of candidates) {
      if (queued >= DISK_CACHE_PROBE_BATCH_SIZE) {
        return
      }
      if (
        this.inflight.size + this.diskCacheLaneProbes.size >=
        diskCacheConcurrency
      ) {
        return
      }
      if (!this.canProbeDiskCacheLaneCandidate(candidate)) {
        continue
      }

      queued += 1
      this.diskCacheLaneProbes.add(candidate.urlKey)
      void this.tryKickoffDiskCacheLaneCandidate(
        candidate,
        budget,
        diskCacheConcurrency,
        diskCacheProbe,
      )
    }
  }

  private canProbeDiskCacheLaneCandidate(candidate: AvatarCandidate) {
    if (this.diskCacheLaneProbes.has(candidate.urlKey)) {
      return false
    }
    const nextProbeAt = this.nextDiskCacheProbeAt.get(candidate.urlKey) ?? 0
    if (nextProbeAt > this.now()) {
      return false
    }
    if (this.inflight.has(candidate.urlKey)) {
      return false
    }

    const existing = this.cache.get(candidate.urlKey)
    if (existing && (existing.state === 'ready' || existing.state === 'loading')) {
      return false
    }
    if (existing?.state === 'failed' && !candidate.urgent) {
      return false
    }
    if (this.loader.isBlocked(candidate.urlKey) && !candidate.urgent) {
      return false
    }

    return true
  }

  private async tryKickoffDiskCacheLaneCandidate(
    candidate: AvatarCandidate,
    budget: AvatarBudget,
    diskCacheConcurrency: number,
    diskCacheProbe: AvatarLoader['hasDiskCached'],
  ) {
    const targetBucket = Math.min(
      candidate.bucket,
      budget.maxBucket,
    ) as ImageLodBucket

    try {
      const hasDiskCached = await diskCacheProbe.call(
        this.loader,
        candidate.url,
        targetBucket,
      )
      if (!hasDiskCached) {
        this.nextDiskCacheProbeAt.set(
          candidate.urlKey,
          this.now() + DISK_CACHE_MISS_PROBE_COOLDOWN_MS,
        )
        return
      }
      if (
        this.disposed ||
        this.inflight.size >= diskCacheConcurrency ||
        !this.isStillPending(candidate)
      ) {
        return
      }

      traceAvatarFlow('renderer.avatarScheduler.diskCacheLaneAccepted', () => ({
        pubkey: candidate.pubkey,
        pubkeyShort: truncateAvatarPubkey(candidate.pubkey),
        url: summarizeAvatarUrl(candidate.url),
        urlKey: summarizeAvatarUrlKey(candidate.urlKey),
        bucket: targetBucket,
        priority: candidate.priority,
        regularConcurrency: budget.concurrency,
        diskCacheConcurrency,
        inflightCount: this.inflight.size,
      }))
      this.kickoff(candidate, budget, this.now(), { diskCacheOnly: true })
    } catch (err) {
      this.nextDiskCacheProbeAt.set(
        candidate.urlKey,
        this.now() + DISK_CACHE_MISS_PROBE_COOLDOWN_MS,
      )
      traceAvatarFlow('renderer.avatarScheduler.diskCacheLaneProbeFailed', () => ({
        pubkey: candidate.pubkey,
        pubkeyShort: truncateAvatarPubkey(candidate.pubkey),
        url: summarizeAvatarUrl(candidate.url),
        urlKey: summarizeAvatarUrlKey(candidate.urlKey),
        bucket: targetBucket,
        priority: candidate.priority,
        reason: extractAvatarLoadFailureReason(err),
      }))
    } finally {
      this.diskCacheLaneProbes.delete(candidate.urlKey)
    }
  }

  private isStillPending(candidate: AvatarCandidate) {
    if (this.inflight.has(candidate.urlKey)) {
      return false
    }

    const existing = this.cache.get(candidate.urlKey)
    if (existing && (existing.state === 'ready' || existing.state === 'loading')) {
      return false
    }

    return !this.loader.isBlocked(candidate.urlKey)
  }

  private abortAll() {
    for (const [urlKey, entry] of this.inflight) {
      this.abortInflight(urlKey, entry, 'disposed')
    }
  }

  private prepareUrgentRetry(candidate: AvatarCandidate) {
    if (!candidate.urgent) {
      return false
    }

    const terminalFailure = getTerminalAvatarFailure(candidate.urlKey)
    if (terminalFailure) {
      traceAvatarFlow('renderer.avatarScheduler.urgentRetrySkippedTerminal', () => ({
        pubkey: candidate.pubkey,
        pubkeyShort: truncateAvatarPubkey(candidate.pubkey),
        urlKey: summarizeAvatarUrlKey(candidate.urlKey),
        bucket: candidate.bucket,
        priority: candidate.priority,
        reason: terminalFailure.reason,
        host: terminalFailure.host,
      }))
      return false
    }

    const now = this.now()
    const nextRetryAt = this.nextUrgentRetryAt.get(candidate.urlKey) ?? 0
    if (nextRetryAt > now) {
      return false
    }

    this.nextUrgentRetryAt.set(candidate.urlKey, now + URGENT_RETRY_TTL_MS)
    this.cache.delete(candidate.urlKey, 'urgent_retry')
    this.loader.unblock(candidate.urlKey)
    traceAvatarFlow('renderer.avatarScheduler.urgentRetry', () => ({
      pubkey: candidate.pubkey,
      pubkeyShort: truncateAvatarPubkey(candidate.pubkey),
      urlKey: summarizeAvatarUrlKey(candidate.urlKey),
      bucket: candidate.bucket,
      priority: candidate.priority,
      retryAt: now + URGENT_RETRY_TTL_MS,
    }))
    return true
  }

  private kickoff(
    candidate: AvatarCandidate,
    budget: AvatarBudget,
    now: number,
    options: {
      diskCacheOnly?: boolean
      preserveReadyEntry?: AvatarReadyEntry | null
    } = {},
  ) {
    const targetBucket = resolveTargetBucket(candidate, budget)
    const controller = new AbortController()
    const preserveReadyEntry = options.preserveReadyEntry ?? null
    this.inflight.set(candidate.urlKey, {
      urlKey: candidate.urlKey,
      controller,
      pubkey: candidate.pubkey,
      url: candidate.url,
      bucket: targetBucket,
      priority: candidate.priority,
      urgent: candidate.urgent ?? false,
      startedAt: now,
      lastWantedAt: now,
    })

    this.recordEvent({
      at: now,
      type: 'started',
      urlKey: candidate.urlKey,
      pubkey: candidate.pubkey,
      url: candidate.url,
      host: readAvatarDebugHost(candidate.url),
      bucket: targetBucket,
      priority: candidate.priority,
      urgent: candidate.urgent ?? false,
      reason: null,
    })

    const monogram = this.cache.getMonogram(candidate.pubkey, candidate.monogram)
    if (!preserveReadyEntry) {
      this.cache.markLoading(candidate.urlKey, targetBucket, monogram)
    }

    const loadPromise = options.diskCacheOnly
      ? this.loader.loadDiskCached(candidate.url, targetBucket, controller.signal)
      : this.loader.load(candidate.url, targetBucket, controller.signal)

    loadPromise
      .then((loaded) => {
        if (this.disposed || controller.signal.aborted) {
          return
        }
        if (!loaded) {
          this.cache.delete(candidate.urlKey, 'disk_cache_lane_miss')
          this.recordEvent({
            at: this.now(),
            type: 'aborted',
            urlKey: candidate.urlKey,
            pubkey: candidate.pubkey,
            url: candidate.url,
            host: readAvatarDebugHost(candidate.url),
            bucket: targetBucket,
            priority: candidate.priority,
            urgent: candidate.urgent ?? false,
            reason: 'disk_cache_lane_miss',
          })
          return
        }

        this.cache.markReady(
          candidate.urlKey,
          targetBucket,
          loaded.bitmap,
          monogram,
          loaded.bytes,
        )
        clearTerminalAvatarFailure(candidate.urlKey)
        this.recordEvent({
          at: this.now(),
          type: 'ready',
          urlKey: candidate.urlKey,
          pubkey: candidate.pubkey,
          url: candidate.url,
          host: readAvatarDebugHost(candidate.url),
          bucket: targetBucket,
          priority: candidate.priority,
          urgent: candidate.urgent ?? false,
          reason: null,
        })
      })
      .catch((err: unknown) => {
        if (this.disposed) {
          return
        }

        // AbortSignal.reason can be a plain string in current browsers; after
        // this controller aborts it is still cancellation, not an image failure.
        if (controller.signal.aborted || isAbortError(err)) {
          if (!preserveReadyEntry) {
            this.cache.delete(candidate.urlKey, 'load_abort_error')
          }
          return
        }

        const reason = extractAvatarLoadFailureReason(err)
        const failurePolicy = resolveAvatarFailurePolicy(reason)
        if (preserveReadyEntry) {
          clearTerminalAvatarFailure(candidate.urlKey)
          this.loader.block(
            candidate.urlKey,
            failurePolicy.ttlMs ?? BLOCKLIST_TTL_MS,
            reason,
          )
        } else {
          this.cache.markFailed(
            candidate.urlKey,
            monogram,
            reason,
            failurePolicy.ttlMs,
          )
          if (failurePolicy.terminal) {
            rememberTerminalAvatarFailure({
              urlKey: candidate.urlKey,
              pubkey: candidate.pubkey,
              url: candidate.url,
              reason,
              at: this.now(),
            })
            traceAvatarFlow('renderer.avatarScheduler.terminalQuarantined', () => ({
              pubkey: candidate.pubkey,
              pubkeyShort: truncateAvatarPubkey(candidate.pubkey),
              url: summarizeAvatarUrl(candidate.url),
              urlKey: summarizeAvatarUrlKey(candidate.urlKey),
              bucket: targetBucket,
              priority: candidate.priority,
              urgent: candidate.urgent ?? false,
              reason,
            }))
          } else {
            clearTerminalAvatarFailure(candidate.urlKey)
            this.loader.block(
              candidate.urlKey,
              failurePolicy.ttlMs ?? BLOCKLIST_TTL_MS,
              reason,
            )
          }
        }
        this.recordEvent({
          at: this.now(),
          type: 'failed',
          urlKey: candidate.urlKey,
          pubkey: candidate.pubkey,
          url: candidate.url,
          host: readAvatarDebugHost(candidate.url),
          bucket: targetBucket,
          priority: candidate.priority,
          urgent: candidate.urgent ?? false,
          reason,
        })
      })
      .finally(() => {
        const current = this.inflight.get(candidate.urlKey)
        if (current && current.controller === controller) {
          this.inflight.delete(candidate.urlKey)
        }
        if (!this.disposed) {
          this.onSettled()
        }
      })
  }

  private abortLowerPriorityInflight(candidate: AvatarCandidate) {
    if (!candidate.urgent) {
      return false
    }

    let lowestPriorityEntry: InflightEntry | null = null
    for (const entry of this.inflight.values()) {
      if (entry.priority <= candidate.priority) {
        continue
      }
      if (!lowestPriorityEntry || entry.priority > lowestPriorityEntry.priority) {
        lowestPriorityEntry = entry
      }
    }

    if (!lowestPriorityEntry) {
      return false
    }

    this.abortInflight(
      lowestPriorityEntry.urlKey,
      lowestPriorityEntry,
      'preempted_by_urgent_avatar',
    )
    return true
  }

  private recordCandidateDemand(
    candidates: readonly AvatarCandidate[],
    now: number,
  ) {
    const candidateKeys = new Set<AvatarUrlKey>()
    for (const candidate of candidates) {
      candidateKeys.add(candidate.urlKey)
      const inflightEntry = this.inflight.get(candidate.urlKey)
      if (!inflightEntry) {
        continue
      }
      inflightEntry.lastWantedAt = now
      inflightEntry.priority = candidate.priority
      inflightEntry.urgent = inflightEntry.urgent || (candidate.urgent ?? false)
    }
    return candidateKeys
  }

  private abortExpiredInflight(
    candidateKeys: ReadonlySet<AvatarUrlKey>,
    now: number,
  ) {
    for (const [urlKey, entry] of this.inflight) {
      if (candidateKeys.has(urlKey)) {
        continue
      }
      if (this.shouldRetainInflight(entry, now)) {
        continue
      }
      this.abortInflight(urlKey, entry, 'out_of_viewport')
    }
  }

  private abortExpiredInflightEntry(now: number) {
    let staleEntry: InflightEntry | null = null

    for (const entry of this.inflight.values()) {
      if (this.shouldRetainInflight(entry, now)) {
        continue
      }
      if (!staleEntry || entry.priority > staleEntry.priority) {
        staleEntry = entry
      }
    }

    if (!staleEntry) {
      return false
    }

    this.abortInflight(staleEntry.urlKey, staleEntry, 'out_of_viewport')
    return true
  }

  private shouldRetainInflight(entry: InflightEntry, now: number) {
    return now - entry.lastWantedAt < OUT_OF_VIEWPORT_GRACE_MS
  }

  private abortInflight(
    urlKey: AvatarUrlKey,
    entry: InflightEntry,
    reason: string,
  ) {
    this.recordEvent({
      at: this.now(),
      type: 'aborted',
      urlKey,
      pubkey: entry.pubkey,
      url: entry.url,
      host: readAvatarDebugHost(entry.url),
      bucket: entry.bucket,
      priority: entry.priority,
      urgent: entry.urgent,
      reason,
    })
    entry.controller.abort(reason)
    this.inflight.delete(urlKey)
    this.cache.delete(urlKey, `inflight_${reason}`)
  }

  private recordEvent(event: AvatarSchedulerEventDebugSnapshot) {
    this.recentEvents.push(event)
    if (this.recentEvents.length > MAX_RECENT_DEBUG_EVENTS) {
      this.recentEvents.splice(
        0,
        this.recentEvents.length - MAX_RECENT_DEBUG_EVENTS,
      )
    }
    traceAvatarFlow(`renderer.avatarScheduler.${event.type}`, () => ({
      at: event.at,
      type: event.type,
      pubkey: event.pubkey,
      pubkeyShort: truncateAvatarPubkey(event.pubkey),
      url: summarizeAvatarUrl(event.url),
      urlKey: summarizeAvatarUrlKey(event.urlKey),
      host: event.host,
      bucket: event.bucket,
      priority: event.priority,
      urgent: event.urgent,
      reason: event.reason,
      inflightCount: this.inflight.size,
    }))
  }
}

const isAbortError = (err: unknown) =>
  (err as { name?: string } | null)?.name === 'AbortError'

const resolveDiskCacheConcurrencyLimit = (regularConcurrency: number) => {
  if (regularConcurrency <= 0) {
    return regularConcurrency
  }

  const expanded = Math.max(
    DISK_CACHE_CONCURRENCY_FLOOR,
    regularConcurrency * DISK_CACHE_CONCURRENCY_MULTIPLIER,
  )
  return Math.max(
    regularConcurrency,
    Math.min(regularConcurrency + DISK_CACHE_CONCURRENCY_HEADROOM, expanded),
  )
}

const extractAvatarLoadFailureReason = (err: unknown) => {
  const candidate = err as
    | { reason?: string; message?: string; name?: string }
    | null
    | undefined
  return (
    candidate?.reason ??
    candidate?.message ??
    candidate?.name ??
    'avatar_load_failed'
  )
}

const resolveAvatarFailurePolicy = (reason: string | null) => {
  if (!reason) {
    return {
      terminal: false,
      ttlMs: BLOCKLIST_TTL_MS,
    }
  }

  if (isTerminalAvatarFailureReason(reason)) {
    return {
      terminal: true,
      ttlMs: null,
    }
  }

  const httpMatch = /^http_(\d{3})(?:_|$)/.exec(reason)
  if (httpMatch) {
    const status = Number.parseInt(httpMatch[1] ?? '', 10)
    if ([400, 401, 403, 404, 410, 422].includes(status)) {
      return {
        terminal: true,
        ttlMs: null,
      }
    }
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return {
        terminal: false,
        ttlMs: TRANSIENT_FAILURE_TTL_MS,
      }
    }
    return {
      terminal: false,
      ttlMs: SEMI_PERSISTENT_FAILURE_TTL_MS,
    }
  }

  switch (reason) {
    case 'timeout':
      return {
        terminal: false,
        ttlMs: TRANSIENT_FAILURE_TTL_MS,
      }
    case 'image_load_failed':
    case 'avatar_load_failed':
      return {
        terminal: false,
        ttlMs: SEMI_PERSISTENT_FAILURE_TTL_MS,
      }
    default:
      return {
        terminal: false,
        ttlMs: SEMI_PERSISTENT_FAILURE_TTL_MS,
      }
  }
}
