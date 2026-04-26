import {
  detectDevicePerformance,
  isMobileDevicePerformanceProfile,
  type DevicePerformanceDetectionResult,
} from '@/features/graph-runtime/devicePerformance'

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

// Tuning de red dinamico por perfil de dispositivo.
// El problema raiz no era "subir todos los timeouts": era que la PC y el celular
// compartian las mismas constantes. La PC sufre con timeouts laxos (espera de
// mas a relays caidos) y el celular sufre con timeouts agresivos (corta relays
// que en mobile tardan un poco mas por el jitter de red). Ademas, en celular
// conviene MAS concurrencia que menos: como cada query es individualmente mas
// lenta, hacen falta mas en paralelo para llenar el presupuesto antes del hard
// timeout. El navegador movil permite hasta ~6 sockets WS por origen.
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

const DESKTOP_KERNEL_TUNING: KernelNetworkTuning = {
  nodeExpandConnectTimeoutMs: 1_500,
  nodeExpandPageTimeoutMs: 4_000,
  nodeExpandHardTimeoutMs: 10_000,
  nodeExpandRetryCount: 1,
  nodeExpandStragglerGraceMs: 400,
  nodeExpandInboundCountTimeoutMs: 1_500,
  rootInboundDiscoveryPageConcurrency: 2,
  targetedReciprocalQueryConcurrency: 2,
  followRelayListQueryConcurrency: 2,
}

const MOBILE_KERNEL_TUNING: KernelNetworkTuning = {
  nodeExpandConnectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
  nodeExpandPageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
  nodeExpandHardTimeoutMs: NODE_EXPAND_HARD_TIMEOUT_MS,
  nodeExpandRetryCount: NODE_EXPAND_RETRY_COUNT,
  nodeExpandStragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
  nodeExpandInboundCountTimeoutMs: NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS,
  // NOTA: concurrencia 4 en mobile causo regresion (189→117 nodos). Los relays
  // rate-limitean y el celular satura CPU con 4 streams de paginacion.
  // Mantener en 2 como antes.
  rootInboundDiscoveryPageConcurrency: 2,
  targetedReciprocalQueryConcurrency: 2,
  followRelayListQueryConcurrency: 2,
}

let cachedKernelTuning: KernelNetworkTuning | null = null

const detectKernelTuningProfile = (): DevicePerformanceDetectionResult => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { profile: 'mobile', isPointerCoarse: false }
  }
  const matchMedia =
    typeof window.matchMedia === 'function' ? window.matchMedia : null
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return detectDevicePerformance({
    isPointerCoarse: matchMedia?.('(pointer: coarse)').matches ?? false,
    viewportWidth: window.innerWidth ?? 0,
    deviceMemory: typeof memory === 'number' ? memory : null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  })
}

export function getKernelNetworkTuning(): KernelNetworkTuning {
  if (cachedKernelTuning) return cachedKernelTuning
  const detected = detectKernelTuningProfile()
  cachedKernelTuning = isMobileDevicePerformanceProfile(detected.profile)
    ? MOBILE_KERNEL_TUNING
    : DESKTOP_KERNEL_TUNING
  return cachedKernelTuning
}

export function resetKernelNetworkTuningCache(): void {
  cachedKernelTuning = null
}
