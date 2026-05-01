// Lightweight parsers for non-zap graph events. Each parser takes a raw
// Nostr event and returns a ParsedGraphEvent or null. Parsers are pure: they
// only read tag metadata for referenced notes. Detail panels keep references
// as ids/external links and do not fetch the referenced note body.

import type { ParsedGraphEvent } from '@/features/graph-v2/events/types'

interface RawNostrEvent {
  id: string
  pubkey: string
  kind: number
  created_at: number
  content: string
  tags: readonly (readonly string[])[]
}

const findTag = (
  tags: readonly (readonly string[])[],
  name: string,
): readonly string[] | undefined => {
  for (const tag of tags) {
    if (tag[0] === name) return tag
  }
  return undefined
}

const findAllTags = (
  tags: readonly (readonly string[])[],
  name: string,
): readonly (readonly string[])[] => tags.filter((tag) => tag[0] === name)

const findLastTag = (
  tags: readonly (readonly string[])[],
  name: string,
): readonly string[] | undefined => {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const tag = tags[index]
    if (tag[0] === name) return tag
  }
  return undefined
}

const lower = (value: string | undefined | null): string | null => {
  if (!value || typeof value !== 'string') return null
  return value.toLowerCase()
}

const parseEmbeddedEventAuthor = (content: string): string | null => {
  if (!content.trim()) return null
  try {
    const embedded = JSON.parse(content) as { pubkey?: unknown }
    return typeof embedded.pubkey === 'string' ? lower(embedded.pubkey) : null
  } catch {
    return null
  }
}

// NIP-25 reactions (kind 7). Target is the recipient via 'p' tag; the note
// reacted to is the last 'e' tag.
export const parseLikeEvent = (event: RawNostrEvent): ParsedGraphEvent | null => {
  if (event.kind !== 7) return null
  const fromPubkey = lower(event.pubkey)
  // NIP-25 says the target pubkey should be the last p tag when multiple are
  // present. Using the first p makes live #p subscriptions look empty because
  // the UI gate can discard an event that did match the relay filter.
  const toPubkey = lower(findLastTag(event.tags, 'p')?.[1])
  if (!fromPubkey || !toPubkey) return null

  const eTags = findAllTags(event.tags, 'e')
  const targetEventId = lower(eTags[eTags.length - 1]?.[1] ?? null)
  const targetKindRaw = findTag(event.tags, 'k')?.[1]
  const targetKind =
    targetKindRaw !== undefined ? Number.parseInt(targetKindRaw, 10) : null
  const reaction = (event.content ?? '+').trim() || '+'

  return {
    kind: 'like',
    eventId: event.id.toLowerCase(),
    fromPubkey,
    toPubkey,
    createdAt: event.created_at,
    refEventId: targetEventId,
    payload: {
      kind: 'like',
      data: {
        reaction,
        targetEventId,
        targetKind: Number.isFinite(targetKind) ? targetKind : null,
      },
    },
  }
}

// NIP-18 reposts: kind 6 (reposts of kind 1 notes), kind 16 (generic reposts).
export const parseRepostEvent = (event: RawNostrEvent): ParsedGraphEvent | null => {
  if (event.kind !== 6 && event.kind !== 16) return null
  const fromPubkey = lower(event.pubkey)
  const embeddedAuthor = parseEmbeddedEventAuthor(event.content)
  const toPubkey = embeddedAuthor ?? lower(findLastTag(event.tags, 'p')?.[1])
  if (!fromPubkey || !toPubkey) return null

  const repostedEventId = lower(findTag(event.tags, 'e')?.[1] ?? null)
  const kindTagRaw = findTag(event.tags, 'k')?.[1]
  const repostedKind =
    kindTagRaw !== undefined ? Number.parseInt(kindTagRaw, 10) : null
  const embeddedContent =
    typeof event.content === 'string' && event.content.length > 0
      ? event.content
      : null

  return {
    kind: 'repost',
    eventId: event.id.toLowerCase(),
    fromPubkey,
    toPubkey,
    createdAt: event.created_at,
    refEventId: repostedEventId,
    payload: {
      kind: 'repost',
      data: {
        repostedEventId,
        repostedKind: Number.isFinite(repostedKind) ? repostedKind : null,
        embeddedContent,
      },
    },
  }
}

// NIP-51 list updates: kind 10003 (bookmarks, replaceable), kind 30001
// (parameterised). Each list event lists multiple entries; we synthesise one
// graph event per entry with a target. Source = list author; target = entry
// author when we can extract it from an 'a' tag, otherwise entry id is used
// as a placeholder and the renderer can fall back to the saver themselves.
export const parseSaveEvents = (
  event: RawNostrEvent,
): ParsedGraphEvent[] => {
  if (event.kind !== 10003 && event.kind !== 30001) return []
  const fromPubkey = lower(event.pubkey)
  if (!fromPubkey) return []

  const listIdentifier = findTag(event.tags, 'd')?.[1] ?? null

  // Each tag may target an event id ('e'), a parameterised address
  // ('a' = "<kind>:<author>:<d>"), or a hashtag ('t'). We only animate
  // entries with a derivable counterparty.
  const entries: ParsedGraphEvent[] = []
  let entryIndex = 0
  for (const tag of event.tags) {
    if (tag[0] === 'e' && typeof tag[1] === 'string') {
      const entryEventId = lower(tag[1])
      // Fall back to self-edge if no entry author known: the save still
      // visually emanates from the saver. The target in this case is the
      // saver themselves; the renderer treats that as a "self" pulse.
      entries.push({
        kind: 'save',
        eventId: `${event.id.toLowerCase()}:${entryIndex++}`,
        fromPubkey,
        toPubkey: fromPubkey,
        createdAt: event.created_at,
        refEventId: entryEventId,
        payload: {
          kind: 'save',
          data: {
            entryEventId,
            entryAuthorPubkey: null,
            entryAddress: null,
            listIdentifier,
            changeType: 'added',
          },
        },
      })
    } else if (tag[0] === 'a' && typeof tag[1] === 'string') {
      // Format: "<kind>:<author>:<d>"
      const segments = tag[1].split(':')
      const author = segments.length >= 2 ? lower(segments[1]) : null
      if (!author) continue
      entries.push({
        kind: 'save',
        eventId: `${event.id.toLowerCase()}:${entryIndex++}`,
        fromPubkey,
        toPubkey: author,
        createdAt: event.created_at,
        refEventId: null,
        payload: {
          kind: 'save',
          data: {
            entryEventId: null,
            entryAuthorPubkey: author,
            entryAddress: tag[1],
            listIdentifier,
            changeType: 'added',
          },
        },
      })
    }
  }
  return entries
}

// NIP-18 quote posts: kind 1 with a 'q' tag pointing at the quoted event.
// Recipient = quoted note's author (best effort: 'p' tag accompanying 'q',
// otherwise the first 'p' tag).
export const parseQuoteEvent = (event: RawNostrEvent): ParsedGraphEvent | null => {
  if (event.kind !== 1) return null
  const qTag = findTag(event.tags, 'q')
  if (!qTag) return null
  const fromPubkey = lower(event.pubkey)
  const quotedEventId = lower(qTag[1] ?? null)
  // 'q' tag may carry [, eventId, relayHint, pubkey] per NIP-18.
  const quotedAuthorFromQTag = lower(qTag[3] ?? null)
  const quotedAuthorFromP = lower(findTag(event.tags, 'p')?.[1] ?? null)
  const toPubkey = quotedAuthorFromQTag ?? quotedAuthorFromP
  if (!fromPubkey || !toPubkey) return null

  return {
    kind: 'quote',
    eventId: event.id.toLowerCase(),
    fromPubkey,
    toPubkey,
    createdAt: event.created_at,
    refEventId: quotedEventId,
    payload: {
      kind: 'quote',
      data: {
        quotedEventId,
        quotedAuthorPubkey: toPubkey,
        quoterContent: typeof event.content === 'string' ? event.content : '',
      },
    },
  }
}

// NIP-22 comments (kind 1111). Root = uppercase-tagged thread root.
// Parent = lowercase 'e'. Recipient = parent author if known, else root.
export const parseCommentEvent = (event: RawNostrEvent): ParsedGraphEvent | null => {
  if (event.kind !== 1111) return null
  const fromPubkey = lower(event.pubkey)
  if (!fromPubkey) return null

  const rootEventId = lower(findTag(event.tags, 'E')?.[1] ?? null)
  const parentEventId = lower(findTag(event.tags, 'e')?.[1] ?? rootEventId)
  // NIP-22 'P' (uppercase) is the root author; lowercase 'p' is the parent
  // author. Prefer the last lowercase p: relays can match any p tag, and the
  // parent/notification target is commonly appended after root metadata.
  const parentAuthor =
    lower(findLastTag(event.tags, 'p')?.[1] ?? null) ??
    lower(findTag(event.tags, 'P')?.[1] ?? null)
  if (!parentAuthor) return null

  return {
    kind: 'comment',
    eventId: event.id.toLowerCase(),
    fromPubkey,
    toPubkey: parentAuthor,
    createdAt: event.created_at,
    refEventId: parentEventId,
    payload: {
      kind: 'comment',
      data: {
        rootEventId,
        parentEventId,
        parentAuthorPubkey: parentAuthor,
        commentContent: typeof event.content === 'string' ? event.content : '',
      },
    },
  }
}

// Map a kind to its NDK filter shape and its parser. Some kinds (save) emit
// multiple parsed events from a single raw event; the parser returns an
// array. Single-output parsers are normalised to arrays here so the live
// hook has a uniform contract.
export interface KindParserSpec {
  // Nostr kinds to subscribe to.
  kinds: number[]
  // Most activity should be visible when it targets a node (`#p`) or when it
  // is authored by a node (`authors`). Saves (lists) are only authored by the
  // saver, so they stay `authors`.
  filterMode: 'p-tag-or-authors' | 'authors'
  parse: (event: RawNostrEvent) => ParsedGraphEvent[]
}

const wrapSingle =
  (parser: (event: RawNostrEvent) => ParsedGraphEvent | null) =>
  (event: RawNostrEvent): ParsedGraphEvent[] => {
    const result = parser(event)
    return result ? [result] : []
  }

export const KIND_PARSER_SPECS: Record<
  Exclude<import('@/features/graph-v2/events/types').GraphEventKind, 'zap'>,
  KindParserSpec
> = {
  like: {
    kinds: [7],
    filterMode: 'p-tag-or-authors',
    parse: wrapSingle(parseLikeEvent),
  },
  repost: {
    kinds: [6, 16],
    filterMode: 'p-tag-or-authors',
    parse: wrapSingle(parseRepostEvent),
  },
  save: {
    kinds: [10003, 30001],
    filterMode: 'authors',
    parse: parseSaveEvents,
  },
  quote: {
    kinds: [1],
    filterMode: 'p-tag-or-authors',
    parse: wrapSingle(parseQuoteEvent),
  },
  comment: {
    kinds: [1111],
    filterMode: 'p-tag-or-authors',
    parse: wrapSingle(parseCommentEvent),
  },
}
