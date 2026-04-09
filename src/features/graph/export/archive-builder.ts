import { zipSync } from 'fflate'

import { canonicalJson, canonicalNdjson, encodeUtf8, sha256Hex } from '@/features/graph/export/canonical'
import type {
  ArchiveResult,
  ExportManifest,
  FrozenSnapshot,
  FrozenUserData,
  MultipartArchiveResult,
  UserResumen,
} from '@/features/graph/export/types'
import type { RawEventRecord } from '@/features/graph/db/entities'

import captureProfileV1 from '@/features/graph/export/capture-profile-v1.json'

// Use Jan 2 to avoid 1979 rollback in negative-UTC-offset timezones.
// fflate converts mtime to local time internally; DOS timestamps start at 1980-01-01.
const ZIP_FIXED_DATE = new Date('1980-01-02T00:00:00Z')

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 67_108_864 // 64 MB

export interface FileTree {
  files: Record<string, Uint8Array<ArrayBuffer>>
  manifest: ExportManifest
}

export async function buildFileTree(
  snapshot: FrozenSnapshot,
): Promise<FileTree> {
  const files: Record<string, Uint8Array<ArrayBuffer>> = {}

  const captureProfileBytes = encodeUtf8(canonicalJson(captureProfileV1))
  const captureProfileHash = await sha256Hex(captureProfileBytes)

  files['capture-profile.json'] = captureProfileBytes

  addGraphFiles(files, snapshot)

  const pubkeys = [...snapshot.users.keys()].sort()

  for (const pubkey of pubkeys) {
    const userData = snapshot.users.get(pubkey)!
    addUserFiles(files, pubkey, userData, snapshot)
  }

  const manifest: ExportManifest = {
    formatVersion: 1,
    captureProfileId: 'capture-profile-v1',
    captureProfileHash,
    captureId: snapshot.captureId,
    capturedAt: snapshot.capturedAtIso,
    captureUpperBoundSec: snapshot.captureUpperBoundSec,
    executionMode: 'snapshot',
    relays: snapshot.relays,
    graphCaps: snapshot.graphCaps,
    nodeCount: snapshot.nodes.length,
    linkCount: snapshot.links.length,
    userCount: pubkeys.length,
    partNumber: 1,
    partCount: 1,
    userPubkeys: pubkeys,
  }

  files['manifest.json'] = encodeUtf8(canonicalJson(manifest))

  return { files, manifest }
}

export function zipFileTree(fileTree: FileTree): Blob {
  const zipEntries: Record<string, [Uint8Array<ArrayBuffer>, { mtime: Date }]> = {}
  const sortedPaths = Object.keys(fileTree.files).sort()

  for (const path of sortedPaths) {
    zipEntries[path] = [fileTree.files[path], { mtime: ZIP_FIXED_DATE }]
  }

  const zipped = zipSync(zipEntries)
  const trimmed = zipped.slice()
  return new Blob([trimmed.buffer as ArrayBuffer], { type: 'application/zip' })
}

export async function buildSnapshotArchive(
  snapshot: FrozenSnapshot,
): Promise<ArchiveResult> {
  const fileTree = await buildFileTree(snapshot)
  const blob = zipFileTree(fileTree)
  const filename = `nostr-archive-${snapshot.captureId}-part-001.zip`

  return { blob, filename, manifest: fileTree.manifest }
}

// --- Multipart export ---

export function buildUserFileTree(
  pubkey: string,
  userData: FrozenUserData,
  snapshot: FrozenSnapshot,
): Record<string, Uint8Array<ArrayBuffer>> {
  const files: Record<string, Uint8Array<ArrayBuffer>> = {}
  addUserFiles(files, pubkey, userData, snapshot)
  return files
}

export function estimateUncompressedSize(
  files: Record<string, Uint8Array<ArrayBuffer>>,
): number {
  let total = 0
  for (const key in files) {
    total += files[key].byteLength
  }
  return total
}

function formatPartNumber(n: number): string {
  return String(n).padStart(3, '0')
}

function buildPartManifest(
  base: Omit<ExportManifest, 'partNumber' | 'partCount' | 'userPubkeys' | 'oversizedUserPart'>,
  partNumber: number,
  partCount: number,
  userPubkeys: string[],
  oversizedUserPart?: boolean,
): ExportManifest {
  const manifest: ExportManifest = {
    ...base,
    partNumber,
    partCount,
    userPubkeys,
  }
  if (oversizedUserPart) {
    manifest.oversizedUserPart = true
  }
  return manifest
}

export interface MultipartBuildOptions {
  maxUncompressedBytes?: number
  onPartBuilt?: (partNumber: number, totalPartsSoFar: number) => void
}

export async function buildMultipartArchive(
  snapshot: FrozenSnapshot,
  options?: MultipartBuildOptions,
): Promise<MultipartArchiveResult> {
  const maxBytes = options?.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES
  const onPartBuilt = options?.onPartBuilt

  const captureProfileBytes = encodeUtf8(canonicalJson(captureProfileV1))
  const captureProfileHash = await sha256Hex(captureProfileBytes)

  // Shared files: capture-profile + graph (always in part-001)
  const sharedFiles: Record<string, Uint8Array<ArrayBuffer>> = {}
  sharedFiles['capture-profile.json'] = captureProfileBytes
  addGraphFiles(sharedFiles, snapshot)
  const sharedSize = estimateUncompressedSize(sharedFiles)

  // Build all user file trees and estimate sizes
  const pubkeys = [...snapshot.users.keys()].sort()
  const userFileTrees: { pubkey: string; files: Record<string, Uint8Array<ArrayBuffer>>; size: number }[] = []

  for (const pubkey of pubkeys) {
    const userData = snapshot.users.get(pubkey)!
    const files = buildUserFileTree(pubkey, userData, snapshot)
    userFileTrees.push({ pubkey, files, size: estimateUncompressedSize(files) })
  }

  // Partition users into parts
  // Part 1 starts with shared files (sharedSize already accounted for)
  const partitions: { userPubkeys: string[]; files: Record<string, Uint8Array<ArrayBuffer>>; oversized: boolean }[] = []

  let currentPartFiles: Record<string, Uint8Array<ArrayBuffer>> = { ...sharedFiles }
  let currentPartSize = sharedSize
  let currentPartPubkeys: string[] = []
  let isFirstPart = true

  for (const { pubkey, files: userFiles, size: userSize } of userFileTrees) {
    // If a single user exceeds the budget, give them their own part
    if (userSize > maxBytes) {
      // Flush current part if it has any users (or is first part with shared files)
      if (currentPartPubkeys.length > 0 || isFirstPart) {
        partitions.push({
          userPubkeys: currentPartPubkeys,
          files: currentPartFiles,
          oversized: false,
        })
        isFirstPart = false
      }

      // Oversized user gets their own part
      partitions.push({
        userPubkeys: [pubkey],
        files: { ...userFiles },
        oversized: true,
      })

      // Start a fresh part for next users
      currentPartFiles = {}
      currentPartSize = 0
      currentPartPubkeys = []
      continue
    }

    // Would adding this user exceed the budget?
    if (currentPartSize + userSize > maxBytes && currentPartPubkeys.length > 0) {
      // Flush current part
      partitions.push({
        userPubkeys: currentPartPubkeys,
        files: currentPartFiles,
        oversized: false,
      })
      isFirstPart = false

      // Start new part
      currentPartFiles = {}
      currentPartSize = 0
      currentPartPubkeys = []
    }

    // If this is the very first part and it has no users yet but shared files haven't been flushed,
    // the shared files are already in currentPartFiles
    if (isFirstPart && currentPartPubkeys.length === 0 && Object.keys(currentPartFiles).length === 0) {
      // This shouldn't happen because we initialize with sharedFiles, but be safe
      Object.assign(currentPartFiles, sharedFiles)
      currentPartSize = sharedSize
    }

    // Add user files to current part
    Object.assign(currentPartFiles, userFiles)
    currentPartSize += userSize
    currentPartPubkeys.push(pubkey)
  }

  // Flush remaining part (or part-001 if no users at all)
  if (currentPartPubkeys.length > 0 || isFirstPart) {
    partitions.push({
      userPubkeys: currentPartPubkeys,
      files: currentPartFiles,
      oversized: false,
    })
  }

  // Build manifests and ZIPs
  const partCount = partitions.length
  const baseManifest: Omit<ExportManifest, 'partNumber' | 'partCount' | 'userPubkeys' | 'oversizedUserPart'> = {
    formatVersion: 1,
    captureProfileId: 'capture-profile-v1',
    captureProfileHash,
    captureId: snapshot.captureId,
    capturedAt: snapshot.capturedAtIso,
    captureUpperBoundSec: snapshot.captureUpperBoundSec,
    executionMode: 'snapshot',
    relays: snapshot.relays,
    graphCaps: snapshot.graphCaps,
    nodeCount: snapshot.nodes.length,
    linkCount: snapshot.links.length,
    userCount: pubkeys.length,
  }

  const parts: ArchiveResult[] = []

  for (let i = 0; i < partitions.length; i++) {
    const partition = partitions[i]
    const partNumber = i + 1

    const manifest = buildPartManifest(
      baseManifest,
      partNumber,
      partCount,
      partition.userPubkeys,
      partition.oversized || undefined,
    )

    const allFiles = { ...partition.files }
    allFiles['manifest.json'] = encodeUtf8(canonicalJson(manifest))

    const fileTree: FileTree = { files: allFiles, manifest }
    const blob = zipFileTree(fileTree)
    const filename = `nostr-archive-${snapshot.captureId}-part-${formatPartNumber(partNumber)}.zip`

    parts.push({ blob, filename, manifest })

    onPartBuilt?.(partNumber, partCount)
  }

  return { parts, totalUserCount: pubkeys.length, captureId: snapshot.captureId }
}

function addGraphFiles(
  files: Record<string, Uint8Array>,
  snapshot: FrozenSnapshot,
): void {
  const nodesData = snapshot.nodes.map((n) => ({
    pubkey: n.pubkey,
    label: n.label ?? null,
    source: n.source,
    discoveredAt: n.discoveredAt,
    keywordHits: n.keywordHits,
  }))

  const linksData = snapshot.links.map((l) => ({
    source: l.source,
    target: l.target,
    relation: l.relation,
    weight: l.weight ?? null,
  }))

  files['grafo/nodes.json'] = encodeUtf8(canonicalJson(nodesData))
  files['grafo/links.json'] = encodeUtf8(canonicalJson(linksData))
  files['grafo/adjacency.json'] = encodeUtf8(canonicalJson(snapshot.adjacency))
}

function addUserFiles(
  files: Record<string, Uint8Array>,
  pubkey: string,
  user: FrozenUserData,
  snapshot: FrozenSnapshot,
): void {
  const base = `usuarios/${pubkey}`

  files[`${base}/resumen.json`] = encodeUtf8(
    canonicalJson(buildResumen(pubkey, user, snapshot)),
  )

  addCanonicalFiles(files, base, user)
  addRawFiles(files, base, user)
  addGraphUserFiles(files, base, pubkey, user, snapshot)
}

function buildResumen(
  pubkey: string,
  user: FrozenUserData,
  snapshot: FrozenSnapshot,
): UserResumen {
  const adjacency = snapshot.adjacency
  const followCount = user.contactList?.follows.length ?? 0

  const followersDiscovered = Object.entries(adjacency).filter(
    ([src, neighbors]) => src !== pubkey && neighbors.includes(pubkey),
  ).length

  const following = new Set(adjacency[pubkey] ?? [])
  const mutualsDiscovered = Object.entries(adjacency).filter(
    ([src, neighbors]) =>
      src !== pubkey && neighbors.includes(pubkey) && following.has(src),
  ).length

  return {
    pubkey,
    captureScope: 'snapshot',
    profile: user.profile
      ? {
          name: user.profile.name,
          about: user.profile.about,
          picture: user.profile.picture,
          nip05: user.profile.nip05,
          lud16: user.profile.lud16,
        }
      : null,
    followCount,
    followerDiscoveredCount: followersDiscovered,
    mutualDiscoveredCount: mutualsDiscovered,
    rawEventCount: user.rawEvents.length,
    zapsSentCount: user.zapsSent.length,
    zapsReceivedCount: user.zapsReceived.length,
    inboundRefCount: user.inboundRefs.length,
  }
}

function addCanonicalFiles(
  files: Record<string, Uint8Array>,
  base: string,
  user: FrozenUserData,
): void {
  files[`${base}/canonical/profile.json`] = encodeUtf8(
    canonicalJson(
      user.profile
        ? {
            pubkey: user.profile.pubkey,
            eventId: user.profile.eventId,
            createdAt: user.profile.createdAt,
            name: user.profile.name,
            about: user.profile.about,
            picture: user.profile.picture,
            nip05: user.profile.nip05,
            lud16: user.profile.lud16,
          }
        : null,
    ),
  )

  files[`${base}/canonical/contact-list.json`] = encodeUtf8(
    canonicalJson(
      user.contactList
        ? {
            pubkey: user.contactList.pubkey,
            eventId: user.contactList.eventId,
            createdAt: user.contactList.createdAt,
            follows: user.contactList.follows,
            relayHints: user.contactList.relayHints,
          }
        : null,
    ),
  )

  const relayListHead = user.replaceableHeads.find((h) => h.kind === 10002)
  const relayListEvent = relayListHead
    ? user.rawEvents.find((e) => e.id === relayListHead.eventId)
    : null

  files[`${base}/canonical/relay-list.json`] = encodeUtf8(
    canonicalJson(
      relayListEvent
        ? {
            pubkey: relayListEvent.pubkey,
            eventId: relayListEvent.id,
            createdAt: relayListEvent.createdAt,
            tags: relayListEvent.tags,
          }
        : null,
    ),
  )

  files[`${base}/canonical/replaceable-index.json`] = encodeUtf8(
    canonicalJson(
      user.replaceableHeads.map((h) => ({
        pubkey: h.pubkey,
        kind: h.kind,
        eventId: h.eventId,
        createdAt: h.createdAt,
      })),
    ),
  )

  files[`${base}/canonical/addressable-index.json`] = encodeUtf8(
    canonicalJson(
      user.addressableHeads.map((h) => ({
        pubkey: h.pubkey,
        kind: h.kind,
        dTag: h.dTag,
        eventId: h.eventId,
        createdAt: h.createdAt,
      })),
    ),
  )
}

function addRawFiles(
  files: Record<string, Uint8Array>,
  base: string,
  user: FrozenUserData,
): void {
  const sortedEvents = [...user.rawEvents].sort(compareRawForExport)

  files[`${base}/raw/all-events.ndjson`] = encodeUtf8(
    canonicalNdjson(sortedEvents.map(rawEventToExportRecord)),
  )

  const byKind = new Map<number, RawEventRecord[]>()

  for (const event of sortedEvents) {
    let kindEvents = byKind.get(event.kind)

    if (!kindEvents) {
      kindEvents = []
      byKind.set(event.kind, kindEvents)
    }

    kindEvents.push(event)
  }

  const sortedKinds = [...byKind.keys()].sort((a, b) => a - b)

  for (const kind of sortedKinds) {
    const kindEvents = byKind.get(kind)!
    files[`${base}/raw/by-kind/kind-${kind}.ndjson`] = encodeUtf8(
      canonicalNdjson(kindEvents.map(rawEventToExportRecord)),
    )
  }
}

function addGraphUserFiles(
  files: Record<string, Uint8Array>,
  base: string,
  pubkey: string,
  user: FrozenUserData,
  snapshot: FrozenSnapshot,
): void {
  const outgoing = (snapshot.adjacency[pubkey] ?? []).sort()
  files[`${base}/graph/following.json`] = encodeUtf8(canonicalJson(outgoing))

  const incoming = Object.entries(snapshot.adjacency)
    .filter(([src, neighbors]) => src !== pubkey && neighbors.includes(pubkey))
    .map(([src]) => src)
    .sort()
  files[`${base}/graph/followers-discovered.json`] = encodeUtf8(
    canonicalJson(incoming),
  )

  const outgoingSet = new Set(outgoing)
  const mutuals = incoming.filter((p) => outgoingSet.has(p)).sort()
  files[`${base}/graph/mutuals-discovered.json`] = encodeUtf8(
    canonicalJson(mutuals),
  )

  void user
}

function rawEventToExportRecord(event: RawEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    createdAt: event.createdAt,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
    relayUrls: event.relayUrls,
  }
}

function compareRawForExport(a: RawEventRecord, b: RawEventRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  if (a.kind !== b.kind) return a.kind - b.kind
  return a.id.localeCompare(b.id)
}
