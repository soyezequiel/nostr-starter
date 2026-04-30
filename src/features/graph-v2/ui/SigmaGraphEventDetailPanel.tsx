'use client'

import { nip19 } from 'nostr-tools'

import {
  GRAPH_EVENT_KIND_COLORS,
  GRAPH_EVENT_KIND_LABELS,
  GRAPH_EVENT_KIND_SINGULAR_LABELS,
  type GraphEventActivityLogEntry,
} from '@/features/graph-v2/events/types'
import { useReferencedNote } from '@/features/graph-v2/events/referencedNoteCache'

const HEX_64_RE = /^[0-9a-f]{64}$/i

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

const encodeNoteId = (eventId: string | null | undefined) => {
  if (!eventId || !HEX_64_RE.test(eventId)) return null
  try {
    return nip19.noteEncode(eventId)
  } catch {
    return null
  }
}

export interface SigmaGraphEventDetailPanelProps {
  entry: GraphEventActivityLogEntry
  resolveActorLabel: (pubkey: string) => string
  onBack: () => void
  onOpenIdentity: (pubkey: string, fallbackLabel: string) => void
  onReplay: () => void
  sourceLabel: string
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

function getEventSummary(entry: GraphEventActivityLogEntry): string {
  switch (entry.payload.kind) {
    case 'like':
      return `Reaccion: ${entry.payload.data.reaction || '+'}`
    case 'repost':
      return entry.payload.data.repostedKind
        ? `Repost de kind ${entry.payload.data.repostedKind}`
        : 'Repost'
    case 'save':
      return entry.payload.data.listIdentifier
        ? `Lista ${entry.payload.data.listIdentifier}`
        : 'Bookmark NIP-51'
    case 'quote':
      return 'Quote post'
    case 'comment':
      return 'Comment NIP-22'
    case 'zap':
      return entry.payload.data.amountSats
        ? `${entry.payload.data.amountSats} sats`
        : 'Zap'
  }
}

function getInlineText(entry: GraphEventActivityLogEntry): string | null {
  switch (entry.payload.kind) {
    case 'quote':
      return entry.payload.data.quoterContent.trim() || null
    case 'comment':
      return entry.payload.data.commentContent.trim() || null
    case 'repost':
      return entry.payload.data.embeddedContent?.trim() || null
    default:
      return null
  }
}

export function SigmaGraphEventDetailPanel({
  entry,
  resolveActorLabel,
  onBack,
  onOpenIdentity,
  onReplay,
  sourceLabel,
}: SigmaGraphEventDetailPanelProps): React.JSX.Element {
  const shouldFetchReferencedNote =
    entry.kind === 'quote' || entry.kind === 'comment'
  const referencedEventId = shouldFetchReferencedNote ? entry.refEventId : null
  const referencedNote = useReferencedNote(referencedEventId)
  const fromNpub = encodeNpub(entry.fromPubkey)
  const toNpub = encodeNpub(entry.toPubkey)
  const encodedRef = encodeNoteId(entry.refEventId)
  const readyReferencedEvent =
    referencedNote.phase === 'ready' ? referencedNote.event : null
  const referencedAuthorLabel = readyReferencedEvent
    ? resolveActorLabel(readyReferencedEvent.pubkey)
    : null
  const inlineText = getInlineText(entry)
  const color = GRAPH_EVENT_KIND_COLORS[entry.kind]

  return (
    <div className="sg-zap-detail">
      <div className="sg-zap-detail__head">
        <button
          className="sg-mini-action"
          onClick={onBack}
          type="button"
        >
          {'<- Volver a actividad'}
        </button>
      </div>

      <div
        className="sg-zap-detail__hero"
        style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}
      >
        <span className="sg-section-label">Detalle de actividad</span>
        <strong className="sg-zap-detail__amount" style={{ color }}>
          {GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]}
        </strong>
        <p className="sg-zap-detail__hero-meta">
          <span>{sourceLabel}</span>
          <span aria-hidden="true">{' - '}</span>
          <time dateTime={new Date(entry.createdAt * 1_000).toISOString()}>
            {formatTimestamp(entry.createdAt)}
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
          <span className="sg-zap-detail__row-label">Quien actuo</span>
          {renderActorButton(entry.fromPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Sobre quien impacto</span>
          {renderActorButton(entry.toPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Tipo</span>
          <span className="sg-zap-detail__row-value">
            {GRAPH_EVENT_KIND_LABELS[entry.kind]}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Resumen</span>
          <span className="sg-zap-detail__row-value">{getEventSummary(entry)}</span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Hora</span>
          <span className="sg-zap-detail__row-value">
            {formatTimestamp(entry.createdAt)}
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
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">Evento (id)</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {entry.eventId}
          </span>
        </section>
        {entry.refEventId ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">Referencia</span>
            <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
              {encodedRef ?? entry.refEventId}
            </span>
          </section>
        ) : null}
        {inlineText ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">
              Texto del {GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind].toLowerCase()}
            </span>
            <p className="sg-zap-detail__comment">{inlineText}</p>
          </section>
        ) : null}
      </div>

      {shouldFetchReferencedNote ? (
        <section className="sg-zap-detail__post">
          <header className="sg-zap-detail__post-head">
            <span className="sg-section-label">
              {entry.kind === 'quote' ? 'Nota citada' : 'Nota padre'}
            </span>
            {encodedRef ? (
              <code className="sg-zap-detail__post-id">{`${encodedRef.slice(0, 18)}...`}</code>
            ) : null}
          </header>
          {!referencedEventId ? (
            <p className="sg-zap-detail__post-empty">
              Este evento no trae una referencia concreta para cargar.
            </p>
          ) : referencedNote.phase === 'loading' ? (
            <p className="sg-zap-detail__post-empty">Cargando nota referenciada...</p>
          ) : readyReferencedEvent ? (
            <article className="sg-zap-detail__post-body">
              <div className="sg-zap-detail__post-meta">
                <button
                  className="sg-zap-detail__post-author"
                  onClick={() =>
                    onOpenIdentity(
                      readyReferencedEvent.pubkey,
                      referencedAuthorLabel ?? readyReferencedEvent.pubkey,
                    )
                  }
                  type="button"
                >
                  {referencedAuthorLabel}
                </button>
                <time
                  dateTime={new Date(
                    (readyReferencedEvent.created_at ?? 0) * 1_000,
                  ).toISOString()}
                >
                  {readyReferencedEvent.created_at
                    ? formatTimestamp(readyReferencedEvent.created_at)
                    : ''}
                </time>
              </div>
              <p className="sg-zap-detail__post-content">
                {readyReferencedEvent.content?.trim() || '(sin contenido textual)'}
              </p>
            </article>
          ) : referencedNote.phase === 'error' ? (
            <p className="sg-zap-detail__post-empty sg-zap-detail__post-empty--error">
              {referencedNote.message ?? 'No se pudo cargar la nota referenciada.'}
            </p>
          ) : (
            <p className="sg-zap-detail__post-empty">
              {referencedNote.message ?? 'No se encontro la nota referenciada.'}
            </p>
          )}
        </section>
      ) : null}

      <div className="sg-zap-detail__actions">
        <button
          className="sg-btn"
          onClick={onReplay}
          type="button"
        >
          Reproducir actividad
        </button>
      </div>
    </div>
  )
}
