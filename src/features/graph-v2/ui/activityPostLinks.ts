import { nip19 } from 'nostr-tools'

const HEX_64_RE = /^[0-9a-f]{64}$/i

export interface ActivityPostExternalLinks {
  primalUrl: string
  jumbleUrl: string
}

export function buildActivityPostExternalLinks(
  eventId: string | null | undefined,
): ActivityPostExternalLinks | null {
  if (!eventId || !HEX_64_RE.test(eventId)) {
    return null
  }

  const normalizedEventId = eventId.toLowerCase()

  try {
    const nevent = nip19.neventEncode({ id: normalizedEventId })
    const note = nip19.noteEncode(normalizedEventId)
    return {
      primalUrl: `https://primal.net/e/${nevent}`,
      jumbleUrl: `https://jumble.social/notes/${note}`,
    }
  } catch {
    return null
  }
}
