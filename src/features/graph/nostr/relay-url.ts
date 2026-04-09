import { createRelayAdapterError } from './errors'
import type { RelayUrlValidationOptions } from './types'

const IPV4_SEGMENT_COUNT = 4

export function normalizeRelayUrl(
  rawUrl: string,
  options: RelayUrlValidationOptions = {},
): string {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    throw createRelayAdapterError({
      code: 'RELAY_URL_INVALID',
      message: 'Relay URL is not a valid URL.',
      retryable: false,
      details: { rawUrl },
    })
  }

  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    throw createRelayAdapterError({
      code: 'RELAY_URL_INVALID',
      message: 'Relay URL must use ws:// or wss://.',
      retryable: false,
      details: { rawUrl },
    })
  }

  if (parsed.protocol === 'ws:' && !options.allowInsecureWs) {
    throw createRelayAdapterError({
      code: 'RELAY_URL_INVALID',
      message: 'Insecure ws:// relay URLs are blocked by default.',
      retryable: false,
      details: { rawUrl },
    })
  }

  if (isLocalOrPrivateHost(parsed.hostname) && !options.allowLocalAddresses) {
    throw createRelayAdapterError({
      code: 'RELAY_URL_INVALID',
      message: 'Local or private relay URLs are blocked by default.',
      retryable: false,
      details: { rawUrl },
    })
  }

  parsed.hash = ''
  parsed.search = ''

  const normalizedPath =
    parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')

  return `${parsed.protocol}//${parsed.host}${normalizedPath}`
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true
  }

  if (normalized.includes(':')) {
    return isPrivateIpv6(normalized)
  }

  const segments = normalized.split('.')

  if (segments.length === IPV4_SEGMENT_COUNT && segments.every(isIpv4Segment)) {
    return isPrivateIpv4(segments.map(Number))
  }

  return !normalized.includes('.')
}

function isIpv4Segment(value: string): boolean {
  const numeric = Number(value)
  return value.length > 0 && Number.isInteger(numeric) && numeric >= 0 && numeric <= 255
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6(hostname: string): boolean {
  return (
    hostname === '::1' ||
    hostname.startsWith('fe8') ||
    hostname.startsWith('fe9') ||
    hostname.startsWith('fea') ||
    hostname.startsWith('feb') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd')
  )
}
