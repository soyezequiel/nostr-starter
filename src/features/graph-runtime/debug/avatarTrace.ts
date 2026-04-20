const HASH_SEED = 0x811c9dc5
const HASH_PRIME = 0x01000193
const URL_TAIL_LENGTH = 48

export interface AvatarTraceConfig {
  includeRawUrls: boolean
  verbose: boolean
}

export interface AvatarUrlTraceSummary {
  hash: string
  host: string | null
  tail: string
  length: number
  rawUrl?: string
}

type AvatarTraceDetails = Record<string, unknown> | (() => Record<string, unknown>)

type AvatarTraceEnvName =
  | 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATARS'
  | 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_URLS'
  | 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_VERBOSE'

const readEnvFlag = (name: AvatarTraceEnvName) => {
  if (typeof process === 'undefined') {
    return false
  }

  switch (name) {
    case 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATARS':
      return process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_AVATARS === '1'
    case 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_URLS':
      return process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_URLS === '1'
    case 'NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_VERBOSE':
      return process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_VERBOSE === '1'
  }

  return false
}

export function getAvatarTraceConfig(): AvatarTraceConfig | null {
  if (!readEnvFlag('NEXT_PUBLIC_GRAPH_V2_TRACE_AVATARS')) {
    return null
  }

  return {
    includeRawUrls: readEnvFlag('NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_URLS'),
    verbose: readEnvFlag('NEXT_PUBLIC_GRAPH_V2_TRACE_AVATAR_VERBOSE'),
  }
}

export function isAvatarTraceEnabled(): boolean {
  return getAvatarTraceConfig() !== null
}

export function isAvatarTraceVerbose(): boolean {
  return getAvatarTraceConfig()?.verbose ?? false
}

export const truncateAvatarPubkey = (pubkey: string | null | undefined) => {
  const value = pubkey?.trim() ?? ''
  return value.length <= 16 ? value : `${value.slice(0, 12)}...${value.slice(-8)}`
}

export const hashAvatarTraceValue = (value: string | null | undefined) => {
  let hash = HASH_SEED
  const input = value ?? ''
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, HASH_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function summarizeAvatarUrl(
  url: string | null | undefined,
): AvatarUrlTraceSummary | null {
  const config = getAvatarTraceConfig()
  const value = url?.trim() ?? ''
  if (!value) {
    return null
  }

  let host: string | null = null
  let tail = value.slice(-URL_TAIL_LENGTH)
  try {
    const parsed = new URL(value)
    host = parsed.host || null
    tail = `${parsed.pathname}${parsed.search}`.slice(-URL_TAIL_LENGTH)
  } catch {
    // Keep a hashed tail for non-URL values; callers still get stable identity.
  }

  return {
    hash: hashAvatarTraceValue(value),
    host,
    tail,
    length: value.length,
    ...(config?.includeRawUrls ? { rawUrl: value } : {}),
  }
}

export function summarizeAvatarUrlKey(urlKey: string | null | undefined) {
  const value = urlKey?.trim() ?? ''
  if (!value) {
    return null
  }

  const separatorIndex = value.indexOf('::')
  const pubkey =
    separatorIndex >= 0 ? value.slice(0, separatorIndex) : null
  const url = separatorIndex >= 0 ? value.slice(separatorIndex + 2) : value

  return {
    hash: hashAvatarTraceValue(value),
    pubkey,
    pubkeyShort: truncateAvatarPubkey(pubkey),
    url: summarizeAvatarUrl(url),
  }
}

export function summarizeAvatarPictureTransition(
  previousPicture: string | null | undefined,
  nextPicture: string | null | undefined,
) {
  const previous = previousPicture?.trim() || null
  const next = nextPicture?.trim() || null
  const changed = previous !== next

  return {
    pictureChanged: changed,
    pictureChangeKind:
      !changed
        ? 'unchanged'
        : previous && next
          ? 'replaced'
          : previous
            ? 'cleared'
            : 'set',
    hadPreviousPicture: Boolean(previous),
    hasNextPicture: Boolean(next),
    previousPicture: summarizeAvatarUrl(previous),
    nextPicture: summarizeAvatarUrl(next),
  }
}

export function summarizeAvatarPubkeys(
  pubkeys: readonly string[],
  sampleSize = 12,
) {
  const sample = pubkeys.slice(0, sampleSize)
  return {
    count: pubkeys.length,
    sample,
    sampleShort: sample.map(truncateAvatarPubkey),
  }
}

export function traceAvatarFlow(
  stage: string,
  details: AvatarTraceDetails = {},
): void {
  const config = getAvatarTraceConfig()
  if (!config) {
    return
  }

  const resolvedDetails =
    typeof details === 'function' ? details() : details

  console.info(`[graph-v2:trace-avatar] ${stage}`, {
    stage,
    verbose: config.verbose,
    rawUrls: config.includeRawUrls,
    ...resolvedDetails,
  })
}

export function traceAvatarVerboseFlow(
  stage: string,
  details: AvatarTraceDetails = {},
): void {
  if (!isAvatarTraceVerbose()) {
    return
  }

  traceAvatarFlow(stage, details)
}
