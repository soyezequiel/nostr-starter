'use client'

import { useLocale, useTranslations } from 'next-intl'
import { nip19 } from 'nostr-tools'

import {
  useReferencedNote,
  type ReferencedNoteState,
} from '@/features/graph-v2/events/referencedNoteCache'
import { buildActivityPostExternalLinks } from '@/features/graph-v2/ui/activityPostLinks'

const HEX_64_RE = /^[0-9a-f]{64}$/i

const formatTimestamp = (createdAtSeconds: number, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  }).format(new Date(createdAtSeconds * 1_000))

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

type ZapPostState = ReferencedNoteState

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
  const locale = useLocale()
  const t = useTranslations('sigma.zaps.detail')
  const zappedEventId = entry.zappedEventId ?? null
  const post: ZapPostState = useReferencedNote(zappedEventId)
  const fromNpub = encodeNpub(entry.fromPubkey)
  const toNpub = encodeNpub(entry.toPubkey)
  const noteId = encodeNoteId(zappedEventId ?? '') ?? null
  const receiptId = entry.eventId ?? null
  const externalPostLinks = buildActivityPostExternalLinks(zappedEventId)
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
          {t('backToZaps')}
        </button>
      </div>

      <div className="sg-zap-detail__hero">
        <span className="sg-section-label">{t('zapDetail')}</span>
        <strong className="sg-zap-detail__amount">
          {new Intl.NumberFormat(locale).format(entry.sats)} sats
        </strong>
        <p className="sg-zap-detail__hero-meta">
          <span>{sourceLabel}</span>
          <span aria-hidden="true">{' - '}</span>
          <time dateTime={new Date(entry.zapCreatedAt * 1_000).toISOString()}>
            {formatTimestamp(entry.zapCreatedAt, locale)}
          </time>
        </p>
        <p className="sg-zap-detail__hero-status">
          {entry.played
            ? t('played')
            : t('outsideView')}
        </p>
      </div>

      <div className="sg-zap-detail__grid">
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('sentBy')}</span>
          {renderActorButton(entry.fromPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('receivedBy')}</span>
          {renderActorButton(entry.toPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('amount')}</span>
          <span className="sg-zap-detail__row-value">
            {new Intl.NumberFormat(locale).format(entry.sats)} sats
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('time')}</span>
          <span className="sg-zap-detail__row-value">
            {formatTimestamp(entry.zapCreatedAt, locale)}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('senderIdentity')}</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {fromNpub ?? entry.fromPubkey}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('receiverIdentity')}</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {toNpub ?? entry.toPubkey}
          </span>
        </section>
        {receiptId ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">{t('receipt')}</span>
            <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
              {receiptId}
            </span>
          </section>
        ) : null}
        {entry.comment ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">{t('comment')}</span>
            <p className="sg-zap-detail__comment">{entry.comment}</p>
          </section>
        ) : null}
      </div>

      <section className="sg-zap-detail__post">
        <header className="sg-zap-detail__post-head">
          <span className="sg-section-label">{t('zappedPost')}</span>
          {noteId ? (
            <code className="sg-zap-detail__post-id">{`${noteId.slice(0, 18)}...`}</code>
          ) : null}
        </header>
        {!zappedEventId ? (
          <p className="sg-zap-detail__post-empty">
            {t('profileZap')}
          </p>
        ) : post.phase === 'loading' ? (
          <p className="sg-zap-detail__post-empty">{t('loadingOriginalPost')}</p>
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
                  ? formatTimestamp(readyPostEvent.created_at, locale)
                  : ''}
              </time>
            </div>
            <p className="sg-zap-detail__post-content">
              {readyPostEvent.content?.trim() || t('noTextContent')}
            </p>
          </article>
        ) : post.phase === 'error' ? (
          <p className="sg-zap-detail__post-empty sg-zap-detail__post-empty--error">
            {post.message ?? t('originalPostError')}
          </p>
        ) : (
          <p className="sg-zap-detail__post-empty">
            {post.message ?? t('originalPostMissing')}
          </p>
        )}
      </section>

      <div className="sg-zap-detail__actions">
        <button
          className="sg-btn"
          onClick={onReplay}
          type="button"
        >
          {t('replayZap')}
        </button>
        {externalPostLinks ? (
          <>
            <a
              className="sg-btn"
              href={externalPostLinks.primalUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('openPrimal')}
            </a>
            <a
              className="sg-btn"
              href={externalPostLinks.jumbleUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('openJumble')}
            </a>
          </>
        ) : null}
      </div>
    </div>
  )
}
