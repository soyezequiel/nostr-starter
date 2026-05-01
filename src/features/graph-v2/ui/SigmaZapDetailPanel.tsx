'use client'

import { useLocale, useTranslations } from 'next-intl'
import { nip19 } from 'nostr-tools'

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
  const fromNpub = encodeNpub(entry.fromPubkey)
  const toNpub = encodeNpub(entry.toPubkey)
  const receiptId = entry.eventId ?? null
  const externalPostLinks = buildActivityPostExternalLinks(zappedEventId)

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
