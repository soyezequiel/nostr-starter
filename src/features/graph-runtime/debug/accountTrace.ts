import { nip19 } from 'nostr-tools'

const DEFAULT_TRACE_ROOT_PUBKEY =
  '2ad91f1dca2dcd5fc89e7208d1e5059f0bac0870d63fc3bac21c7a9388fa18fd'
const DEFAULT_TRACE_TARGET_PUBKEY =
  '7c45dcfb2e93594ce43bc2b16fd29b3c38ba0daf42ae8561fe6f0353892b7df4'

interface AccountTraceConfig {
  rootPubkey: string
  targetPubkey: string
}

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i

const normalizeTracePubkey = (pubkey: string | undefined) => {
  const value = pubkey?.trim().toLowerCase() ?? ''
  if (!value) {
    return ''
  }

  if (HEX_PUBKEY_PATTERN.test(value)) {
    return value
  }

  if (value.startsWith('npub')) {
    try {
      const decoded = nip19.decode(value)
      return decoded.type === 'npub' && typeof decoded.data === 'string'
        ? decoded.data.toLowerCase()
        : value
    } catch {
      return value
    }
  }

  return value
}

const truncatePubkey = (pubkey: string) =>
  pubkey.length <= 16 ? pubkey : `${pubkey.slice(0, 12)}...${pubkey.slice(-8)}`

export function getAccountTraceConfig(): AccountTraceConfig | null {
  const enabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_ACCOUNTS === '1'

  if (!enabled) {
    return null
  }

  const rootPubkey =
    normalizeTracePubkey(process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_ROOT_PUBKEY) ||
    DEFAULT_TRACE_ROOT_PUBKEY
  const targetPubkey =
    normalizeTracePubkey(process.env.NEXT_PUBLIC_GRAPH_V2_TRACE_TARGET_PUBKEY) ||
    DEFAULT_TRACE_TARGET_PUBKEY

  if (!rootPubkey || !targetPubkey) {
    return null
  }

  return {
    rootPubkey,
    targetPubkey,
  }
}

export function isAccountTraceRoot(pubkey: string | null | undefined): boolean {
  const config = getAccountTraceConfig()
  return Boolean(config && normalizeTracePubkey(pubkey ?? undefined) === config.rootPubkey)
}

export function isAccountTraceTarget(pubkey: string | null | undefined): boolean {
  const config = getAccountTraceConfig()
  return Boolean(
    config && normalizeTracePubkey(pubkey ?? undefined) === config.targetPubkey,
  )
}

export function traceAccountFlow(
  stage: string,
  details: Record<string, unknown> = {},
): void {
  const config = getAccountTraceConfig()
  if (!config) {
    return
  }

  console.info(`[graph-v2:trace-account] ${stage}`, {
    stage,
    traceRootPubkey: config.rootPubkey,
    traceRoot: truncatePubkey(config.rootPubkey),
    traceTargetPubkey: config.targetPubkey,
    traceTarget: truncatePubkey(config.targetPubkey),
    ...details,
  })
}
