import {
  createNostrGraphDatabase,
  ImageVariantRepository,
} from '@/features/graph-runtime/db'
import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import {
  summarizeAvatarUrl,
  traceAvatarFlow,
} from '@/features/graph-runtime/debug/avatarTrace'

const AVATAR_DISK_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const AVATAR_DISK_CACHE_MAX_BYTES = 500 * 1024 * 1024
const AVATAR_DISK_CACHE_MAX_ENTRY_BYTES = 5 * 1024 * 1024

export interface AvatarDiskCacheHit {
  blob: Blob
  mimeType: string
  byteSize: number
}

export interface AvatarDiskCache {
  has: (
    sourceUrl: string,
    bucket: ImageLodBucket,
    now: number,
  ) => Promise<boolean>
  get: (
    sourceUrl: string,
    bucket: ImageLodBucket,
    now: number,
  ) => Promise<AvatarDiskCacheHit | null>
  put: (input: {
    sourceUrl: string
    bucket: ImageLodBucket
    blob: Blob
    mimeType: string
    now: number
  }) => Promise<void>
  delete: (sourceUrl: string, bucket: ImageLodBucket) => Promise<void>
}

let defaultDiskCache: AvatarDiskCache | null | undefined

const canUseIndexedDb = () =>
  typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined'

export const getDefaultAvatarDiskCache = (): AvatarDiskCache | null => {
  if (defaultDiskCache !== undefined) {
    return defaultDiskCache
  }

  if (!canUseIndexedDb()) {
    defaultDiskCache = null
    return defaultDiskCache
  }

  try {
    defaultDiskCache = createDexieAvatarDiskCache()
  } catch (error) {
    traceAvatarFlow('renderer.avatarDiskCache.unavailable', () => ({
      reason: error instanceof Error ? error.message : String(error),
    }))
    defaultDiskCache = null
  }

  return defaultDiskCache
}

export const createDexieAvatarDiskCache = (): AvatarDiskCache => {
  const db = createNostrGraphDatabase()
  const repository = new ImageVariantRepository(db)

  return {
    async has(sourceUrl, bucket, now) {
      void now
      const keys = await db.imageVariants
        .where('[sourceUrl+bucket]')
        .equals([sourceUrl, bucket])
        .primaryKeys()
      return keys.length > 0
    },

    async get(sourceUrl, bucket, now) {
      const record = await repository.getFresh(sourceUrl, bucket, now)
      if (!record) {
        return null
      }

      void repository.touch(sourceUrl, bucket, now).catch(() => {})
      traceAvatarFlow('renderer.avatarDiskCache.hit', () => ({
        sourceUrl: summarizeAvatarUrl(sourceUrl),
        bucket,
        byteSize: record.byteSize,
        mimeType: record.mimeType,
      }))

      return {
        blob: record.blob,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
      }
    },

    async put({ sourceUrl, bucket, blob, mimeType, now }) {
      const byteSize = blob.size
      if (byteSize <= 0 || byteSize > AVATAR_DISK_CACHE_MAX_ENTRY_BYTES) {
        traceAvatarFlow('renderer.avatarDiskCache.putSkipped', () => ({
          sourceUrl: summarizeAvatarUrl(sourceUrl),
          bucket,
          byteSize,
          reason:
            byteSize <= 0
              ? 'empty_blob'
              : 'entry_too_large',
        }))
        return
      }

      await repository.put({
        cacheKey: `${sourceUrl}\0${bucket}`,
        sourceUrl,
        bucket,
        fetchedAt: now,
        lastAccessedAt: now,
        expiresAt: now + AVATAR_DISK_CACHE_TTL_MS,
        byteSize,
        mimeType: mimeType || blob.type || 'application/octet-stream',
        width: bucket,
        height: bucket,
        blob,
      })
      await repository.enforceByteBudget(AVATAR_DISK_CACHE_MAX_BYTES)
      traceAvatarFlow('renderer.avatarDiskCache.put', () => ({
        sourceUrl: summarizeAvatarUrl(sourceUrl),
        bucket,
        byteSize,
        mimeType: mimeType || blob.type || null,
      }))
    },

    async delete(sourceUrl, bucket) {
      await repository.delete([sourceUrl, bucket])
    },
  }
}
