const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i
const DEFAULT_NIP05_TIMEOUT_MS = 5000

export interface NormalizedNip05Identifier {
  identifier: string
  name: string
  domain: string
}

export type Nip05ResolveResult =
  | {
      status: 'valid'
      input: string
      identifier: string
      name: string
      domain: string
      pubkey: string
      relays: string[]
      url: string
    }
  | {
      status: 'invalid'
      input: string
      code:
        | 'INVALID_NIP05'
        | 'NIP05_HTTP_ERROR'
        | 'NIP05_NOT_FOUND'
        | 'NIP05_INVALID_PUBKEY'
        | 'NIP05_TIMEOUT'
      message: string
    }

const hasWhitespace = (value: string) => /\s/.test(value)

const normalizeDomain = (domain: string) => {
  const normalizedDomain = domain.trim().toLowerCase()
  if (!normalizedDomain || hasWhitespace(normalizedDomain)) return null
  if (/[/?#]/.test(normalizedDomain)) return null

  try {
    const parsed = new URL(`https://${normalizedDomain}`)
    if (!parsed.hostname || parsed.username || parsed.password) return null
    return parsed.host
  } catch {
    return null
  }
}

export function normalizeNip05Identifier(
  input: string,
): NormalizedNip05Identifier | null {
  const normalizedInput = input.trim()
  if (!normalizedInput || hasWhitespace(normalizedInput)) return null
  if (/^https?:\/\//i.test(normalizedInput)) return null
  if (normalizedInput.includes('/')) return null

  if (normalizedInput.includes('@')) {
    const parts = normalizedInput.split('@')
    if (parts.length !== 2) return null

    const name = parts[0]?.trim().toLowerCase()
    const domain = normalizeDomain(parts[1] ?? '')
    if (!name || !domain) return null

    return {
      identifier: `${name}@${domain}`,
      name,
      domain,
    }
  }

  if (!normalizedInput.includes('.')) return null

  const domain = normalizeDomain(normalizedInput)
  if (!domain) return null

  return {
    identifier: `_@${domain}`,
    name: '_',
    domain,
  }
}

const readNip05Json = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return null

  const namesValue = (value as { names?: unknown }).names
  if (typeof namesValue !== 'object' || namesValue === null) return null

  const relaysValue = (value as { relays?: unknown }).relays

  return {
    names: namesValue as Record<string, unknown>,
    relays:
      typeof relaysValue === 'object' && relaysValue !== null
        ? (relaysValue as Record<string, unknown>)
        : null,
  }
}

const readRelayHints = (
  relays: Record<string, unknown> | null,
  pubkey: string,
) => {
  const relayHints = relays?.[pubkey]
  if (!Array.isArray(relayHints)) return []

  return Array.from(
    new Set(
      relayHints.filter(
        (relay): relay is string =>
          typeof relay === 'string' && relay.startsWith('wss://'),
      ),
    ),
  ).sort()
}

export async function resolveNip05Identifier(
  input: string,
  options: { timeoutMs?: number } = {},
): Promise<Nip05ResolveResult> {
  const normalized = normalizeNip05Identifier(input)
  const normalizedInput = input.trim()

  if (!normalized) {
    return {
      status: 'invalid',
      input: normalizedInput,
      code: 'INVALID_NIP05',
      message: 'NIP-05 invalido. Usa usuario@dominio.com o dominio.com.',
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_NIP05_TIMEOUT_MS
  const url = `https://${normalized.domain}/.well-known/nostr.json?name=${encodeURIComponent(normalized.name)}`
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        status: 'invalid',
        input: normalizedInput,
        code: 'NIP05_HTTP_ERROR',
        message: `NIP-05 respondio HTTP ${response.status}.`,
      }
    }

    const payload = readNip05Json(await response.json())
    if (!payload) {
      return {
        status: 'invalid',
        input: normalizedInput,
        code: 'NIP05_NOT_FOUND',
        message: 'Ese NIP-05 no publica una pubkey.',
      }
    }

    const pubkey = payload.names[normalized.name]

    if (typeof pubkey !== 'string') {
      return {
        status: 'invalid',
        input: normalizedInput,
        code: 'NIP05_NOT_FOUND',
        message: 'Ese NIP-05 no publica una pubkey.',
      }
    }

    if (!HEX_PUBKEY_PATTERN.test(pubkey)) {
      return {
        status: 'invalid',
        input: normalizedInput,
        code: 'NIP05_INVALID_PUBKEY',
        message: 'Ese NIP-05 publica una pubkey invalida.',
      }
    }

    const normalizedPubkey = pubkey.toLowerCase()

    return {
      status: 'valid',
      input: normalizedInput,
      identifier: normalized.identifier,
      name: normalized.name,
      domain: normalized.domain,
      pubkey: normalizedPubkey,
      relays: readRelayHints(payload.relays, normalizedPubkey),
      url,
    }
  } catch (error) {
    return {
      status: 'invalid',
      input: normalizedInput,
      code: 'NIP05_TIMEOUT',
      message:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'NIP-05 no respondio antes del timeout.'
          : 'No se pudo resolver ese NIP-05.',
    }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}
