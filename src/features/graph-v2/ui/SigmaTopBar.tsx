'use client'

import {
  memo,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import Link from 'next/link'
import AvatarFallback from '@/components/AvatarFallback'
import BrandLogo from '@/components/BrandLogo'
import { isSafeAvatarUrl } from '@/features/graph-runtime/avatar'
import { resolveAvatarFetchUrl } from '@/features/graph-runtime/avatarProxyUrl'
import { CloseIcon, SearchIcon } from '@/features/graph-v2/ui/SigmaIcons'

interface SearchMatch {
  pubkey: string
  label: string
}

interface Props {
  rootDisplayName: string | null
  rootNpub: string | null
  rootPictureUrl: string | null
  onSwitchRoot: () => void
  searchQuery: string
  searchMatches: readonly SearchMatch[]
  searchPlaceholder: string
  searchTotalNodeCount: number
  searchDisabled: boolean
  searchExpanded: boolean
  onSearchChange: (value: string) => void
  onSearchFocus: () => void
  onSearchClear: () => void
  onSearchSelect: (pubkey: string) => void
  onSearchSubmit: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
  brandVersion?: string
}

export const SigmaTopBar = memo(function SigmaTopBar({
  rootDisplayName,
  rootNpub,
  rootPictureUrl,
  onSwitchRoot,
  searchQuery,
  searchMatches,
  searchPlaceholder,
  searchTotalNodeCount,
  searchDisabled,
  searchExpanded,
  onSearchChange,
  onSearchFocus,
  onSearchClear,
  onSearchSelect,
  onSearchSubmit,
  searchInputRef,
  brandVersion = 'v0.3.2',
}: Props) {
  const rootLabel = rootDisplayName ?? 'Identidad raiz'
  const initials =
    rootLabel
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'N'

  const rootPictureSrc =
    rootPictureUrl && isSafeAvatarUrl(rootPictureUrl)
      ? resolveAvatarFetchUrl(rootPictureUrl, undefined, 64)
      : null
  const trimmedSearchQuery = searchQuery.trim()
  const hasSearchQuery = trimmedSearchQuery.length > 0
  const visibleMatches = searchMatches.slice(0, 8)
  const hasMoreMatches = searchMatches.length > visibleMatches.length
  const searchStatus = !trimmedSearchQuery
    ? `Busca entre ${searchTotalNodeCount} nodos visibles.`
    : searchMatches.length === 0
      ? 'Sin coincidencias visibles.'
      : `${searchMatches.length} coincidencia${searchMatches.length === 1 ? '' : 's'} visible${searchMatches.length === 1 ? '' : 's'}.`

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onSearchSubmit()
  }

  return (
    <div className="sg-topbar">
      <div className="sg-top-search-wrap">
        <div
          className={`sg-top-search${searchExpanded ? ' sg-top-search--expanded' : ''}${searchDisabled ? ' sg-top-search--disabled' : ''}`}
        >
          <span className="sg-top-search__icon">
            <SearchIcon />
          </span>
          <input
            aria-controls="sigma-person-search-results"
            aria-label="Buscar persona en el grafo"
            autoComplete="off"
            className="sg-top-search__input"
            disabled={searchDisabled}
            id="sigma-person-search"
            inputMode="search"
            onChange={handleSearchChange}
            onFocus={onSearchFocus}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            ref={searchInputRef}
            spellCheck={false}
            type="search"
            value={searchQuery}
          />
          {hasSearchQuery ? (
            <button
              aria-label="Limpiar busqueda"
              className="sg-top-search__clear"
              onClick={onSearchClear}
              type="button"
            >
              <CloseIcon />
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="sg-top-search__clear sg-top-search__clear--empty"
            />
          )}
          <button
            aria-label={`Cambiar identidad raiz: ${rootLabel}`}
            className="sg-top-search__profile"
            onClick={onSwitchRoot}
            title={`Cambiar identidad raiz: ${rootLabel}`}
            type="button"
          >
            <span className="sg-top-search__avatar">
              {rootPictureSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  decoding="async"
                  height={36}
                  loading="eager"
                  src={rootPictureSrc}
                  width={36}
                />
              ) : (
                <AvatarFallback initials={initials} seed={rootNpub ?? rootLabel} />
              )}
            </span>
          </button>
        </div>

        {searchExpanded ? (
          <div className="sg-top-search-menu" id="sigma-person-search-results">
            <p className="sg-top-search-menu__status">{searchStatus}</p>
            {hasSearchQuery && visibleMatches.length > 0 ? (
              <div className="sg-top-search-menu__results">
                {visibleMatches.map((match) => (
                  <button
                    className="sg-top-search-menu__result"
                    key={match.pubkey}
                    onClick={() => onSearchSelect(match.pubkey)}
                    type="button"
                  >
                    <span className="sg-top-search-menu__result-name">{match.label}</span>
                    <span className="sg-top-search-menu__result-key">
                      {match.pubkey.slice(0, 10)}...
                    </span>
                  </button>
                ))}
                {hasMoreMatches ? (
                  <div className="sg-top-search-menu__more">
                    +{searchMatches.length - visibleMatches.length} mas resaltadas en el grafo
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="sg-top-search-menu__hint">
                Coincide por fragmento, sin importar mayusculas, minusculas o acentos.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="sg-topbar__right">
        <div className="sg-brand">
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <BrandLogo
              className="block"
              imageClassName="h-10 w-auto object-contain"
              priority
              sizes="96px"
            />
          </Link>
          <span style={{ marginLeft: 8, color: 'var(--sg-fg-faint)' }}>
            {brandVersion}
          </span>
        </div>
      </div>
    </div>
  )
})
