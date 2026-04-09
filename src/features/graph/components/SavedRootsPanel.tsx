'use client'

import { useState } from 'react'

import AvatarFallback from '@/components/AvatarFallback'
import SkeletonImage from '@/components/SkeletonImage'
import type { SavedRootEntry } from '@/features/graph/app/store/types'

interface SavedRootsPanelProps {
  entries: SavedRootEntry[]
  isHydrated: boolean
  onDelete: (entry: SavedRootEntry) => void
  onSelect: (entry: SavedRootEntry) => void
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('es', {
  numeric: 'auto',
})

function getDisplayName(entry: SavedRootEntry) {
  return (
    entry.profile?.displayName ??
    entry.profile?.name ??
    'Identidad sin nombre'
  )
}

function getInitials(entry: SavedRootEntry) {
  const source = getDisplayName(entry)
  const segments = source
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    return entry.npub.slice(0, 2).toUpperCase()
  }

  return segments
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join('')
}

function shortenNpub(npub: string) {
  return `${npub.slice(0, 12)}...${npub.slice(-6)}`
}

function formatSavedRootTime(timestamp: number) {
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

function renderSavedRootSkeleton(index: number) {
  return (
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
}

export function SavedRootsPanel({
  entries,
  isHydrated,
  onDelete,
  onSelect,
}: SavedRootsPanelProps) {
  const [pendingRemovalPubkey, setPendingRemovalPubkey] = useState<string | null>(
    null,
  )

  if (!isHydrated && entries.length === 0) {
    return (
      <section className="saved-roots-panel" aria-label="Identidades guardadas">
        <div className="saved-roots-grid">
          {Array.from({ length: 3 }, (_, index) => renderSavedRootSkeleton(index))}
        </div>
      </section>
    )
  }

  if (entries.length === 0) {
    return (
      <section className="saved-roots-panel" aria-label="Identidades guardadas">
        <p className="saved-roots-panel__empty" role="status">
          No hay identidades guardadas todavía.
        </p>
      </section>
    )
  }

  return (
    <section className="saved-roots-panel" aria-label="Identidades guardadas">
      <div className="saved-roots-grid">
        {entries.map((entry) => {
          const displayName = getDisplayName(entry)
          const description = [entry.profile?.nip05, shortenNpub(entry.npub)]
            .filter(Boolean)
            .join(' · ')
          const pictureAlt = `Avatar de ${displayName}`
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
                  {entry.profile?.picture ? (
                    <SkeletonImage
                      alt={pictureAlt}
                      className="object-cover"
                      fallback={
                        <AvatarFallback
                          initials={getInitials(entry)}
                          labelClassName="text-[0.92rem] font-bold"
                        />
                      }
                      sizes="80px"
                      src={entry.profile.picture}
                    />
                  ) : (
                    <AvatarFallback
                      initials={getInitials(entry)}
                      labelClassName="text-[0.92rem] font-bold"
                    />
                  )}
                </div>

                <div className="saved-root-card__content">
                  <div className="saved-root-card__title-row">
                    <p className="saved-root-card__name">{displayName}</p>
                    <span className="saved-root-card__stamp">
                      {formatSavedRootTime(entry.lastOpenedAt)}
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
}
