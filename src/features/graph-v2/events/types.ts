// Discriminated union for live + replay graph activity events.
// Generalises the original zap-only model so additional Nostr event kinds
// (likes, reposts, saves, quotes, comments) can flow through the same
// subscription, replay, animation and detail-card pipelines.

export type GraphEventKind =
  | 'zap'
  | 'like'
  | 'repost'
  | 'save'
  | 'quote'
  | 'comment'

export const GRAPH_EVENT_KINDS: readonly GraphEventKind[] = [
  'zap',
  'like',
  'repost',
  'save',
  'quote',
  'comment',
] as const

export interface ZapPayload {
  amountSats: number | null
  bolt11: string | null
  comment: string | null
  zappedEventId: string | null
}

export interface LikePayload {
  // '+', '-' or an emoji per NIP-25.
  reaction: string
  targetEventId: string | null
  targetKind: number | null
}

export interface RepostPayload {
  repostedEventId: string | null
  // For kind 16 NIP-18 generic repost: the kind being reposted.
  repostedKind: number | null
  // Best-effort original-event content embedded in NIP-18 repost (kind 6).
  embeddedContent: string | null
}

export interface SavePayload {
  // For NIP-51 list updates: the entry that was added or removed.
  entryEventId: string | null
  entryAuthorPubkey: string | null
  entryAddress: string | null
  // 'd' tag for parameterised lists (kind 30001).
  listIdentifier: string | null
  changeType: 'added' | 'removed' | 'unknown'
}

export interface QuotePayload {
  quotedEventId: string | null
  quotedAuthorPubkey: string | null
  // Quoter's own note text (kind 1 content). Always available from the event.
  quoterContent: string
}

export interface CommentPayload {
  rootEventId: string | null
  parentEventId: string | null
  parentAuthorPubkey: string | null
  // Comment body (NIP-22 kind 1111 content). Always available.
  commentContent: string
}

export type GraphEventPayload =
  | { kind: 'zap'; data: ZapPayload }
  | { kind: 'like'; data: LikePayload }
  | { kind: 'repost'; data: RepostPayload }
  | { kind: 'save'; data: SavePayload }
  | { kind: 'quote'; data: QuotePayload }
  | { kind: 'comment'; data: CommentPayload }

export interface ParsedGraphEvent {
  kind: GraphEventKind
  eventId: string
  fromPubkey: string
  toPubkey: string
  createdAt: number
  // Referenced note id, when the activity targets a note (likes, reposts,
  // quotes, comments, sometimes saves). The UI keeps this as an id/external
  // link target and does not fetch the referenced note body.
  refEventId: string | null
  payload: GraphEventPayload
}

export type GraphEventActivitySource = 'live' | 'recent' | 'simulated'

export interface GraphEventActivityLogEntry {
  id: string
  eventId: string
  source: GraphEventActivitySource
  kind: GraphEventKind
  fromPubkey: string
  toPubkey: string
  played: boolean
  createdAt: number
  receivedAt: number
  refEventId: string | null
  payload: GraphEventPayload
}

export type GraphEventToggleState = Record<GraphEventKind, boolean>

export type GraphEventFeedMode = 'live' | 'recent'

export const DEFAULT_GRAPH_EVENT_TOGGLES: GraphEventToggleState = {
  zap: true,
  like: true,
  repost: true,
  save: true,
  quote: true,
  comment: true,
}

export const GRAPH_EVENT_KIND_LABELS: Record<GraphEventKind, string> = {
  zap: 'Zaps',
  like: 'Likes',
  repost: 'Reposts',
  save: 'Saves',
  quote: 'Quotes',
  comment: 'Comments',
}

export const GRAPH_EVENT_KIND_SINGULAR_LABELS: Record<GraphEventKind, string> = {
  zap: 'Zap',
  like: 'Like',
  repost: 'Repost',
  save: 'Save',
  quote: 'Quote',
  comment: 'Comment',
}

export const GRAPH_EVENT_KIND_DESCRIPTIONS: Record<GraphEventKind, string> = {
  zap: 'NIP-57 zap receipts.',
  like: 'Kind 7 reactions.',
  repost: 'Kind 6 and 16 reposts.',
  save: 'NIP-51 bookmark list updates.',
  quote: 'NIP-18 quote posts; referenced note text loads in details.',
  comment: 'NIP-22 comments; parent text loads in details.',
}

// Per-kind colour tokens used by the renderer overlay strategies and the
// HUD/feed badges. Keep in sync with graph-v2.css if surfaced as CSS vars.
export const GRAPH_EVENT_KIND_COLORS: Record<GraphEventKind, string> = {
  zap: '#fbbf24',
  like: '#ff5d8f',
  repost: '#22c55e',
  save: '#3b82f6',
  quote: '#a855f7',
  comment: '#14b8a6',
}
