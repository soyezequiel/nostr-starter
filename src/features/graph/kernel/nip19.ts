import { nip19 } from 'nostr-tools'

export type RootPointerKind = 'npub' | 'nprofile'
export type ProfilePointerKind = RootPointerKind | 'hex'

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

export type ProfilePointerDecodeResult =
  | {
      status: 'empty'
    }
  | {
      status: 'valid'
      input: string
      kind: ProfilePointerKind
      pubkey: string
      relays: string[]
    }
  | {
      status: 'invalid'
      input: string
      code:
        | 'INVALID_PUBKEY'
        | 'INVALID_NIP19'
        | 'UNSUPPORTED_NIP19_TYPE'
      message: string
    }

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i

export function decodeProfilePointer(
  input: string,
): ProfilePointerDecodeResult {
  const normalizedInput = input.trim()

  if (normalizedInput.length === 0) {
    return { status: 'empty' }
  }

  if (HEX_PUBKEY_PATTERN.test(normalizedInput)) {
    return {
      status: 'valid',
      input: normalizedInput,
      kind: 'hex',
      pubkey: normalizedInput.toLowerCase(),
      relays: [],
    }
  }

  const rootPointer = decodeRootPointer(normalizedInput)
  if (rootPointer.status === 'valid') {
    return rootPointer
  }

  if (normalizedInput.startsWith('npub1') || normalizedInput.startsWith('nprofile1')) {
    return rootPointer
  }

  return {
    status: 'invalid',
    input: normalizedInput,
    code: 'INVALID_PUBKEY',
    message: 'Clave invalida',
  }
}
