import { nip19 } from 'nostr-tools'

import {
  normalizeNip05Identifier,
  resolveNip05Identifier,
} from '@/features/graph-runtime/nostr/nip05'

export type RootIdentitySource =
  | 'npub'
  | 'nprofile'
  | 'hex'
  | 'nip05'
  | 'session'
  | 'url'

export type RootIdentityConfidence =
  | 'cryptographic'
  | 'verified-alias'
  | 'local-session'
  | 'parsed-pointer'

export interface RootIdentityEvidence {
  normalizedInput?: string
  nip05?: string
  url?: string
}

export type RootIdentityResolution =
  | {
      status: 'empty'
    }
  | {
      status: 'valid'
      input: string
      source: RootIdentitySource
      pubkey: string
      relays: string[]
      confidence: RootIdentityConfidence
      evidence?: RootIdentityEvidence
    }
  | {
      status: 'invalid'
      input: string
      code:
        | 'INVALID_INPUT'
        | 'INVALID_NIP19'
        | 'UNSUPPORTED_NIP19_TYPE'
        | 'MULTIPLE_IDENTITIES'
        | 'INVALID_NIP05'
        | 'NIP05_HTTP_ERROR'
        | 'NIP05_NOT_FOUND'
        | 'NIP05_INVALID_PUBKEY'
        | 'NIP05_TIMEOUT'
      message: string
    }

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i
const NIP19_POINTER_PATTERN =
  /(nprofile1[023456789acdefghjklmnpqrstuvwxyz]+|npub1[023456789acdefghjklmnpqrstuvwxyz]+)/gi

const decodeNip19RootPointer = (input: string) => {
  try {
    const decoded = nip19.decodeNostrURI(input)

    if (decoded.type === 'npub') {
      return {
        status: 'valid' as const,
        kind: 'npub' as const,
        pubkey: decoded.data,
        relays: [],
      }
    }

    if (decoded.type === 'nprofile') {
      return {
        status: 'valid' as const,
        kind: 'nprofile' as const,
        pubkey: decoded.data.pubkey,
        relays: decoded.data.relays ?? [],
      }
    }

    return {
      status: 'invalid' as const,
      code: 'UNSUPPORTED_NIP19_TYPE' as const,
      message: 'Ese tipo NIP-19 no apunta a un perfil.',
    }
  } catch {
    return {
      status: 'invalid' as const,
      code: 'INVALID_NIP19' as const,
      message: 'Clave invalida.',
    }
  }
}

const decodeDirectRootPointer = (
  input: string,
): RootIdentityResolution | null => {
  if (HEX_PUBKEY_PATTERN.test(input)) {
    return {
      status: 'valid',
      input,
      source: 'hex',
      pubkey: input.toLowerCase(),
      relays: [],
      confidence: 'cryptographic',
    }
  }

  const decoded = decodeNip19RootPointer(input.toLowerCase())
  if (decoded.status === 'valid') {
    return {
      status: 'valid',
      input,
      source: decoded.kind,
      pubkey: decoded.pubkey,
      relays: decoded.relays,
      confidence: 'cryptographic',
    }
  }

  if (/^(nostr:)?(?:npub1|nprofile1)/i.test(input)) {
    return {
      status: 'invalid',
      input,
      code: decoded.code,
      message: decoded.message,
    }
  }

  return null
}

const decodeExtractedRootPointer = (input: string): RootIdentityResolution | null => {
  const candidates = new Map<string, string>()
  const addCandidates = (source: string) => {
    for (const match of source.matchAll(NIP19_POINTER_PATTERN)) {
      const candidate = match[1]
      if (candidate) candidates.set(candidate.toLowerCase(), candidate)
    }
  }

  addCandidates(input)

  try {
    const decodedInput = decodeURIComponent(input)
    if (decodedInput !== input) addCandidates(decodedInput)
  } catch {
    // Keep the original candidate set when the pasted value is not URI encoded.
  }

  const validCandidates: Array<{
    input: string
    kind: 'npub' | 'nprofile'
    pubkey: string
    relays: string[]
  }> = []

  for (const candidate of candidates.values()) {
    const decoded = decodeNip19RootPointer(candidate.toLowerCase())
    if (decoded.status === 'valid') {
      validCandidates.push({
        input: candidate,
        kind: decoded.kind,
        pubkey: decoded.pubkey,
        relays: decoded.relays,
      })
    }
  }

  const distinctPubkeys = new Set(validCandidates.map((candidate) => candidate.pubkey))
  if (distinctPubkeys.size > 1) {
    return {
      status: 'invalid',
      input,
      code: 'MULTIPLE_IDENTITIES',
      message: 'El texto contiene mas de una identidad. Pega solo una.',
    }
  }

  const candidate = validCandidates[0]
  if (!candidate) return null

  return {
    status: 'valid',
    input,
    source: 'url',
    pubkey: candidate.pubkey,
    relays: candidate.relays,
    confidence: 'parsed-pointer',
    evidence: {
      normalizedInput: candidate.input,
      url: input,
    },
  }
}

export async function resolveRootIdentity(
  input: string,
): Promise<RootIdentityResolution> {
  const normalizedInput = input.trim()

  if (!normalizedInput) {
    return { status: 'empty' }
  }

  const directPointer = decodeDirectRootPointer(normalizedInput)
  if (directPointer?.status === 'valid') return directPointer

  const extractedPointer = decodeExtractedRootPointer(normalizedInput)
  if (extractedPointer) return extractedPointer

  if (directPointer?.status === 'invalid') return directPointer

  if (normalizeNip05Identifier(normalizedInput)) {
    const resolvedNip05 = await resolveNip05Identifier(normalizedInput)

    if (resolvedNip05.status === 'valid') {
      return {
        status: 'valid',
        input: normalizedInput,
        source: 'nip05',
        pubkey: resolvedNip05.pubkey,
        relays: resolvedNip05.relays,
        confidence: 'verified-alias',
        evidence: {
          normalizedInput: resolvedNip05.identifier,
          nip05: resolvedNip05.identifier,
          url: resolvedNip05.url,
        },
      }
    }

    return {
      status: 'invalid',
      input: normalizedInput,
      code: resolvedNip05.code,
      message: resolvedNip05.message,
    }
  }

  return {
    status: 'invalid',
    input: normalizedInput,
    code: 'INVALID_INPUT',
    message: 'Pega un npub, nprofile, hex, NIP-05 o link de perfil.',
  }
}
