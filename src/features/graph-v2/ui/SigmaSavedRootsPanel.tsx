'use client'
/* eslint-disable @next/next/no-img-element */

import { memo, useState } from 'react'

import AvatarFallback from '@/components/AvatarFallback'
import type { SavedRootEntry } from '@/features/graph-runtime/app/store/types'

interface Props {
  entries: SavedRootEntry[]
  isHydrated: boolean
  onDelete: (entry: SavedRootEntry) => void
  onSelect: (entry: SavedRootEntry) => void
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('es', {
  numeric: 'auto',
})

const getDisplayName = (entry: SavedRootEntry) =>
  entry.profile?.displayName ?? entry.profile?.name ?? 'Identidad sin nombre'

const getInitials = (entry: SavedRootEntry) => {
  const source = getDisplayName(entry)
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('')
  return initials || entry.npub.slice(0, 2).toUpperCase()
}

const shortenNpub = (npub: string) => `${npub.slice(0, 12)}...${npub.slice(-6)}`

const SOURCE_LABELS = {
  npub: 'npub',
  nprofile: 'nprofile',
  hex: 'hex',
  nip05: 'NIP-05',
  session: 'sesion',
  url: 'link',
} as const

const getRootTag = (entry: SavedRootEntry) => {
  return SOURCE_LABELS[entry.source ?? 'npub']
}

const getRootDescription = (entry: SavedRootEntry) => {
  const primaryIdentifier =
    entry.evidence?.nip05 ?? entry.profile?.nip05 ?? shortenNpub(entry.npub)
  const npubLabel = shortenNpub(entry.npub)

  if (primaryIdentifier === npubLabel) {
    return primaryIdentifier
  }

  return [primaryIdentifier, npubLabel].filter(Boolean).join(' · ')
}

const formatSavedRootTime = (timestamp: number) => {
  const elapsedMs = timestamp - Date.now()
  const elapsedMinutes = Math.round(elapsedMs / 60_000)

  if (Math.abs(elapsedMinutes) < 60) {
    return relativeTimeFormatter.format(elapsedMinutes, 'minute')
  }

  const elapsedHours = Math.round(elapsedMs / 3_600_000)
  if (Math.abs(elapsedHours) < 24) {
    return relativeTimeFormatter.format(elapsedHours, 'hour')
  }

  const elapsedDays = Math.round(elapsedMs / 86_400_000)
  if (Math.abs(elapsedDays) < 7) {
    return relativeTimeFormatter.format(elapsedDays, 'day')
  }

  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
  }).format(timestamp)
}

const renderSkeleton = (index: number) => (
  <article
    className="saved-root-card saved-root-card--loading"
    key={`saved-root-skeleton-${index}`}
  >
    <div className="saved-root-card__select saved-root-card__select--loading">
      <div className="saved-root-card__avatar saved-root-card__avatar--fallback lc-skeleton-circle" />
      <div className="saved-root-card__content">
        <span className="saved-root-card__line lc-skeleton" />
        <span className="saved-root-card__line saved-root-card__line--short lc-skeleton" />
      </div>
    </div>
  </article>
)

export const SigmaSavedRootsPanel = memo(function SigmaSavedRootsPanel({
  entries,
  isHydrated,
  onDelete,
  onSelect,
}: Props) {
  const [pendingRemovalPubkey, setPendingRemovalPubkey] = useState<string | null>(null)
  const [failedPictures, setFailedPictures] = useState<Set<string>>(() => new Set())

  if (!isHydrated && entries.length === 0) {
    return (
      <section aria-label="Identidades guardadas" className="saved-roots-panel">
        <div className="saved-roots-grid">
          {Array.from({ length: 3 }, (_, index) => renderSkeleton(index))}
        </div>
      </section>
    )
  }

  if (entries.length === 0) {
    return (
      <section aria-label="Identidades guardadas" className="saved-roots-panel">
        <p className="saved-roots-panel__empty" role="status">
          No hay identidades guardadas todavia.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Identidades guardadas" className="saved-roots-panel">
      <div className="saved-roots-grid">
        {entries.map((entry, index) => {
          const displayName = getDisplayName(entry)
          const description = getRootDescription(entry)
          const picture = entry.profile?.picture ?? null
          const canShowPicture = picture && !failedPictures.has(entry.pubkey)
          const isConfirmingRemoval = pendingRemovalPubkey === entry.pubkey

          return (
            <article className="saved-root-card" key={entry.pubkey}>
              <button
                aria-label={`Abrir ${displayName}`}
                className="saved-root-card__select"
                onClick={() => onSelect(entry)}
                type="button"
              >
                <div className="saved-root-card__avatar">
                  {canShowPicture ? (
                    <img
                      alt={`Avatar de ${displayName}`}
                      decoding="async"
                      fetchPriority={index === 0 ? 'high' : 'auto'}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      onError={() => {
                        setFailedPictures((current) => {
                          const next = new Set(current)
                          next.add(entry.pubkey)
                          return next
                        })
                      }}
                      referrerPolicy="no-referrer"
                      src={picture}
                    />
                  ) : (
                    <AvatarFallback
                      className="saved-root-card__avatar-fallback"
                      initials={getInitials(entry)}
                      seed={entry.pubkey}
                    />
                  )}
                </div>

                <div className="saved-root-card__content">
                  <div className="saved-root-card__title-row">
                    <p className="saved-root-card__name">{displayName}</p>
                    <span className="saved-root-card__stamp">
                      {formatSavedRootTime(entry.lastOpenedAt)}
                    </span>
                    <span className="saved-root-card__tag">
                      {getRootTag(entry)}
                    </span>
                  </div>
                  <p className="saved-root-card__meta">{description}</p>
                </div>
              </button>

              {isConfirmingRemoval ? (
                <div
                  aria-label={`Confirmar borrado de ${displayName}`}
                  className="saved-root-card__confirm"
                  role="group"
                >
                  <button
                    className="saved-root-card__confirm-btn saved-root-card__confirm-btn--danger"
                    onClick={() => {
                      onDelete(entry)
                      setPendingRemovalPubkey(null)
                    }}
                    type="button"
                  >
                    Confirmar
                  </button>
                  <button
                    className="saved-root-card__confirm-btn"
                    onClick={() => setPendingRemovalPubkey(null)}
                    type="button"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  aria-label={`Quitar ${displayName} de las identidades guardadas`}
                  className="saved-root-card__delete"
                  onClick={() => setPendingRemovalPubkey(entry.pubkey)}
                  type="button"
                >
                  Quitar
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
})
