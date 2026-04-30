'use client'

import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

import { connectNDK } from '@/lib/nostr'

const HEX_64_RE = /^[0-9a-f]{64}$/i

type FetchPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

interface ZapPostState {
  phase: FetchPhase
  event: NDKEvent | null
  message: string | null
}

const TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const formatTimestamp = (createdAtSeconds: number) =>
  TIME_FORMATTER.format(new Date(createdAtSeconds * 1_000))

const encodeNpub = (pubkey: string) => {
  if (!HEX_64_RE.test(pubkey)) return null
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

const encodeNoteId = (eventId: string) => {
  if (!HEX_64_RE.test(eventId)) return null
  try {
    return nip19.noteEncode(eventId)
  } catch {
    return null
  }
}

const integerFormatter = new Intl.NumberFormat('es-AR')

export interface SigmaZapDetailEntry {
  id: string
  source: 'live' | 'recent' | 'simulated'
  fromPubkey: string
  toPubkey: string
  sats: number
  played: boolean
  // Cuando llego a la UI (ms epoch) - util para diferenciar entradas duplicadas.
  createdAt: number
  // Timestamp original del zap (s epoch).
  zapCreatedAt: number
  eventId?: string
  zappedEventId?: string | null
  comment?: string | null
}

export interface SigmaZapDetailPanelProps {
  entry: SigmaZapDetailEntry
  resolveActorLabel: (pubkey: string) => string
  onBack: () => void
  onOpenIdentity: (pubkey: string, fallbackLabel: string) => void
  onReplay: () => void
  sourceLabel: string
}

const EMPTY_POST_STATE: ZapPostState = {
  phase: 'empty',
  event: null,
  message: null,
}

function useZapPost(eventId: string | null | undefined): ZapPostState {
  // Solo guardamos el resultado de la fetch (ready/empty/error) por eventId.
  // El estado "loading" se deriva de "no hay resultado para este eventId".
  const [fetchResult, setFetchResult] = useState<{
    eventId: string
    state: ZapPostState
  } | null>(null)

  useEffect(() => {
    if (!eventId) {
      return undefined
    }

    let cancelled = false

    void (async () => {
      try {
        const ndk = await connectNDK()
        // fetchEvent solo trae el evento solicitado, sin abrir suscripciones
        // residuales. Si los relays demoran mas de 8s lo damos por vacio.
        const timeoutMs = 8_000
        const event = await Promise.race([
          ndk.fetchEvent({ ids: [eventId] }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ])

        if (cancelled) return
        if (event) {
          setFetchResult({
            eventId,
            state: { phase: 'ready', event, message: null },
          })
        } else {
          setFetchResult({
            eventId,
            state: {
              phase: 'empty',
              event: null,
              message: 'No encontramos el post original en los relays.',
            },
          })
        }
      } catch (error) {
        if (cancelled) return
        setFetchResult({
          eventId,
          state: {
            phase: 'error',
            event: null,
            message:
              error instanceof Error
                ? error.message
                : 'No se pudo cargar el post original.',
          },
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [eventId])

  if (!eventId) return EMPTY_POST_STATE
  if (fetchResult && fetchResult.eventId === eventId) return fetchResult.state
  return { phase: 'loading', event: null, message: null }
}

const renderActorButton = (
  pubkey: string,
  resolveActorLabel: (pubkey: string) => string,
  onOpenIdentity: (pubkey: string, fallbackLabel: string) => void,
) => {
  const npub = encodeNpub(pubkey)
  const actorLabel = resolveActorLabel(pubkey)
  return (
    <button
      className="sg-zap-detail__actor"
      onClick={() => onOpenIdentity(pubkey, actorLabel)}
      type="button"
    >
      <span className="sg-zap-detail__actor-name">{actorLabel}</span>
      <span className="sg-zap-detail__actor-id">
        {npub ? `${npub.slice(0, 14)}...` : `${pubkey.slice(0, 12)}...`}
      </span>
    </button>
  )
}

export function SigmaZapDetailPanel({
  entry,
  resolveActorLabel,
  onBack,
  onOpenIdentity,
  onReplay,
  sourceLabel,
}: SigmaZapDetailPanelProps): React.JSX.Element {
  const zappedEventId = entry.zappedEventId ?? null
  const post = useZapPost(zappedEventId)
  const fromNpub = encodeNpub(entry.fromPubkey)
  const toNpub = encodeNpub(entry.toPubkey)
  const noteId = encodeNoteId(zappedEventId ?? '') ?? null
  const receiptId = entry.eventId ?? null
  const readyPostEvent = post.phase === 'ready' ? post.event : null
  const postAuthorLabel = readyPostEvent
    ? resolveActorLabel(readyPostEvent.pubkey)
    : null

  return (
    <div className="sg-zap-detail">
      <div className="sg-zap-detail__head">
        <button
          className="sg-mini-action"
          onClick={onBack}
          type="button"
        >
          {'<- Volver al panel de zaps'}
        </button>
      </div>

      <div className="sg-zap-detail__hero">
        <span className="sg-section-label">Detalle del zap</span>
        <strong className="sg-zap-detail__amount">
          {integerFormatter.format(entry.sats)} sats
        </strong>
        <p className="sg-zap-detail__hero-meta">
          <span>{sourceLabel}</span>
          <span aria-hidden="true">{' - '}</span>
          <time dateTime={new Date(entry.zapCreatedAt * 1_000).toISOString()}>
            {formatTimestamp(entry.zapCreatedAt)}
          </time>
        </p>
        <p className="sg-zap-detail__hero-status">
          {entry.played
            ? 'Reproducido en el grafo actual.'
            : 'Quedo fuera de la vista actual.'}
        </p>
      </div>

      <div className="sg-zap-detail__grid">
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Quien envio</span>
          {renderActorButton(entry.fromPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Quien recibio</span>
          {renderActorButton(entry.toPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Monto</span>
          <span className="sg-zap-detail__row-value">
            {integerFormatter.format(entry.sats)} sats
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Hora</span>
          <span className="sg-zap-detail__row-value">
            {formatTimestamp(entry.zapCreatedAt)}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Identidad emisora (npub)</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {fromNpub ?? entry.fromPubkey}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Identidad receptora (npub)</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {toNpub ?? entry.toPubkey}
          </span>
        </section>
        {receiptId ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">Recibo (id)</span>
            <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
              {receiptId}
            </span>
          </section>
        ) : null}
        {entry.comment ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">Comentario</span>
            <p className="sg-zap-detail__comment">{entry.comment}</p>
          </section>
        ) : null}
      </div>

      <section className="sg-zap-detail__post">
        <header className="sg-zap-detail__post-head">
          <span className="sg-section-label">Post zapeado</span>
          {noteId ? (
            <code className="sg-zap-detail__post-id">{`${noteId.slice(0, 18)}...`}</code>
          ) : null}
        </header>
        {!zappedEventId ? (
          <p className="sg-zap-detail__post-empty">
            Este zap no apunta a una nota concreta (parece un zap a perfil).
          </p>
        ) : post.phase === 'loading' ? (
          <p className="sg-zap-detail__post-empty">Cargando post original...</p>
        ) : readyPostEvent ? (
          <article className="sg-zap-detail__post-body">
            <div className="sg-zap-detail__post-meta">
              <button
                className="sg-zap-detail__post-author"
                onClick={() => onOpenIdentity(readyPostEvent.pubkey, postAuthorLabel ?? readyPostEvent.pubkey)}
                type="button"
              >
                {postAuthorLabel}
              </button>
              <time
                dateTime={new Date((readyPostEvent.created_at ?? 0) * 1_000).toISOString()}
              >
                {readyPostEvent.created_at
                  ? formatTimestamp(readyPostEvent.created_at)
                  : ''}
              </time>
            </div>
            <p className="sg-zap-detail__post-content">
              {readyPostEvent.content?.trim() || '(sin contenido textual)'}
            </p>
          </article>
        ) : post.phase === 'error' ? (
          <p className="sg-zap-detail__post-empty sg-zap-detail__post-empty--error">
            {post.message ?? 'No se pudo cargar el post original.'}
          </p>
        ) : (
          <p className="sg-zap-detail__post-empty">
            {post.message ?? 'No se encontro el post original en los relays.'}
          </p>
        )}
      </section>

      <div className="sg-zap-detail__actions">
        <button
          className="sg-btn"
          onClick={onReplay}
          type="button"
        >
          Reproducir zap
        </button>
      </div>
    </div>
  )
}
