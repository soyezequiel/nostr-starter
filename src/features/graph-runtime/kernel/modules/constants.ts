// devicePerformance imports removidos: tuning universal no necesita deteccion.

export const DEFAULT_SESSION_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://purplepag.es',
] as const

export const MAX_SESSION_RELAYS = 16

export const ROOT_LOADING_MESSAGE =
  'Preparando relays, cache local y contact list kind:3 del root...'
export const COVERAGE_RECOVERY_MESSAGE =
  'Cambia relays o prueba una pubkey curada para recuperar cobertura.'
export const ZAP_LAYER_LOADING_MESSAGE =
  'Consultando recibos de zap para los nodos explorados y decodificando edges...'
export const KEYWORD_LAYER_LOADING_MESSAGE =
  'Consultando notas recientes por batches para construir la capa de intereses...'
export const KEYWORD_LAYER_EMPTY_MESSAGE =
  'Corpus vacÃ­o, no hay notas descubiertas'
export const MAX_ZAP_RECEIPTS = 500
export const KEYWORD_LOOKBACK_WINDOW_SEC = 30 * 24 * 60 * 60
export const KEYWORD_BATCH_SIZE = 25
export const KEYWORD_BATCH_CONCURRENCY = 2
export const KEYWORD_MAX_NOTES_PER_PUBKEY = 5
export const KEYWORD_FILTER_LIMIT_FACTOR = 4
export const KEYWORD_EXTRACT_MAX_LENGTH = 500
export const NODE_DETAIL_PREVIEW_CONNECT_TIMEOUT_MS = 3_000
export const NODE_DETAIL_PREVIEW_PAGE_TIMEOUT_MS = 4_500
export const NODE_DETAIL_PREVIEW_RETRY_COUNT = 0
export const NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS = 250
export const NODE_EXPAND_CONNECT_TIMEOUT_MS = 3_500
export const NODE_EXPAND_PAGE_TIMEOUT_MS = 6_500
export const NODE_EXPAND_RETRY_COUNT = 2
export const NODE_EXPAND_STRAGGLER_GRACE_MS = 1000
export const NODE_EXPAND_HARD_TIMEOUT_MS = 18_000
export const NODE_EXPAND_INBOUND_QUERY_LIMIT = 250
export const NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS = 2500
export const NODE_EXPAND_INBOUND_PARSE_CONCURRENCY = 8
export const ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY = 8
export const ROOT_INBOUND_DISCOVERY_RELAY_LIMIT = MAX_SESSION_RELAYS
export const ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY = 2
export const TARGETED_RECIPROCAL_AUTHOR_CHUNK_SIZE = 100
export const TARGETED_RECIPROCAL_QUERY_CONCURRENCY = 2
export const TARGETED_RECIPROCAL_MAX_PAGES_PER_CHUNK = 3
export const FOLLOW_RELAY_LIST_AUTHOR_CHUNK_SIZE = 100
export const FOLLOW_RELAY_LIST_QUERY_CONCURRENCY = 2
export const FOLLOW_RELAY_LIST_MAX_PAGES_PER_CHUNK = 2
export const FOLLOW_RELAY_LIST_TOP_HINTS = 16
export const FOLLOW_RELAY_LIST_KIND = 10002
export const DISCOVERED_GRAPH_ANALYSIS_LOADING_MESSAGE =
  'Calculando comunidades, lideres y puentes sobre el vecindario descubierto...'
export const NODE_PROFILE_HYDRATION_BATCH_SIZE = 150
export const NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY = 3
export const NODE_PROFILE_PERSIST_CONCURRENCY = 8
export const RELAY_HEALTH_FLUSH_DELAY_MS = 32

// Tuning de red por perfil de dispositivo.
// Desktop obtiene timeouts moderadamente mas ajustados que mobile.
// Si la deteccion falla, se cae al perfil mobile (generoso) para evitar regresiones.
// El log en consola permite verificar que perfil se aplico en cada dispositivo.
export interface KernelNetworkTuning {
  nodeExpandConnectTimeoutMs: number
  nodeExpandPageTimeoutMs: number
  nodeExpandHardTimeoutMs: number
  nodeExpandRetryCount: number
  nodeExpandStragglerGraceMs: number
  nodeExpandInboundCountTimeoutMs: number
  rootInboundDiscoveryPageConcurrency: number
  targetedReciprocalQueryConcurrency: number
  followRelayListQueryConcurrency: number
}

// Desktop: Restaurado a los valores óptimos originales (3.5s/6.5s/18s) 
// que demostraron obtener ~189 nodos consistentemente.
const DESKTOP_KERNEL_TUNING: KernelNetworkTuning = {
  nodeExpandConnectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
  nodeExpandPageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
  nodeExpandHardTimeoutMs: NODE_EXPAND_HARD_TIMEOUT_MS,
  nodeExpandRetryCount: NODE_EXPAND_RETRY_COUNT,
  nodeExpandStragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
  nodeExpandInboundCountTimeoutMs: NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS,
  rootInboundDiscoveryPageConcurrency: ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY,
  targetedReciprocalQueryConcurrency: TARGETED_RECIPROCAL_QUERY_CONCURRENCY,
  followRelayListQueryConcurrency: FOLLOW_RELAY_LIST_QUERY_CONCURRENCY,
}

// Mobile: Restaurado a los mismos valores que desktop (3.5s/6.5s/18s).
// Darle demasiado tiempo (24s) causaba estancamiento en relays caídos, 
// resultando en pérdida de nodos por timeout global.
const MOBILE_KERNEL_TUNING: KernelNetworkTuning = {
  nodeExpandConnectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
  nodeExpandPageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
  nodeExpandHardTimeoutMs: NODE_EXPAND_HARD_TIMEOUT_MS,
  nodeExpandRetryCount: NODE_EXPAND_RETRY_COUNT,
  nodeExpandStragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
  nodeExpandInboundCountTimeoutMs: NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS,
  rootInboundDiscoveryPageConcurrency: ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY,
  targetedReciprocalQueryConcurrency: TARGETED_RECIPROCAL_QUERY_CONCURRENCY,
  followRelayListQueryConcurrency: FOLLOW_RELAY_LIST_QUERY_CONCURRENCY,
}

let cachedKernelTuning: KernelNetworkTuning | null = null

function detectIsMobileForTuning(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      // SSR o entorno sin DOM: asumir mobile (generoso) como fallback seguro.
      return true
    }
    const matchMedia =
      typeof window.matchMedia === 'function' ? window.matchMedia : null
    const isPointerCoarse = matchMedia?.('(pointer: coarse)')?.matches ?? false
    const viewportWidth = window.innerWidth ?? 0
    const isMobileByViewport = viewportWidth > 0 && viewportWidth <= 900
    return isPointerCoarse || isMobileByViewport
  } catch {
    // Cualquier error de deteccion: asumir mobile (generoso).
    return true
  }
}

export function getKernelNetworkTuning(): KernelNetworkTuning {
  if (cachedKernelTuning) return cachedKernelTuning
  const isMobile = detectIsMobileForTuning()
  cachedKernelTuning = isMobile ? MOBILE_KERNEL_TUNING : DESKTOP_KERNEL_TUNING
  // Log unico para diagnostico — permite verificar en DevTools del celular.
  if (typeof console !== 'undefined') {
    console.info(
      `[kernel-tuning] Perfil de red: ${isMobile ? 'MOBILE' : 'DESKTOP'}`,
      {
        connectMs: cachedKernelTuning.nodeExpandConnectTimeoutMs,
        pageMs: cachedKernelTuning.nodeExpandPageTimeoutMs,
        hardMs: cachedKernelTuning.nodeExpandHardTimeoutMs,
        retries: cachedKernelTuning.nodeExpandRetryCount,
        viewport: typeof window !== 'undefined' ? window.innerWidth : 'N/A',
      },
    )
  }
  return cachedKernelTuning
}

export function resetKernelNetworkTuningCache(): void {
  cachedKernelTuning = null
}

