import type {
  DecodeZapsRequest,
  DecodeZapsResult,
  EventsWorkerActionMap,
  KeywordExtractInput,
  ParseContactListRequest,
  ParseContactListResult,
  SearchKeywordsRequest,
  SearchKeywordsResult,
  SerializedContactListEvent,
  ZapReceiptInput,
} from '@/features/graph/workers/events/contracts'
import type { WorkerDiagnostic } from '@/features/graph/workers/shared/protocol'
import { WorkerProtocolError } from '@/features/graph/workers/shared/protocol'
import type { WorkerHandlerRegistry } from '@/features/graph/workers/shared/runtime'
import {
  expectArray,
  expectFiniteNumber,
  expectOptionalPositiveInteger,
  expectRecord,
  expectString,
  expectStringMatrix,
  normalizeEventId,
  normalizePubkey,
} from '@/features/graph/workers/shared/validation'

const DEFAULT_MAX_FOLLOW_TAGS = 5_000
const DEFAULT_EXCERPT_LENGTH = 160

function validateSerializedContactListEvent(payload: unknown): SerializedContactListEvent {
  const event = expectRecord(payload, 'payload.event')

  return {
    id: normalizeEventId(event.id, 'payload.event.id'),
    pubkey: normalizePubkey(event.pubkey, 'payload.event.pubkey'),
    kind: expectFiniteNumber(event.kind, 'payload.event.kind'),
    createdAt: expectFiniteNumber(event.createdAt, 'payload.event.createdAt'),
    tags: expectStringMatrix(event.tags, 'payload.event.tags'),
  }
}

function validateParseContactListRequest(payload: unknown): ParseContactListRequest {
  const request = expectRecord(payload, 'payload')

  return {
    event: validateSerializedContactListEvent(request.event),
    maxFollowTags: expectOptionalPositiveInteger(request.maxFollowTags, 'payload.maxFollowTags'),
  }
}

function validateKeywordExtract(payload: unknown, index: number): KeywordExtractInput {
  const extract = expectRecord(payload, `payload.extracts[${index}]`)

  return {
    noteId: normalizeEventId(extract.noteId, `payload.extracts[${index}].noteId`),
    pubkey: normalizePubkey(extract.pubkey, `payload.extracts[${index}].pubkey`),
    text: expectString(extract.text, `payload.extracts[${index}].text`),
  }
}

function validateSearchKeywordsRequest(payload: unknown): SearchKeywordsRequest {
  const request = expectRecord(payload, 'payload')
  const extracts = expectArray(request.extracts, 'payload.extracts')

  return {
    keyword: expectString(request.keyword, 'payload.keyword'),
    extracts: extracts.map((extract, index) => validateKeywordExtract(extract, index)),
  }
}

function validateZapReceipt(payload: unknown, index: number): ZapReceiptInput {
  const event = expectRecord(payload, `payload.events[${index}]`)

  return {
    id: normalizeEventId(event.id, `payload.events[${index}].id`),
    kind: expectFiniteNumber(event.kind, `payload.events[${index}].kind`),
    createdAt: expectFiniteNumber(event.createdAt, `payload.events[${index}].createdAt`),
    tags: expectStringMatrix(event.tags, `payload.events[${index}].tags`),
  }
}

function validateDecodeZapsRequest(payload: unknown): DecodeZapsRequest {
  const request = expectRecord(payload, 'payload')
  const events = expectArray(request.events, 'payload.events')

  return {
    events: events.map((event, index) => validateZapReceipt(event, index)),
  }
}

function createDiagnostic(code: string, message: string, detail?: string): WorkerDiagnostic {
  return {
    code,
    message,
    detail,
  }
}

export function parseContactList(request: ParseContactListRequest): ParseContactListResult {
  if (request.event.kind !== 3) {
    throw new WorkerProtocolError(
      'CONTACT_LIST_INVALID_KIND',
      'Contact list parsing expects a kind 3 event.',
      { kind: request.event.kind },
    )
  }

  const maxFollowTags = request.maxFollowTags ?? DEFAULT_MAX_FOLLOW_TAGS
  const followPubkeys = new Set<string>()
  const relayHints = new Set<string>()
  const diagnostics: WorkerDiagnostic[] = []
  let processedFollowTags = 0

  request.event.tags.forEach((tag) => {
    if (tag[0] !== 'p') {
      return
    }

    processedFollowTags += 1

    if (processedFollowTags > maxFollowTags) {
      diagnostics.push(
        createDiagnostic(
          'FOLLOW_TAG_CAP_REACHED',
          'The contact list exceeded the configured follow-tag budget.',
          `maxFollowTags=${maxFollowTags}`,
        ),
      )
      return
    }

    const followedPubkey = tag[1]?.trim().toLowerCase()
    if (!followedPubkey) {
      diagnostics.push(
        createDiagnostic(
          'FOLLOW_TAG_MALFORMED',
          'A follow tag was skipped because it did not contain a pubkey.',
        ),
      )
      return
    }

    if (!/^[0-9a-f]{8,}$/i.test(followedPubkey)) {
      diagnostics.push(
        createDiagnostic(
          'FOLLOW_TAG_INVALID_PUBKEY',
          'A follow tag was skipped because its pubkey was not hexadecimal.',
          followedPubkey,
        ),
      )
      return
    }

    followPubkeys.add(followedPubkey)

    const relayHint = tag[2]?.trim()
    if (relayHint) {
      relayHints.add(relayHint)
    }
  })

  const orderedFollowPubkeys = [...followPubkeys].sort()
  const sourcePubkey = request.event.pubkey
  const nodePubkeys = new Set<string>([sourcePubkey, ...orderedFollowPubkeys])

  return {
    nodes: [...nodePubkeys].sort().map((pubkey) => ({ pubkey })),
    links: orderedFollowPubkeys.map((targetPubkey) => ({
      sourcePubkey,
      targetPubkey,
    })),
    followPubkeys: orderedFollowPubkeys,
    relayHints: [...relayHints].sort(),
    diagnostics,
  }
}

function tokenizeKeyword(keyword: string): string[] {
  return [...new Set(keyword.toLowerCase().split(/\s+/).filter((token) => token.length > 1))].sort()
}

function countOccurrences(text: string, token: string): number {
  let count = 0
  let index = text.indexOf(token)

  while (index !== -1) {
    count += 1
    index = text.indexOf(token, index + token.length)
  }

  return count
}

export function searchKeywords(request: SearchKeywordsRequest): SearchKeywordsResult {
  const tokens = tokenizeKeyword(request.keyword)

  if (tokens.length === 0) {
    throw new WorkerProtocolError(
      'INVALID_KEYWORD_QUERY',
      'Keyword search expects at least one searchable token.',
    )
  }

  const hitCounts = new Map<string, number>()
  const excerptMatches = request.extracts.flatMap((extract) => {
    const normalizedText = extract.text.toLowerCase()
    const matchedTokens = tokens.filter((token) => normalizedText.includes(token))

    if (matchedTokens.length === 0) {
      return []
    }

    const score = matchedTokens.reduce((total, token) => total + countOccurrences(normalizedText, token), 0)
    hitCounts.set(extract.pubkey, (hitCounts.get(extract.pubkey) ?? 0) + score)

    return [
      {
        noteId: extract.noteId,
        pubkey: extract.pubkey,
        excerpt: extract.text.slice(0, DEFAULT_EXCERPT_LENGTH),
        matchedTokens,
        score,
      },
    ]
  })

  const orderedHitCounts = Object.fromEntries(
    [...hitCounts.entries()].sort(([leftPubkey], [rightPubkey]) =>
      leftPubkey.localeCompare(rightPubkey),
    ),
  )

  return {
    tokens,
    hitCounts: orderedHitCounts,
    excerptMatches,
  }
}

function findTagValue(tags: string[][], tagName: string): string | undefined {
  return tags.find((tag) => tag[0] === tagName)?.[1]
}

function parseZapDescription(descriptionRaw: string): string {
  let parsed: unknown

  try {
    parsed = JSON.parse(descriptionRaw)
  } catch {
    throw new WorkerProtocolError(
      'ZAP_DESCRIPTION_INVALID',
      'Zap receipt description is not valid JSON.',
    )
  }

  const description = expectRecord(parsed, 'zap.description')
  return normalizePubkey(description.pubkey, 'zap.description.pubkey')
}

function parseAmountTagToSats(amountTag: string | undefined): number | null {
  if (!amountTag) {
    return null
  }

  const millisats = Number.parseInt(amountTag, 10)
  if (!Number.isFinite(millisats) || millisats <= 0) {
    throw new WorkerProtocolError(
      'ZAP_AMOUNT_INVALID',
      'Zap receipt amount tag must be a positive integer in millisats.',
      { amountTag },
    )
  }

  return Math.floor(millisats / 1_000)
}

function parseBolt11ToSats(invoice: string | undefined): number | null {
  if (!invoice) {
    return null
  }

  const match = /^ln(?:bc|tb|bcrt)(\d+)?([munp]?)(?=1)/i.exec(invoice)
  if (!match) {
    throw new WorkerProtocolError('ZAP_INVOICE_INVALID', 'Zap receipt bolt11 invoice is invalid.')
  }

  const [, amountDigits, unit = ''] = match
  if (!amountDigits) {
    return null
  }

  const amount = BigInt(amountDigits)
  const millisatsByUnit = {
    '': 100_000_000_000n,
    m: 100_000_000n,
    u: 100_000n,
    n: 100n,
    p: 0n,
  } as const

  if (unit === 'p') {
    const millisats = amount / 10n
    return Number(millisats / 1_000n)
  }

  const multiplier = millisatsByUnit[unit as keyof typeof millisatsByUnit]
  const millisats = amount * multiplier

  return Number(millisats / 1_000n)
}

export function decodeZaps(request: DecodeZapsRequest): DecodeZapsResult {
  const zapEdges: DecodeZapsResult['zapEdges'] = []
  const skippedReceipts: WorkerDiagnostic[] = []

  request.events.forEach((event) => {
    try {
      if (event.kind !== 9735) {
        throw new WorkerProtocolError(
          'ZAP_KIND_INVALID',
          'Zap decoding expects kind 9735 receipts.',
          { kind: event.kind },
        )
      }

      const toPubkey = normalizePubkey(findTagValue(event.tags, 'p'), 'zap.tags.p')
      const fromPubkey = parseZapDescription(expectString(findTagValue(event.tags, 'description'), 'zap.tags.description'))
      const amountFromTag = parseAmountTagToSats(findTagValue(event.tags, 'amount'))
      const amountFromInvoice = parseBolt11ToSats(findTagValue(event.tags, 'bolt11'))
      const sats = amountFromTag ?? amountFromInvoice

      if (!sats || sats <= 0) {
        throw new WorkerProtocolError(
          'ZAP_AMOUNT_MISSING',
          'Zap receipt does not contain a usable amount.',
          { eventId: event.id },
        )
      }

      zapEdges.push({
        eventId: event.id,
        fromPubkey,
        toPubkey,
        sats,
        createdAt: event.createdAt,
      })
    } catch (error) {
      const normalizedError =
        error instanceof WorkerProtocolError
          ? error
          : new WorkerProtocolError('ZAP_DECODE_FAILED', 'Zap decoding failed.')

      skippedReceipts.push(
        createDiagnostic(
          normalizedError.code,
          normalizedError.message,
          `eventId=${event.id}`,
        ),
      )
    }
  })

  return {
    zapEdges,
    skippedReceipts,
  }
}

export function createEventsWorkerRegistry(): WorkerHandlerRegistry<EventsWorkerActionMap> {
  return {
    PARSE_CONTACT_LIST: {
      validate: validateParseContactListRequest,
      handle: parseContactList,
    },
    SEARCH_KEYWORDS: {
      validate: validateSearchKeywordsRequest,
      handle: searchKeywords,
    },
    DECODE_ZAPS: {
      validate: validateDecodeZapsRequest,
      handle: decodeZaps,
    },
  }
}
