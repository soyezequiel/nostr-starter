'use client'

import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

import { connectNDK } from '@/lib/nostr'

const HEX_64_RE = /^[0-9a-f]{64}$/i
const REFERENCED_NOTE_TIMEOUT_MS = 8_000

export type ReferencedNotePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface ReferencedNoteState {
  phase: ReferencedNotePhase
  event: NDKEvent | null
  message: string | null
}

const EMPTY_NOTE_STATE: ReferencedNoteState = {
  phase: 'empty',
  event: null,
  message: null,
}

const requestCache = new Map<string, Promise<ReferencedNoteState>>()

function normalizeEventId(eventId: string | null | undefined): string | null {
  if (!eventId || !HEX_64_RE.test(eventId)) {
    return null
  }
  return eventId.toLowerCase()
}

async function fetchReferencedNoteState(eventId: string): Promise<ReferencedNoteState> {
  try {
    const ndk = await connectNDK()
    const event = await Promise.race([
      ndk.fetchEvent({ ids: [eventId] }),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), REFERENCED_NOTE_TIMEOUT_MS)
      }),
    ])

    if (event) {
      return { phase: 'ready', event, message: null }
    }

    return {
      phase: 'empty',
      event: null,
      message: 'No encontramos la nota referenciada en los relays.',
    }
  } catch (error) {
    return {
      phase: 'error',
      event: null,
      message:
        error instanceof Error
          ? error.message
          : 'No se pudo cargar la nota referenciada.',
    }
  }
}

export function getReferencedNote(eventId: string): Promise<ReferencedNoteState> {
  const normalized = normalizeEventId(eventId)
  if (!normalized) {
    return Promise.resolve(EMPTY_NOTE_STATE)
  }

  const cached = requestCache.get(normalized)
  if (cached) {
    return cached
  }

  const request = fetchReferencedNoteState(normalized)
  requestCache.set(normalized, request)
  return request
}

export function useReferencedNote(
  eventId: string | null | undefined,
): ReferencedNoteState {
  const normalizedEventId = normalizeEventId(eventId)
  const [fetchResult, setFetchResult] = useState<{
    eventId: string
    state: ReferencedNoteState
  } | null>(null)

  useEffect(() => {
    if (!normalizedEventId) {
      return undefined
    }

    let cancelled = false
    void getReferencedNote(normalizedEventId).then((state) => {
      if (cancelled) {
        return
      }
      setFetchResult({ eventId: normalizedEventId, state })
    })

    return () => {
      cancelled = true
    }
  }, [normalizedEventId])

  if (!normalizedEventId) return EMPTY_NOTE_STATE
  if (fetchResult && fetchResult.eventId === normalizedEventId) {
    return fetchResult.state
  }
  return { phase: 'loading', event: null, message: null }
}
