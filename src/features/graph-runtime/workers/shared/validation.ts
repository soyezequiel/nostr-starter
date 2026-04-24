import { WorkerProtocolError, isRecord } from '@/features/graph-runtime/workers/shared/protocol'

export function isHexIdentifier(value: string): boolean {
  if (value.length < 8) {
    return false
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    const isDigit = code >= 48 && code <= 57
    const isLowerHex = code >= 97 && code <= 102
    const isUpperHex = code >= 65 && code <= 70

    if (!isDigit && !isLowerHex && !isUpperHex) {
      return false
    }
  }

  return true
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must be an object.`, { path })
  }

  return value
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must be a non-empty string.`, {
      path,
    })
  }

  return value.trim()
}

export function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must be a finite number.`, {
      path,
    })
  }

  return value
}

export function expectOptionalPositiveInteger(
  value: unknown,
  path: string,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be a positive integer when provided.`,
      { path },
    )
  }

  return value
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must be an array.`, { path })
  }

  return value
}

export function expectStringMatrix(value: unknown, path: string): string[][] {
  const rows = expectArray(value, path)

  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) {
      throw new WorkerProtocolError(
        'INVALID_PAYLOAD',
        `${path}[${index}] must be an array of strings.`,
        {
          path: `${path}[${index}]`,
        },
      )
    }

    return row
  })
}

export function normalizePubkey(value: unknown, path: string): string {
  const normalized = expectString(value, path).toLowerCase()

  if (!isHexIdentifier(normalized)) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must look like a hex pubkey.`, {
      path,
    })
  }

  return normalized
}

export function normalizeEventId(value: unknown, path: string): string {
  const normalized = expectString(value, path).toLowerCase()

  if (!isHexIdentifier(normalized)) {
    throw new WorkerProtocolError('INVALID_PAYLOAD', `${path} must look like a hex event id.`, {
      path,
    })
  }

  return normalized
}
