'use client'

import { memo, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { CloseIcon } from '@/features/graph-v2/ui/SigmaIcons'

interface Props {
  eyebrow: string
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  tabs?: ReactNode
  closeOnOutsidePointerDown?: boolean
}

export const SigmaSidePanel = memo(function SigmaSidePanel({
  eyebrow,
  title,
  onClose,
  children,
  tabs,
  closeOnOutsidePointerDown = false,
}: Props) {
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!closeOnOutsidePointerDown) return

    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (event.composedPath().includes(panel)) return
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [closeOnOutsidePointerDown, onClose])

  return (
    <aside className="sg-panel" ref={panelRef}>
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
