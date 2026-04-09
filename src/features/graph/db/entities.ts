export type CaptureScope = 'snapshot' | 'deep'

export type NostrTag = string[]

export interface RawEventRecord {
  id: string
  pubkey: string
  kind: number
  createdAt: number
  fetchedAt: number
  firstSeenAt: number
  lastSeenAt: number
  relayUrls: string[]
  tags: NostrTag[]
  content: string
  sig: string
  rawJson: string
  dTag: string | null
  captureScope: CaptureScope
}

export interface RawEventInput extends Omit<RawEventRecord, 'firstSeenAt' | 'lastSeenAt'> {
  firstSeenAt?: number
  lastSeenAt?: number
}

export type ReplaceableHeadKey = [pubkey: string, kind: number]

export interface ReplaceableHeadRecord {
  pubkey: string
  kind: number
  eventId: string
  createdAt: number
  tieBreakKey: string
  updatedAt: number
}

export type AddressableHeadKey = [pubkey: string, kind: number, dTag: string]

export interface AddressableHeadRecord {
  pubkey: string
  kind: number
  dTag: string
  eventId: string
  createdAt: number
  tieBreakKey: string
  updatedAt: number
}

export interface ProfileRecord {
  pubkey: string
  eventId: string
  createdAt: number
  fetchedAt: number
  name: string | null
  about: string | null
  picture: string | null
  nip05: string | null
  lud16: string | null
}

export interface ContactListRecord {
  pubkey: string
  eventId: string
  createdAt: number
  fetchedAt: number
  follows: string[]
  relayHints: string[]
}

export type InboundRelationType =
  | 'mention'
  | 'reply'
  | 'repost'
  | 'reaction'
  | 'comment'
  | 'zap'
  | 'unknown'

export interface InboundRefRecord {
  eventId: string
  targetPubkey: string
  kind: number
  createdAt: number
  fetchedAt: number
  relayUrls: string[]
  relationType: InboundRelationType
}

export interface ZapRecord {
  id: string
  fromPubkey: string
  toPubkey: string
  sats: number
  createdAt: number
  fetchedAt: number
  bolt11: string | null
  eventRef: string | null
}

export interface ImageVariantRecord {
  cacheKey: string
  sourceUrl: string
  bucket: number
  fetchedAt: number
  lastAccessedAt: number
  expiresAt: number
  byteSize: number
  mimeType: string
  width: number
  height: number
  blob: Blob
}
