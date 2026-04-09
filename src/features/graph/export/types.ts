import type { GraphCaps, GraphLink, GraphNode } from '@/features/graph/app/store/types'
import type {
  AddressableHeadRecord,
  ContactListRecord,
  InboundRefRecord,
  ProfileRecord,
  RawEventRecord,
  ReplaceableHeadRecord,
  ZapRecord,
} from '@/features/graph/db/entities'

export interface FrozenUserData {
  pubkey: string
  profile: ProfileRecord | null
  contactList: ContactListRecord | null
  replaceableHeads: ReplaceableHeadRecord[]
  addressableHeads: AddressableHeadRecord[]
  rawEvents: RawEventRecord[]
  zapsSent: ZapRecord[]
  zapsReceived: ZapRecord[]
  inboundRefs: InboundRefRecord[]
}

export interface FrozenSnapshot {
  captureId: string
  capturedAtIso: string
  captureUpperBoundSec: number
  executionMode: 'snapshot'
  relays: string[]
  graphCaps: GraphCaps
  nodes: GraphNode[]
  links: GraphLink[]
  adjacency: Record<string, string[]>
  users: Map<string, FrozenUserData>
}

export interface ExportManifest {
  formatVersion: number
  captureProfileId: string
  captureProfileHash: string
  captureId: string
  capturedAt: string
  captureUpperBoundSec: number
  executionMode: 'snapshot'
  relays: string[]
  graphCaps: GraphCaps
  nodeCount: number
  linkCount: number
  userCount: number
  partNumber: number
  partCount: number | null
  userPubkeys: string[]
  oversizedUserPart?: boolean
}

export interface UserResumen {
  pubkey: string
  captureScope: 'snapshot'
  profile: {
    name: string | null
    about: string | null
    picture: string | null
    nip05: string | null
    lud16: string | null
  } | null
  followCount: number
  followerDiscoveredCount: number
  mutualDiscoveredCount: number
  rawEventCount: number
  zapsSentCount: number
  zapsReceivedCount: number
  inboundRefCount: number
}

export interface ArchiveResult {
  blob: Blob
  filename: string
  manifest: ExportManifest
}

export interface MultipartArchiveResult {
  parts: ArchiveResult[]
  totalUserCount: number
  captureId: string
}

export type ProfilePhotoArchiveEntryStatus =
  | 'downloaded'
  | 'skipped'
  | 'failed'

export interface ProfilePhotoArchiveEntry {
  pubkey: string
  label: string | null
  sourceUrl: string | null
  status: ProfilePhotoArchiveEntryStatus
  filePath: string | null
  mimeType: string | null
  byteSize: number | null
  fetchedVia: 'direct' | 'proxy' | null
  reason: string | null
}

export interface ProfilePhotoArchiveManifest {
  formatVersion: number
  artifact: 'profile-photos'
  captureId: string
  capturedAt: string
  discoveredUserCount: number
  candidatePhotoCount: number
  downloadedPhotoCount: number
  skippedPhotoCount: number
  failedPhotoCount: number
  entries: ProfilePhotoArchiveEntry[]
}

export interface ProfilePhotoArchiveResult {
  blob: Blob
  filename: string
  manifest: ProfilePhotoArchiveManifest
}
