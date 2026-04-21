interface ZapTraceConfig {
  fromPubkey: string | null
  toPubkey: string | null
}

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i

const normalizeTracePubkey = (pubkey: string | undefined) => {
  const value = pubkey?.trim().toLowerCase() ?? ''
  return HEX_PUBKEY_PATTERN.test(value) ? value : ''
}

const truncatePubkey = (pubkey: string | null | undefined) => {
  if (!pubkey) {
    return null
  }

  return pubkey.length <= 16
    ? pubkey
    : `${pubkey.slice(0, 12)}...${pubkey.slice(-8)}`
}

export function getZapTraceConfig(): ZapTraceConfig | null {
  const enabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_ZAPS === '1'

  if (!enabled) {
    return null
  }

  return {
    fromPubkey:
      normalizeTracePubkey(process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_ZAP_FROM_PUBKEY) ||
      null,
    toPubkey:
      normalizeTracePubkey(process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_ZAP_TO_PUBKEY) ||
      null,
  }
}

export function shouldTraceZapPair({
  fromPubkey,
  toPubkey,
}: {
  fromPubkey?: string | null
  toPubkey?: string | null
}): boolean {
  const config = getZapTraceConfig()
  if (!config) {
    return false
  }

  const normalizedFrom = fromPubkey?.toLowerCase() ?? null
  const normalizedTo = toPubkey?.toLowerCase() ?? null

  if (config.fromPubkey && normalizedFrom !== config.fromPubkey) {
    return false
  }

  if (config.toPubkey && normalizedTo !== config.toPubkey) {
    return false
  }

  return true
}

export function traceZapFlow(
  stage: string,
  details: Record<string, unknown> = {},
): void {
  const config = getZapTraceConfig()
  if (!config) {
    return
  }

  console.info(`[graph-v2:trace-zaps] ${stage}`, {
    stage,
    traceFromPubkey: config.fromPubkey,
    traceFrom: truncatePubkey(config.fromPubkey),
    traceToPubkey: config.toPubkey,
    traceTo: truncatePubkey(config.toPubkey),
    ...details,
  })
}

export function formatZapTracePubkey(pubkey: string | null | undefined) {
  return truncatePubkey(pubkey)
}
