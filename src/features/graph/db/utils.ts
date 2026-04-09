import type {
  AddressableHeadRecord,
  CaptureScope,
  ContactListRecord,
  ProfileRecord,
  RawEventRecord,
  ReplaceableHeadRecord,
} from '@/features/graph/db/entities'

export function toSortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right),
  )
}

export function mergeCaptureScope(
  currentScope: CaptureScope,
  incomingScope: CaptureScope,
): CaptureScope {
  if (currentScope === 'deep' || incomingScope === 'deep') {
    return 'deep'
  }

  return 'snapshot'
}

export function buildTieBreakKey(createdAt: number, eventId: string): string {
  return `${createdAt}:${eventId}`
}

export function shouldReplaceCanonicalHead(
  current: Pick<ReplaceableHeadRecord, 'createdAt' | 'eventId'>,
  incoming: Pick<ReplaceableHeadRecord, 'createdAt' | 'eventId'>,
): boolean
export function shouldReplaceCanonicalHead(
  current: Pick<AddressableHeadRecord, 'createdAt' | 'eventId'>,
  incoming: Pick<AddressableHeadRecord, 'createdAt' | 'eventId'>,
): boolean
export function shouldReplaceCanonicalHead(
  current: { createdAt: number; eventId: string },
  incoming: { createdAt: number; eventId: string },
): boolean {
  if (incoming.createdAt !== current.createdAt) {
    return incoming.createdAt > current.createdAt
  }

  return incoming.eventId.localeCompare(current.eventId) < 0
}

export function shouldReplaceProjection(
  current: Pick<ProfileRecord, 'createdAt' | 'eventId'>,
  incoming: Pick<ProfileRecord, 'createdAt' | 'eventId'>,
): boolean
export function shouldReplaceProjection(
  current: Pick<ContactListRecord, 'createdAt' | 'eventId'>,
  incoming: Pick<ContactListRecord, 'createdAt' | 'eventId'>,
): boolean
export function shouldReplaceProjection(
  current: { createdAt: number; eventId: string },
  incoming: { createdAt: number; eventId: string },
): boolean {
  if (incoming.createdAt !== current.createdAt) {
    return incoming.createdAt > current.createdAt
  }

  return incoming.eventId.localeCompare(current.eventId) < 0
}

export function compareRawEvents(left: RawEventRecord, right: RawEventRecord): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  if (left.kind !== right.kind) {
    return left.kind - right.kind
  }

  return left.id.localeCompare(right.id)
}
