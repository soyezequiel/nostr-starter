import type { ImageLodBucket } from '@/features/graph/render/avatar'

import { AvatarBitmapCache, type MonogramInput } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
import { AvatarLoader } from '@/features/graph-v2/renderer/avatar/avatarLoader'
import type { AvatarBudget, AvatarUrlKey } from '@/features/graph-v2/renderer/avatar/types'

const BLOCKLIST_TTL_MS = 10 * 60 * 1000

export interface AvatarCandidate {
  pubkey: string
  urlKey: AvatarUrlKey
  url: string
  bucket: ImageLodBucket
  priority: number
  monogram: MonogramInput
}

interface InflightEntry {
  urlKey: AvatarUrlKey
  controller: AbortController
  pubkey: string
}

export interface AvatarSchedulerDeps {
  cache: AvatarBitmapCache
  loader: AvatarLoader
  onSettled?: () => void
}

export class AvatarScheduler {
  private readonly cache: AvatarBitmapCache
  private readonly loader: AvatarLoader
  private readonly onSettled: () => void
  private readonly inflight = new Map<AvatarUrlKey, InflightEntry>()
  private disposed = false

  constructor({ cache, loader, onSettled }: AvatarSchedulerDeps) {
    this.cache = cache
    this.loader = loader
    this.onSettled = onSettled ?? (() => {})
  }

  public reconcile(candidates: readonly AvatarCandidate[], budget: AvatarBudget) {
    if (this.disposed || !budget.drawAvatars) {
      this.abortAll()
      return
    }

    const candidateKeys = new Set<AvatarUrlKey>()
    for (const c of candidates) {
      candidateKeys.add(c.urlKey)
    }
    for (const [urlKey, entry] of this.inflight) {
      if (!candidateKeys.has(urlKey)) {
        entry.controller.abort('out_of_viewport')
        this.inflight.delete(urlKey)
      }
    }

    const sorted = [...candidates].sort((a, b) => a.priority - b.priority)

    for (const candidate of sorted) {
      if (this.inflight.size >= budget.concurrency) {
        break
      }
      if (this.inflight.has(candidate.urlKey)) {
        continue
      }
      const existing = this.cache.get(candidate.urlKey)
      if (existing && (existing.state === 'ready' || existing.state === 'loading')) {
        continue
      }
      if (existing && existing.state === 'failed') {
        continue
      }
      if (this.loader.isBlocked(candidate.urlKey)) {
        continue
      }
      this.kickoff(candidate, budget)
    }
  }

  public dispose() {
    this.disposed = true
    this.abortAll()
  }

  public inflightSize() {
    return this.inflight.size
  }

  private abortAll() {
    for (const entry of this.inflight.values()) {
      entry.controller.abort('disposed')
    }
    this.inflight.clear()
  }

  private kickoff(candidate: AvatarCandidate, budget: AvatarBudget) {
    const targetBucket = Math.min(candidate.bucket, budget.maxBucket) as ImageLodBucket
    const controller = new AbortController()
    this.inflight.set(candidate.urlKey, {
      urlKey: candidate.urlKey,
      controller,
      pubkey: candidate.pubkey,
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
}
