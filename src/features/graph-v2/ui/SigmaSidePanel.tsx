'use client'

import { memo } from 'react'
import type { ReactNode } from 'react'

import { CloseIcon } from '@/features/graph-v2/ui/SigmaIcons'

interface Props {
  eyebrow: string
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  tabs?: ReactNode
}

export const SigmaSidePanel = memo(function SigmaSidePanel({
  eyebrow,
  title,
  onClose,
  children,
  tabs,
}: Props) {
  return (
    <aside className="sg-panel">
      <div className="sg-panel__header">
        <div className="sg-panel__eyebrow">
          <span style={{ color: 'var(--sg-fg)' }}>◆</span>
          {eyebrow}
          {title ? <span style={{ color: 'var(--sg-fg)', marginLeft: 6 }}>{title}</span> : null}
        </div>
        <button
          aria-label="Cerrar panel"
          className="sg-panel__close"
          onClick={onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
      {tabs}
      <div className="sg-panel__body">{children}</div>
    </aside>
  )
})
