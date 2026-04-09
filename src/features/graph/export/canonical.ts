const TEXT_ENCODER = new TextEncoder()

export function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sortDeep)
  }

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}

  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortDeep(record[key])
  }

  return sorted
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2).replace(/\r\n/g, '\n') + '\n'
}

export function canonicalNdjson(records: readonly unknown[]): string {
  if (records.length === 0) {
    return ''
  }

  return records.map((r) => JSON.stringify(sortDeep(r))).join('\n') + '\n'
}

export function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(text)
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer) as Uint8Array<ArrayBuffer>

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
