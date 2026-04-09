import Dexie, { type Table } from 'dexie'

import type {
  AddressableHeadKey,
  AddressableHeadRecord,
  ContactListRecord,
  ImageVariantRecord,
  InboundRefRecord,
  ProfileRecord,
  RawEventRecord,
  ReplaceableHeadKey,
  ReplaceableHeadRecord,
  ZapRecord,
} from '@/features/graph/db/entities'

export const NOSTR_GRAPH_DB_NAME = 'nostr-graph-explorer'

export const NOSTR_GRAPH_DB_SCHEMA_V1 = {
  rawEvents:
    'id, pubkey, kind, createdAt, fetchedAt, firstSeenAt, lastSeenAt, dTag, captureScope, [pubkey+kind], [pubkey+kind+createdAt], [pubkey+kind+dTag]',
  replaceableHeads: '[pubkey+kind], pubkey, kind, eventId, createdAt, tieBreakKey, updatedAt',
  addressableHeads:
    '[pubkey+kind+dTag], pubkey, kind, dTag, eventId, createdAt, tieBreakKey, updatedAt',
  profiles: 'pubkey, eventId, createdAt, fetchedAt, nip05, lud16',
  contactLists: 'pubkey, eventId, createdAt, fetchedAt',
  inboundRefs: 'eventId, targetPubkey, kind, createdAt, fetchedAt, relationType, [targetPubkey+kind]',
  zaps: 'id, fromPubkey, toPubkey, createdAt, fetchedAt, sats, eventRef',
} as const

export const NOSTR_GRAPH_DB_SCHEMA_V2 = {
  ...NOSTR_GRAPH_DB_SCHEMA_V1,
  avatarCache: 'sourceUrl, fetchedAt, lastAccessedAt, expiresAt, byteSize',
} as const

// V3: same schema, but upgrade clears avatarCache to flush stale rectangular blobs
// persisted before the circular-clipping normalization fix.
export const NOSTR_GRAPH_DB_SCHEMA_V3 = {
  ...NOSTR_GRAPH_DB_SCHEMA_V2,
} as const

export const NOSTR_GRAPH_DB_SCHEMA_V4 = {
  ...NOSTR_GRAPH_DB_SCHEMA_V1,
  avatarCache: null,
  imageVariants:
    '[sourceUrl+bucket], sourceUrl, bucket, fetchedAt, lastAccessedAt, expiresAt, byteSize',
} as const

export class NostrGraphDexie extends Dexie {
  rawEvents!: Table<RawEventRecord, string>
  replaceableHeads!: Table<ReplaceableHeadRecord, ReplaceableHeadKey>
  addressableHeads!: Table<AddressableHeadRecord, AddressableHeadKey>
  profiles!: Table<ProfileRecord, string>
  contactLists!: Table<ContactListRecord, string>
  inboundRefs!: Table<InboundRefRecord, string>
  zaps!: Table<ZapRecord, string>
  imageVariants!: Table<ImageVariantRecord, [string, number]>

  public constructor(name = NOSTR_GRAPH_DB_NAME) {
    super(name)

    this.version(1).stores(NOSTR_GRAPH_DB_SCHEMA_V1)
    this.version(2).stores(NOSTR_GRAPH_DB_SCHEMA_V2)
    this.version(3)
      .stores(NOSTR_GRAPH_DB_SCHEMA_V3)
      .upgrade((tx) => tx.table('avatarCache').clear())
    this.version(4)
      .stores(NOSTR_GRAPH_DB_SCHEMA_V4)
      .upgrade((tx) => tx.table('imageVariants').clear())
  }
}

export function createNostrGraphDatabase(name?: string): NostrGraphDexie {
  return new NostrGraphDexie(name)
}
