import { zipSync } from 'fflate'

import { canonicalJson, encodeUtf8 } from '@/features/graph/export/canonical'
import type {
  FrozenSnapshot,
  ProfilePhotoArchiveEntry,
  ProfilePhotoArchiveManifest,
  ProfilePhotoArchiveResult,
} from '@/features/graph/export/types'
import { isSafeAvatarUrl } from '@/features/graph/render/avatar'
import { resolveAvatarFetchUrl } from '@/features/graph/render/avatarProxyUrl'

const ZIP_FIXED_DATE = new Date('1980-01-02T00:00:00Z')
const DEFAULT_FETCH_CONCURRENCY = 4
const PROXY_FALLBACK_BUCKET = 1024

interface ProfilePhotoCandidate {
  pubkey: string
  label: string | null
  sourceUrl: string | null
}

type FetchOutcome =
  | {
      status: 'downloaded'
      blob: Blob
      mimeType: string | null
      fetchedVia: 'direct' | 'proxy'
    }
  | {
      status: 'failed'
      reason: string
    }

export interface BuildProfilePhotoArchiveOptions {
  fetchImpl?: typeof fetch
  concurrency?: number
}

export async function buildProfilePhotoArchive(
  snapshot: FrozenSnapshot,
  options: BuildProfilePhotoArchiveOptions = {},
): Promise<ProfilePhotoArchiveResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_FETCH_CONCURRENCY)
  const candidates = collectProfilePhotoCandidates(snapshot)
  const candidatesWithSource = candidates.filter(
    (candidate) => typeof candidate.sourceUrl === 'string' && candidate.sourceUrl.length > 0,
  )

  if (candidatesWithSource.length === 0) {
    throw new Error('No hay fotos de perfil descubiertas para descargar.')
  }

  const fetchCache = new Map<string, Promise<FetchOutcome>>()
  const entries: ProfilePhotoArchiveEntry[] = new Array(candidates.length)

  await runWithConcurrency(candidates, concurrency, async (candidate, index) => {
    entries[index] = await buildArchiveEntry(candidate, fetchImpl, fetchCache)
  })

  const files: Record<string, Uint8Array<ArrayBuffer>> = {}
  for (const entry of entries) {
    if (entry.status !== 'downloaded' || !entry.filePath || !entry.sourceUrl) {
      continue
    }

    const result = await fetchCache.get(entry.sourceUrl)
    if (!result || result.status !== 'downloaded') {
      continue
    }

    files[entry.filePath] = new Uint8Array(await result.blob.arrayBuffer())
  }

  const manifest = buildManifest(snapshot, entries)
  files['manifest.json'] = encodeUtf8(canonicalJson(manifest))

  const zipEntries: Record<string, [Uint8Array<ArrayBuffer>, { mtime: Date }]> = {}
  for (const path of Object.keys(files).sort()) {
    zipEntries[path] = [files[path], { mtime: ZIP_FIXED_DATE }]
  }

  const zipped = zipSync(zipEntries)
  const blob = new Blob([zipped.slice().buffer as ArrayBuffer], {
    type: 'application/zip',
  })

  return {
    blob,
    filename: `nostr-profile-photos-${snapshot.captureId}.zip`,
    manifest,
  }
}

function collectProfilePhotoCandidates(
  snapshot: FrozenSnapshot,
): ProfilePhotoCandidate[] {
  const nodesByPubkey = new Map(snapshot.nodes.map((node) => [node.pubkey, node]))
  const pubkeys = [...snapshot.users.keys()].sort()

  return pubkeys.map((pubkey) => {
    const user = snapshot.users.get(pubkey)!
    const node = nodesByPubkey.get(pubkey)

    return {
      pubkey,
      label: user.profile?.name ?? node?.label ?? null,
      sourceUrl: user.profile?.picture ?? node?.picture ?? null,
    }
  })
}

async function buildArchiveEntry(
  candidate: ProfilePhotoCandidate,
  fetchImpl: typeof fetch,
  fetchCache: Map<string, Promise<FetchOutcome>>,
): Promise<ProfilePhotoArchiveEntry> {
  if (!candidate.sourceUrl) {
    return {
      pubkey: candidate.pubkey,
      label: candidate.label,
      sourceUrl: null,
      status: 'skipped',
      filePath: null,
      mimeType: null,
      byteSize: null,
      fetchedVia: null,
      reason: 'missing-picture',
    }
  }

  if (!isSafeAvatarUrl(candidate.sourceUrl)) {
    return {
      pubkey: candidate.pubkey,
      label: candidate.label,
      sourceUrl: candidate.sourceUrl,
      status: 'skipped',
      filePath: null,
      mimeType: null,
      byteSize: null,
      fetchedVia: null,
      reason: 'unsafe-url',
    }
  }

  let outcomePromise = fetchCache.get(candidate.sourceUrl)
  if (!outcomePromise) {
    outcomePromise = fetchProfilePhoto(candidate.sourceUrl, fetchImpl)
    fetchCache.set(candidate.sourceUrl, outcomePromise)
  }

  const outcome = await outcomePromise
  if (outcome.status === 'failed') {
    return {
      pubkey: candidate.pubkey,
      label: candidate.label,
      sourceUrl: candidate.sourceUrl,
      status: 'failed',
      filePath: null,
      mimeType: null,
      byteSize: null,
      fetchedVia: null,
      reason: outcome.reason,
    }
  }

  const extension = resolveFileExtension(candidate.sourceUrl, outcome.mimeType)

  return {
    pubkey: candidate.pubkey,
    label: candidate.label,
    sourceUrl: candidate.sourceUrl,
    status: 'downloaded',
    filePath: `usuarios/${candidate.pubkey}/profile-photo.${extension}`,
    mimeType: outcome.mimeType,
    byteSize: outcome.blob.size,
    fetchedVia: outcome.fetchedVia,
    reason: null,
  }
}

async function fetchProfilePhoto(
  sourceUrl: string,
  fetchImpl: typeof fetch,
): Promise<FetchOutcome> {
  try {
    const directResponse = await fetchBlob(fetchImpl, sourceUrl)
    return {
      status: 'downloaded',
      blob: directResponse.blob,
      mimeType: directResponse.mimeType,
      fetchedVia: 'direct',
    }
  } catch (directError) {
    try {
      const proxyUrl = resolveAvatarFetchUrl(
        sourceUrl,
        'wsrv',
        PROXY_FALLBACK_BUCKET,
      )
      const proxyResponse = await fetchBlob(fetchImpl, proxyUrl)
      return {
        status: 'downloaded',
        blob: proxyResponse.blob,
        mimeType: proxyResponse.mimeType,
        fetchedVia: 'proxy',
      }
    } catch (proxyError) {
      return {
        status: 'failed',
        reason: buildFetchFailureReason(directError, proxyError),
      }
    }
  }
}

async function fetchBlob(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, {
    cache: 'force-cache',
    credentials: 'omit',
    mode: 'cors',
    referrerPolicy: 'no-referrer',
  })

  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}.`)
  }

  const blob = await response.blob()
  return {
    blob,
    mimeType: blob.type || response.headers.get('content-type') || null,
  }
}

function buildManifest(
  snapshot: FrozenSnapshot,
  entries: ProfilePhotoArchiveEntry[],
): ProfilePhotoArchiveManifest {
  const downloadedPhotoCount = entries.filter((entry) => entry.status === 'downloaded').length
  const skippedPhotoCount = entries.filter((entry) => entry.status === 'skipped').length
  const failedPhotoCount = entries.filter((entry) => entry.status === 'failed').length

  return {
    formatVersion: 1,
    artifact: 'profile-photos',
    captureId: snapshot.captureId,
    capturedAt: snapshot.capturedAtIso,
    discoveredUserCount: snapshot.users.size,
    candidatePhotoCount: entries.filter((entry) => entry.sourceUrl !== null).length,
    downloadedPhotoCount,
    skippedPhotoCount,
    failedPhotoCount,
    entries,
  }
}

function resolveFileExtension(sourceUrl: string, mimeType: string | null): string {
  const mimeExtension = mimeType ? MIME_TYPE_EXTENSION_MAP[mimeType.toLowerCase()] : undefined
  if (mimeExtension) {
    return mimeExtension
  }

  try {
    const parsedUrl = new URL(sourceUrl)
    const pathname = parsedUrl.pathname.toLowerCase()
    for (const extension of KNOWN_FILE_EXTENSIONS) {
      if (pathname.endsWith(`.${extension}`)) {
        return extension
      }
    }
  } catch {
    // Ignore malformed URLs here; the caller already validated the scheme.
  }

  return 'img'
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const nextIndex = cursor
      cursor += 1
      await worker(items[nextIndex], nextIndex)
    }
  })

  await Promise.all(runners)
}

function buildFetchFailureReason(directError: unknown, proxyError: unknown): string {
  const directMessage = readErrorMessage(directError)
  const proxyMessage = readErrorMessage(proxyError)

  if (directMessage === proxyMessage) {
    return directMessage
  }

  return `${directMessage} Proxy fallback failed: ${proxyMessage}`
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'No se pudo descargar la foto.'
}

const MIME_TYPE_EXTENSION_MAP: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

const KNOWN_FILE_EXTENSIONS = [
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
] as const
