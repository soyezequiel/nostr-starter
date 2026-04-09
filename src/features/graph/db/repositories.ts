import Dexie from 'dexie'

import { NostrGraphDexie } from '@/features/graph/db/database'
import type {
  AddressableHeadKey,
  AddressableHeadRecord,
  ContactListRecord,
  ImageVariantRecord,
  InboundRefRecord,
  ProfileRecord,
  RawEventInput,
  RawEventRecord,
  ReplaceableHeadKey,
  ReplaceableHeadRecord,
  ZapRecord,
} from '@/features/graph/db/entities'
import {
  buildTieBreakKey,
  compareRawEvents,
  mergeCaptureScope,
  shouldReplaceCanonicalHead,
  shouldReplaceProjection,
  toSortedUniqueStrings,
} from '@/features/graph/db/utils'

export class RawEventsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(input: RawEventInput): Promise<RawEventRecord> {
    const existing = await this.db.rawEvents.get(input.id)
    const normalizedRecord: RawEventRecord = {
      ...input,
      relayUrls: toSortedUniqueStrings(input.relayUrls),
      dTag: input.dTag ?? null,
      firstSeenAt: input.firstSeenAt ?? input.fetchedAt,
      lastSeenAt: input.lastSeenAt ?? input.fetchedAt,
    }

    if (!existing) {
      await this.db.rawEvents.put(normalizedRecord)
      return normalizedRecord
    }

    const mergedRecord: RawEventRecord = {
      ...existing,
      ...normalizedRecord,
      fetchedAt: Math.max(existing.fetchedAt, normalizedRecord.fetchedAt),
      firstSeenAt: Math.min(existing.firstSeenAt, normalizedRecord.firstSeenAt),
      lastSeenAt: Math.max(existing.lastSeenAt, normalizedRecord.lastSeenAt),
      relayUrls: toSortedUniqueStrings([...existing.relayUrls, ...normalizedRecord.relayUrls]),
      captureScope: mergeCaptureScope(existing.captureScope, normalizedRecord.captureScope),
    }

    await this.db.rawEvents.put(mergedRecord)
    return mergedRecord
  }

  public async getById(id: string): Promise<RawEventRecord | undefined> {
    return this.db.rawEvents.get(id)
  }

  public async findByPubkeyAndKind(pubkey: string, kind: number): Promise<RawEventRecord[]> {
    const records = await this.db.rawEvents.where('[pubkey+kind]').equals([pubkey, kind]).toArray()
    return records.sort(compareRawEvents)
  }
}

export class ReplaceableHeadsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: Omit<ReplaceableHeadRecord, 'tieBreakKey'>): Promise<ReplaceableHeadRecord> {
    const key: ReplaceableHeadKey = [record.pubkey, record.kind]
    const existing = await this.db.replaceableHeads.get(key)
    const normalizedRecord: ReplaceableHeadRecord = {
      ...record,
      tieBreakKey: buildTieBreakKey(record.createdAt, record.eventId),
    }

    if (!existing || shouldReplaceCanonicalHead(existing, normalizedRecord)) {
      await this.db.replaceableHeads.put(normalizedRecord)
      return normalizedRecord
    }

    return existing
  }

  public async get(pubkey: string, kind: number): Promise<ReplaceableHeadRecord | undefined> {
    return this.db.replaceableHeads.get([pubkey, kind])
  }
}

export class AddressableHeadsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: Omit<AddressableHeadRecord, 'tieBreakKey'>): Promise<AddressableHeadRecord> {
    const key: AddressableHeadKey = [record.pubkey, record.kind, record.dTag]
    const existing = await this.db.addressableHeads.get(key)
    const normalizedRecord: AddressableHeadRecord = {
      ...record,
      tieBreakKey: buildTieBreakKey(record.createdAt, record.eventId),
    }

    if (!existing || shouldReplaceCanonicalHead(existing, normalizedRecord)) {
      await this.db.addressableHeads.put(normalizedRecord)
      return normalizedRecord
    }

    return existing
  }

  public async get(
    pubkey: string,
    kind: number,
    dTag: string,
  ): Promise<AddressableHeadRecord | undefined> {
    return this.db.addressableHeads.get([pubkey, kind, dTag])
  }
}

export class ProfilesRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: ProfileRecord): Promise<ProfileRecord> {
    const existing = await this.db.profiles.get(record.pubkey)

    if (!existing || shouldReplaceProjection(existing, record)) {
      await this.db.profiles.put(record)
      return record
    }

    return existing
  }

  public async get(pubkey: string): Promise<ProfileRecord | undefined> {
    return this.db.profiles.get(pubkey)
  }
}

export class ContactListsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: ContactListRecord): Promise<ContactListRecord> {
    const existing = await this.db.contactLists.get(record.pubkey)
    const normalizedRecord: ContactListRecord = {
      ...record,
      follows: toSortedUniqueStrings(record.follows),
      relayHints: toSortedUniqueStrings(record.relayHints),
    }

    if (!existing || shouldReplaceProjection(existing, normalizedRecord)) {
      await this.db.contactLists.put(normalizedRecord)
      return normalizedRecord
    }

    return existing
  }

  public async get(pubkey: string): Promise<ContactListRecord | undefined> {
    return this.db.contactLists.get(pubkey)
  }
}

export class InboundRefsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: InboundRefRecord): Promise<InboundRefRecord> {
    const existing = await this.db.inboundRefs.get(record.eventId)
    const normalizedRecord: InboundRefRecord = {
      ...record,
      relayUrls: toSortedUniqueStrings(record.relayUrls),
    }

    if (!existing) {
      await this.db.inboundRefs.put(normalizedRecord)
      return normalizedRecord
    }

    const mergedRecord: InboundRefRecord = {
      ...existing,
      ...normalizedRecord,
      fetchedAt: Math.max(existing.fetchedAt, normalizedRecord.fetchedAt),
      relayUrls: toSortedUniqueStrings([...existing.relayUrls, ...normalizedRecord.relayUrls]),
    }

    await this.db.inboundRefs.put(mergedRecord)
    return mergedRecord
  }

  public async findByTargetPubkey(targetPubkey: string): Promise<InboundRefRecord[]> {
    return this.db.inboundRefs.where('targetPubkey').equals(targetPubkey).sortBy('createdAt')
  }
}

export class ZapsRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async upsert(record: ZapRecord): Promise<ZapRecord> {
    const existing = await this.db.zaps.get(record.id)

    if (!existing) {
      await this.db.zaps.put(record)
      return record
    }

    const mergedRecord: ZapRecord = {
      ...existing,
      ...record,
      fetchedAt: Math.max(existing.fetchedAt, record.fetchedAt),
    }

    await this.db.zaps.put(mergedRecord)
    return mergedRecord
  }

  public async findByPubkey(pubkey: string): Promise<ZapRecord[]> {
    return this.db
      .zaps
      .filter((record) => record.fromPubkey === pubkey || record.toPubkey === pubkey)
      .sortBy('createdAt')
  }

  public async findByTargetPubkeys(targetPubkeys: readonly string[]): Promise<ZapRecord[]> {
    const targetSet = new Set(targetPubkeys)

    return this.db
      .zaps
      .filter((record) => targetSet.has(record.toPubkey))
      .sortBy('createdAt')
  }
}

export class ImageVariantRepository {
  private readonly db: NostrGraphDexie

  public constructor(db: NostrGraphDexie) {
    this.db = db
  }

  public async put(record: ImageVariantRecord): Promise<ImageVariantRecord> {
    await this.db.imageVariants.put(record)
    return record
  }

  public async get(
    sourceUrl: string,
    bucket: number,
  ): Promise<ImageVariantRecord | undefined> {
    return this.db.imageVariants.get([sourceUrl, bucket])
  }

  public async getFresh(
    sourceUrl: string,
    bucket: number,
    now: number,
  ): Promise<ImageVariantRecord | undefined> {
    const record = await this.db.imageVariants.get([sourceUrl, bucket])

    if (!record) {
      return undefined
    }

    if (record.expiresAt <= now) {
      await this.db.imageVariants.delete([sourceUrl, bucket])
      return undefined
    }

    return record
  }

  public async getManyFresh(
    requests: Array<{ sourceUrl: string; bucket: number }>,
    now: number,
  ): Promise<(ImageVariantRecord | undefined)[]> {
    const records = await this.db.imageVariants.bulkGet(
      requests.map(({ sourceUrl, bucket }) => [sourceUrl, bucket]),
    )
    const expiredKeys: Array<[string, number]> = []

    const validRecords = records.map((record, index) => {
      if (!record) return undefined
      if (record.expiresAt <= now) {
        expiredKeys.push([requests[index].sourceUrl, requests[index].bucket])
        return undefined
      }

      return record
    })

    if (expiredKeys.length > 0) {
      void this.db.imageVariants.bulkDelete(expiredKeys).catch(console.warn)
    }

    return validRecords
  }

  public async touch(
    sourceUrl: string,
    bucket: number,
    lastAccessedAt: number,
  ): Promise<void> {
    await this.db.imageVariants.update([sourceUrl, bucket], {
      lastAccessedAt,
    })
  }

  public async bulkTouch(
    requests: Array<{ sourceUrl: string; bucket: number }>,
    lastAccessedAt: number,
  ): Promise<void> {
    if (requests.length === 0) {
      return
    }

    await this.db.transaction('rw', this.db.imageVariants, async () => {
      await Promise.all(
        requests.map(({ sourceUrl, bucket }) =>
          this.db.imageVariants.update([sourceUrl, bucket], {
            lastAccessedAt,
          }),
        ),
      )
    })
  }

  public async deleteExpired(now: number): Promise<number> {
    const expiredKeys = await this.db.imageVariants
      .where('expiresAt')
      .belowOrEqual(now)
      .primaryKeys()

    if (expiredKeys.length === 0) {
      return 0
    }

    await this.db.imageVariants.bulkDelete(expiredKeys)
    return expiredKeys.length
  }

  public async summarizeFresh(now: number): Promise<ImageVariantStorageSummary> {
    const expiredKeys: Array<[string, number]> = []
    const bucketSummary = new Map<number, { variants: number; bytes: number }>()
    let totalVariants = 0
    let totalBytes = 0

    await this.db.imageVariants.each((record) => {
      if (record.expiresAt <= now) {
        expiredKeys.push([record.sourceUrl, record.bucket])
        return
      }

      totalVariants += 1
      totalBytes += record.byteSize

      const currentBucket = bucketSummary.get(record.bucket) ?? {
        variants: 0,
        bytes: 0,
      }
      currentBucket.variants += 1
      currentBucket.bytes += record.byteSize
      bucketSummary.set(record.bucket, currentBucket)
    })

    if (expiredKeys.length > 0) {
      await this.db.imageVariants.bulkDelete(expiredKeys)
    }

    return {
      totalVariants,
      totalBytes,
      lodBuckets: Array.from(bucketSummary.entries())
        .sort(([leftBucket], [rightBucket]) => leftBucket - rightBucket)
        .map(([bucket, summary]) => ({
          bucket,
          variants: summary.variants,
          bytes: summary.bytes,
        })),
    }
  }

  public async enforceByteBudget(maxBytes: number): Promise<void> {
    type VariantMeta = { cacheKey: [string, number]; byteSize: number }
    const metaRecords: VariantMeta[] = []

    await this.db.imageVariants
      .orderBy('lastAccessedAt')
      .each((record) => {
        metaRecords.push({
          cacheKey: [record.sourceUrl, record.bucket],
          byteSize: record.byteSize,
        })
      })

    let totalBytes = metaRecords.reduce((sum, record) => sum + record.byteSize, 0)
    if (totalBytes <= maxBytes) {
      return
    }

    const keysToDelete: Array<[string, number]> = []
    for (const meta of metaRecords) {
      if (totalBytes <= maxBytes) {
        break
      }

      totalBytes -= meta.byteSize
      keysToDelete.push(meta.cacheKey)
    }

    if (keysToDelete.length > 0) {
      await this.db.imageVariants.bulkDelete(keysToDelete)
    }
  }
}

export interface ImageVariantLodSummary {
  bucket: number
  variants: number
  bytes: number
}

export interface ImageVariantStorageSummary {
  totalVariants: number
  totalBytes: number
  lodBuckets: ImageVariantLodSummary[]
}

export interface NostrGraphRepositories {
  rawEvents: RawEventsRepository
  replaceableHeads: ReplaceableHeadsRepository
  addressableHeads: AddressableHeadsRepository
  profiles: ProfilesRepository
  contactLists: ContactListsRepository
  inboundRefs: InboundRefsRepository
  zaps: ZapsRepository
  imageVariants: ImageVariantRepository
}

export function createRepositories(db: NostrGraphDexie): NostrGraphRepositories {
  return {
    rawEvents: new RawEventsRepository(db),
    replaceableHeads: new ReplaceableHeadsRepository(db),
    addressableHeads: new AddressableHeadsRepository(db),
    profiles: new ProfilesRepository(db),
    contactLists: new ContactListsRepository(db),
    inboundRefs: new InboundRefsRepository(db),
    zaps: new ZapsRepository(db),
    imageVariants: new ImageVariantRepository(db),
  }
}

export async function deleteDatabase(db: NostrGraphDexie): Promise<void> {
  const databaseName = db.name

  db.close()
  await Dexie.delete(databaseName)
}
