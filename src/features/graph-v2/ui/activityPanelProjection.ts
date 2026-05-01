import type {
  GraphEventActivitySource,
  GraphEventKind,
  GraphEventPayload,
} from '@/features/graph-v2/events/types'
import type { SigmaActivityPanelV3Entry } from '@/features/graph-v2/ui/SigmaActivityPanelV3'

export type ActivityPanelProjectionSource = GraphEventActivitySource

export interface ActivityPanelProjectionZapEntry {
  type: 'zap'
  id: string
  source: ActivityPanelProjectionSource
  fromPubkey: string
  toPubkey: string
  played: boolean
  receivedAt: number
  zap: {
    sats: number
    comment?: string | null
    zapCreatedAt: number
  }
  graphEvent: null
}

export interface ActivityPanelProjectionGraphEventEntry {
  type: 'graph-event'
  id: string
  source: ActivityPanelProjectionSource
  fromPubkey: string
  toPubkey: string
  played: boolean
  receivedAt: number
  zap: null
  graphEvent: {
    kind: GraphEventKind
    createdAt: number
    payload: GraphEventPayload
  }
}

export type ActivityPanelProjectionEntry =
  | ActivityPanelProjectionZapEntry
  | ActivityPanelProjectionGraphEventEntry

export type ActivityActorLabelResolver = (pubkey: string) => string

interface ActivityPanelProjectionOptions {
  showTextPreviews?: boolean
}

function getGraphEventText(
  entry: ActivityPanelProjectionGraphEventEntry,
  showTextPreviews: boolean,
): string {
  if (!showTextPreviews) return ''
  const payload = entry.graphEvent.payload
  switch (payload.kind) {
    case 'quote':
      return payload.data.quoterContent || ''
    case 'comment':
      return payload.data.commentContent || ''
    case 'repost':
      return payload.data.embeddedContent || ''
    default:
      return ''
  }
}

function getGraphEventSats(entry: ActivityPanelProjectionGraphEventEntry): number {
  const payload = entry.graphEvent.payload
  return payload.kind === 'zap' ? (payload.data.amountSats ?? 0) : 0
}

function areActivityPanelEntriesEqual(
  left: SigmaActivityPanelV3Entry,
  right: SigmaActivityPanelV3Entry,
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.source === right.source &&
    left.fromPubkey === right.fromPubkey &&
    left.toPubkey === right.toPubkey &&
    left.fromLabel === right.fromLabel &&
    left.toLabel === right.toLabel &&
    left.played === right.played &&
    left.receivedAt === right.receivedAt &&
    left.occurredAt === right.occurredAt &&
    left.sats === right.sats &&
    left.text === right.text
  )
}

export function projectActivityPanelEntries(
  entries: readonly ActivityPanelProjectionEntry[],
  resolveActorLabel: ActivityActorLabelResolver,
  previousEntries: readonly SigmaActivityPanelV3Entry[] = [],
  options: ActivityPanelProjectionOptions = {},
): SigmaActivityPanelV3Entry[] {
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]))
  const showTextPreviews = options.showTextPreviews ?? true

  return entries.map((entry) => {
    const isZap = entry.type === 'zap'
    const next: SigmaActivityPanelV3Entry = {
      id: entry.id,
      kind: isZap ? 'zap' : entry.graphEvent.kind,
      source: entry.source,
      fromPubkey: entry.fromPubkey,
      toPubkey: entry.toPubkey,
      fromLabel: resolveActorLabel(entry.fromPubkey),
      toLabel: resolveActorLabel(entry.toPubkey),
      played: entry.played,
      receivedAt: entry.receivedAt,
      occurredAt: isZap
        ? entry.zap.zapCreatedAt * 1_000
        : entry.graphEvent.createdAt * 1_000,
      sats: isZap ? entry.zap.sats : getGraphEventSats(entry),
      text: isZap
        ? entry.zap.comment?.trim() || ''
        : getGraphEventText(entry, showTextPreviews),
    }
    const previous = previousById.get(next.id)
    return previous && areActivityPanelEntriesEqual(previous, next)
      ? previous
      : next
  })
}
