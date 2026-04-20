export const DEFAULT_SESSION_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://purplepag.es',
] as const

export const MAX_SESSION_RELAYS = 8

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
export const NODE_DETAIL_PREVIEW_RETRY_COUNT = 1
export const NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS = 250
export const NODE_EXPAND_CONNECT_TIMEOUT_MS = 1_200
export const NODE_EXPAND_PAGE_TIMEOUT_MS = 1_500
export const NODE_EXPAND_RETRY_COUNT = 0
export const NODE_EXPAND_STRAGGLER_GRACE_MS = 150
export const NODE_EXPAND_HARD_TIMEOUT_MS = 4_000
export const NODE_EXPAND_INBOUND_QUERY_LIMIT = 250
export const NODE_EXPAND_INBOUND_PARSE_CONCURRENCY = 8
export const ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY = 8
export const ROOT_INBOUND_DISCOVERY_RELAY_LIMIT = MAX_SESSION_RELAYS
export const ROOT_INBOUND_DISCOVERY_PAGE_CONCURRENCY = 2
export const DISCOVERED_GRAPH_ANALYSIS_LOADING_MESSAGE =
  'Calculando comunidades, lideres y puentes sobre el vecindario descubierto...'
export const NODE_PROFILE_HYDRATION_BATCH_SIZE = 150
export const NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY = 3
export const NODE_PROFILE_PERSIST_CONCURRENCY = 8
export const RELAY_HEALTH_FLUSH_DELAY_MS = 32
