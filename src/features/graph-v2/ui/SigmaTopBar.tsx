'use client'

import { memo } from 'react'
import Link from 'next/link'
import AvatarFallback from '@/components/AvatarFallback'
import BrandLogo from '@/components/BrandLogo'

interface Props {
  rootDisplayName: string | null
  rootNpub: string | null
  rootPictureUrl: string | null
  onSwitchRoot: () => void
  brandVersion?: string
}

export const SigmaTopBar = memo(function SigmaTopBar({
  rootDisplayName,
  rootNpub,
  rootPictureUrl,
  onSwitchRoot,
  brandVersion = 'v0.3.2',
}: Props) {
  const initials = rootDisplayName
    ? rootDisplayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || 'N'
    : 'N'

  const npubShort = rootNpub
    ? rootNpub.slice(0, 10) + '…' + rootNpub.slice(-6)
    : null

  return (
    <div className="sg-topbar">
      {rootDisplayName !== null ? (
        <div className="sg-root-chip">
          <div className="sg-root-chip__avatar">
            {rootPictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={rootPictureUrl} />
            ) : (
              <AvatarFallback initials={initials} seed={rootNpub ?? rootDisplayName} />
            )}
          </div>
          <div className="sg-root-chip__meta">
            <span className="sg-root-chip__label">Identidad raíz</span>
            <span className="sg-root-chip__name">{rootDisplayName}</span>
            {npubShort && (
              <span className="sg-root-chip__npub">{npubShort}</span>
            )}
          </div>
          <button
            className="sg-root-chip__switch"
            onClick={onSwitchRoot}
            type="button"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div />
      )}

      <div className="sg-brand">
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <BrandLogo
            className="block"
            imageClassName="h-10 w-auto object-contain"
            priority
          />
        </Link>
        <span style={{ marginLeft: 8, color: 'var(--sg-fg-faint)' }}>
          {brandVersion}
        </span>
      </div>
    </div>
  )
})
