import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'

import { AvatarBitmapCache, type MonogramInput } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'
import type { AvatarBudget, AvatarUrlKey } from '@/features/graph-v2/renderer/avatar/types'

const BLOCKLIST_TTL_MS = 10 * 60 * 1000
const URGENT_RETRY_TTL_MS = 15 * 1000
const OUT_OF_VIEWPORT_GRACE_MS = 1500

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
  priority: number
  urgent: boolean
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

  private kickoffCandidates(
    candidates: readonly AvatarCandidate[],
    budget: AvatarBudget,
    now: number,
  ) {
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority)

    for (const candidate of sorted) {
      const inflightEntry = this.inflight.get(candidate.urlKey)
      if (inflightEntry) {
        inflightEntry.lastWantedAt = now
        inflightEntry.priority = candidate.priority
        inflightEntry.urgent = inflightEntry.urgent || (candidate.urgent ?? false)
        continue
      }
      const existing = this.cache.get(candidate.urlKey)
      if (existing && (existing.state === 'ready' || existing.state === 'loading')) {
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
        break
      }
      this.kickoff(candidate, budget, now)
    }
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

  private abortAll() {
    for (const [urlKey, entry] of this.inflight) {
      this.abortInflight(urlKey, entry, 'disposed')
    }
  }

  private prepareUrgentRetry(candidate: AvatarCandidate) {
    if (!candidate.urgent) {
      return false
    }

    const now = this.now()
    const nextRetryAt = this.nextUrgentRetryAt.get(candidate.urlKey) ?? 0
    if (nextRetryAt > now) {
      return false
    }

    this.nextUrgentRetryAt.set(candidate.urlKey, now + URGENT_RETRY_TTL_MS)
    this.cache.delete(candidate.urlKey)
    this.loader.unblock(candidate.urlKey)
    return true
  }

  private kickoff(candidate: AvatarCandidate, budget: AvatarBudget, now: number) {
    const targetBucket = Math.min(candidate.bucket, budget.maxBucket) as ImageLodBucket
    const controller = new AbortController()
    this.inflight.set(candidate.urlKey, {
      urlKey: candidate.urlKey,
      controller,
      pubkey: candidate.pubkey,
      priority: candidate.priority,
      urgent: candidate.urgent ?? false,
      lastWantedAt: now,
    })

    const monogram = this.cache.getMonogram(candidate.pubkey, candidate.monogram)
    this.cache.markLoading(candidate.urlKey, targetBucket, monogram)

    this.loader
      .load(candidate.url, targetBucket, controller.signal)
      .then((loaded) => {
        if (this.disposed) {
          return
        }
        if (controller.signal.aborted) {
          return
        }
        this.cache.markReady(
          candidate.urlKey,
          targetBucket,
          loaded.bitmap,
          monogram,
          loaded.bytes,
        )
      })
      .catch((err: unknown) => {
        if (this.disposed) {
          return
        }
        const reason = (err as { name?: string; message?: string } | null)?.name ?? ''
        if (reason === 'AbortError') {
          this.cache.delete(candidate.urlKey)
          return
        }
        this.cache.markFailed(candidate.urlKey, monogram)
        this.loader.block(candidate.urlKey, BLOCKLIST_TTL_MS)
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
    entry.controller.abort(reason)
    this.inflight.delete(urlKey)
    this.cache.delete(urlKey)
  }
}
