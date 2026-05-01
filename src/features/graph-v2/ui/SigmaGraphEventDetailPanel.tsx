'use client'

import { useLocale, useTranslations } from 'next-intl'
import { nip19 } from 'nostr-tools'

import {
  GRAPH_EVENT_KIND_COLORS,
  GRAPH_EVENT_KIND_LABELS,
  GRAPH_EVENT_KIND_SINGULAR_LABELS,
  type GraphEventActivityLogEntry,
} from '@/features/graph-v2/events/types'
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

interface GraphEventDetailText {
  reaction: (reaction: string) => string
  repostKind: (kind: number) => string
  repost: string
  list: (identifier: string) => string
  bookmark: string
  quotePost: string
  commentNip22: string
  zap: string
}

function getEventSummary(entry: GraphEventActivityLogEntry, text: GraphEventDetailText): string {
  switch (entry.payload.kind) {
    case 'like':
      return text.reaction(entry.payload.data.reaction || '+')
    case 'repost':
      return entry.payload.data.repostedKind
        ? text.repostKind(entry.payload.data.repostedKind)
        : text.repost
    case 'save':
      return entry.payload.data.listIdentifier
        ? text.list(entry.payload.data.listIdentifier)
        : text.bookmark
    case 'quote':
      return text.quotePost
    case 'comment':
      return text.commentNip22
    case 'zap':
      return entry.payload.data.amountSats
        ? `${entry.payload.data.amountSats} sats`
        : text.zap
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
  const locale = useLocale()
  const t = useTranslations('sigma.zaps.detail')
  const fromNpub = encodeNpub(entry.fromPubkey)
  const toNpub = encodeNpub(entry.toPubkey)
  const encodedRef = encodeNoteId(entry.refEventId)
  const externalPostLinks = buildActivityPostExternalLinks(entry.refEventId)
  const inlineText = getInlineText(entry)
  const color = GRAPH_EVENT_KIND_COLORS[entry.kind]
  const summaryText: GraphEventDetailText = {
    reaction: (reaction) => t('reaction', { reaction }),
    repostKind: (kind) => t('repostKind', { kind }),
    repost: t('repost'),
    list: (identifier) => t('list', { identifier }),
    bookmark: t('bookmark'),
    quotePost: t('quotePost'),
    commentNip22: t('commentNip22'),
    zap: t('zap'),
  }

  return (
    <div className="sg-zap-detail">
      <div className="sg-zap-detail__head">
        <button
          className="sg-mini-action"
          onClick={onBack}
          type="button"
        >
          {t('backToActivities')}
        </button>
      </div>

      <div
        className="sg-zap-detail__hero"
        style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}
      >
        <span className="sg-section-label">{t('activityDetail')}</span>
        <strong className="sg-zap-detail__amount" style={{ color }}>
          {GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]}
        </strong>
        <p className="sg-zap-detail__hero-meta">
          <span>{sourceLabel}</span>
          <span aria-hidden="true">{' - '}</span>
          <time dateTime={new Date(entry.createdAt * 1_000).toISOString()}>
            {formatTimestamp(entry.createdAt, locale)}
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
          <span className="sg-zap-detail__row-label">{t('actedBy')}</span>
          {renderActorButton(entry.fromPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('impacted')}</span>
          {renderActorButton(entry.toPubkey, resolveActorLabel, onOpenIdentity)}
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('type')}</span>
          <span className="sg-zap-detail__row-value">
            {GRAPH_EVENT_KIND_LABELS[entry.kind]}
          </span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('summary')}</span>
          <span className="sg-zap-detail__row-value">{getEventSummary(entry, summaryText)}</span>
        </section>
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('time')}</span>
          <span className="sg-zap-detail__row-value">
            {formatTimestamp(entry.createdAt, locale)}
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
        <section className="sg-zap-detail__row">
          <span className="sg-zap-detail__row-label">{t('event')}</span>
          <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
            {entry.eventId}
          </span>
        </section>
        {entry.refEventId ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">{t('reference')}</span>
            <span className="sg-zap-detail__row-value sg-zap-detail__row-value--mono">
              {encodedRef ?? entry.refEventId}
            </span>
          </section>
        ) : null}
        {inlineText ? (
          <section className="sg-zap-detail__row">
            <span className="sg-zap-detail__row-label">
              {t('textOf', { kind: GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind].toLowerCase() })}
            </span>
            <p className="sg-zap-detail__comment">{inlineText}</p>
          </section>
        ) : null}
      </div>

      <div className="sg-zap-detail__actions">
        <button
          className="sg-btn"
          onClick={onReplay}
          type="button"
        >
          {t('replayActivity')}
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
