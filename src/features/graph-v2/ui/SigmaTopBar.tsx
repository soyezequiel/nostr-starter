'use client'

interface Props {
  rootDisplayName: string | null
  rootNpub: string | null
  rootPictureUrl: string | null
  onSwitchRoot: () => void
  brandVersion?: string
}

export function SigmaTopBar({
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
              initials
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
        <div className="sg-brand__dot" />
        <span className="sg-brand__path">/labs/</span>
        <span className="sg-brand__active">sigma</span>
        <span style={{ marginLeft: 8, color: 'var(--sg-fg-faint)' }}>
          {brandVersion}
        </span>
      </div>
    </div>
  )
}
