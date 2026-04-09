import { nip19 } from 'nostr-tools'

export type RootPointerKind = 'npub' | 'nprofile'

export type RootPointerDecodeResult =
  | {
      status: 'empty'
    }
  | {
      status: 'validating'
      input: string
    }
  | {
      status: 'valid'
      input: string
      kind: RootPointerKind
      pubkey: string
      relays: string[]
    }
  | {
      status: 'invalid'
      input: string
      code: 'INVALID_NIP19' | 'UNSUPPORTED_NIP19_TYPE'
      message: string
    }

export function decodeRootPointer(input: string): Exclude<RootPointerDecodeResult, { status: 'validating' }> {
  const normalizedInput = input.trim()

  if (normalizedInput.length === 0) {
    return { status: 'empty' }
  }

  try {
    const decoded = nip19.decodeNostrURI(normalizedInput)

    if (decoded.type === 'invalid' || decoded.data === null) {
      return {
        status: 'invalid',
        input: normalizedInput,
        code: 'INVALID_NIP19',
        message: 'Clave inválida',
      }
    }

    if (decoded.type === 'npub') {
      return {
        status: 'valid',
        input: normalizedInput,
        kind: 'npub',
        pubkey: decoded.data,
        relays: [],
      }
    }

    if (decoded.type === 'nprofile') {
      return {
        status: 'valid',
        input: normalizedInput,
        kind: 'nprofile',
        pubkey: decoded.data.pubkey,
        relays: decoded.data.relays ?? [],
      }
    }

    return {
      status: 'invalid',
      input: normalizedInput,
      code: 'UNSUPPORTED_NIP19_TYPE',
      message: 'Clave inválida',
    }
  } catch {
    return {
      status: 'invalid',
      input: normalizedInput,
      code: 'INVALID_NIP19',
      message: 'Clave inválida',
    }
  }
}
