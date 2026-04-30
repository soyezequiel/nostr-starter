import type {
  GraphEventActivityLogEntry,
  GraphEventActivitySource,
  ParsedGraphEvent,
} from '@/features/graph-v2/events/types'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

export function parsedZapToGraphEvent(
  zap: Pick<
    ParsedZap,
    | 'eventId'
    | 'fromPubkey'
    | 'toPubkey'
    | 'sats'
    | 'createdAt'
    | 'zappedEventId'
    | 'comment'
  >,
): ParsedGraphEvent {
  return {
    kind: 'zap',
    eventId: zap.eventId,
    fromPubkey: zap.fromPubkey,
    toPubkey: zap.toPubkey,
    createdAt: zap.createdAt,
    refEventId: zap.zappedEventId ?? null,
    payload: {
      kind: 'zap',
      data: {
        amountSats: zap.sats,
        bolt11: null,
        comment: zap.comment ?? null,
        zappedEventId: zap.zappedEventId ?? null,
      },
    },
  }
}

export function activityEntryToParsedGraphEvent(
  entry: GraphEventActivityLogEntry,
): ParsedGraphEvent {
  return {
    kind: entry.kind,
    eventId: entry.eventId,
    fromPubkey: entry.fromPubkey,
    toPubkey: entry.toPubkey,
    createdAt: entry.createdAt,
    refEventId: entry.refEventId,
    payload: entry.payload,
  }
}

export function graphEventToActivityEntry({
  event,
  id,
  source,
  played,
  receivedAt,
}: {
  event: ParsedGraphEvent
  id: string
  source: GraphEventActivitySource
  played: boolean
  receivedAt: number
}): GraphEventActivityLogEntry {
  return {
    id,
    eventId: event.eventId,
    source,
    kind: event.kind,
    fromPubkey: event.fromPubkey,
    toPubkey: event.toPubkey,
    played,
    createdAt: event.createdAt,
    receivedAt,
    refEventId: event.refEventId,
    payload: event.payload,
  }
}
