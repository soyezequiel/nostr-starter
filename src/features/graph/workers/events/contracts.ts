import type { WorkerActionMap, WorkerDiagnostic } from '@/features/graph/workers/shared/protocol'

export interface SerializedContactListEvent {
  id: string
  pubkey: string
  kind: number
  createdAt: number
  tags: string[][]
}

export interface ParseContactListRequest {
  event: SerializedContactListEvent
  maxFollowTags?: number
}

export interface DiscoveredGraphNode {
  pubkey: string
}

export interface DiscoveredGraphLink {
  sourcePubkey: string
  targetPubkey: string
}

export interface ParseContactListResult {
  nodes: DiscoveredGraphNode[]
  links: DiscoveredGraphLink[]
  followPubkeys: string[]
  relayHints: string[]
  diagnostics: WorkerDiagnostic[]
}

export interface KeywordExtractInput {
  noteId: string
  pubkey: string
  text: string
}

export interface SearchKeywordsRequest {
  keyword: string
  extracts: KeywordExtractInput[]
}

export interface KeywordExcerptMatch {
  noteId: string
  pubkey: string
  excerpt: string
  matchedTokens: string[]
  score: number
}

export interface SearchKeywordsResult {
  tokens: string[]
  hitCounts: Record<string, number>
  excerptMatches: KeywordExcerptMatch[]
}

export interface ZapReceiptInput {
  id: string
  kind: number
  createdAt: number
  tags: string[][]
}

export interface DecodeZapsRequest {
  events: ZapReceiptInput[]
}

export interface ZapEdge {
  eventId: string
  fromPubkey: string
  toPubkey: string
  sats: number
  createdAt: number
}

export interface DecodeZapsResult {
  zapEdges: ZapEdge[]
  skippedReceipts: WorkerDiagnostic[]
}

export interface EventsWorkerActionMap extends WorkerActionMap {
  PARSE_CONTACT_LIST: {
    request: ParseContactListRequest
    response: ParseContactListResult
  }
  SEARCH_KEYWORDS: {
    request: SearchKeywordsRequest
    response: SearchKeywordsResult
  }
  DECODE_ZAPS: {
    request: DecodeZapsRequest
    response: DecodeZapsResult
  }
}
