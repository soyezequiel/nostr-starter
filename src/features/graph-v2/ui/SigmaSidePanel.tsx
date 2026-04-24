'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode, TouchEvent } from 'react'

import { CloseIcon } from '@/features/graph-v2/ui/SigmaIcons'

export type SigmaPanelSnap = 'peek' | 'mid' | 'full'

interface Props {
  eyebrow: string
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  tabs?: ReactNode
  mobileSnap?: SigmaPanelSnap
}

const PANEL_DRAG_THRESHOLD_PX = 42
const PANEL_CLOSE_THRESHOLD_PX = 120
const PANEL_MIN_HEIGHT_PX = 180
const PANEL_TOP_CLEARANCE_PX = 100

const clampPanelHeight = (height: number, viewportHeight: number) => {
  const maxHeight = Math.max(PANEL_MIN_HEIGHT_PX, viewportHeight - PANEL_TOP_CLEARANCE_PX)
  return Math.min(maxHeight, Math.max(PANEL_MIN_HEIGHT_PX, height))
}

const resolveInitialPanelHeight = (snap: SigmaPanelSnap, viewportHeight: number) => {
  if (snap === 'peek') {
    return clampPanelHeight(Math.min(viewportHeight * 0.32, 260), viewportHeight)
  }

  if (snap === 'full') {
    return clampPanelHeight(viewportHeight - PANEL_TOP_CLEARANCE_PX, viewportHeight)
  }

  return clampPanelHeight(viewportHeight * 0.56, viewportHeight)
}

export const SigmaSidePanel = memo(function SigmaSidePanel({
  eyebrow,
  title,
  onClose,
  children,
  tabs,
  mobileSnap = 'mid',
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [mobileHeightPx, setMobileHeightPx] = useState<number | null>(null)
  const [isPanelDragging, setIsPanelDragging] = useState(false)
  const pointerDragStartRef = useRef<{
    y: number
    pointerId: number
    height: number
    bodyScrollTop: number | null
  } | null>(null)
  const touchDragStartRef = useRef<{
    y: number
    identifier: number
    height: number
    bodyScrollTop: number | null
  } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const syncInitialHeight = () => {
      setMobileHeightPx(resolveInitialPanelHeight(mobileSnap, window.innerHeight))
    }

    syncInitialHeight()
    window.addEventListener('resize', syncInitialHeight)
    return () => window.removeEventListener('resize', syncInitialHeight)
  }, [mobileSnap])

  const markPanelDragHandled = () => {
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 250)
  }

  const canUsePanelDrag = (
    start: {
      bodyScrollTop: number | null
    },
    deltaY: number,
  ) => {
    if (start.bodyScrollTop === null) return true
    if (deltaY > 0) return start.bodyScrollTop <= 0
    if (deltaY < 0) return start.bodyScrollTop <= 0
    return false
  }

  const applyPanelDrag = (start: { height: number }, deltaY: number) => {
    setMobileHeightPx(clampPanelHeight(start.height - deltaY, window.innerHeight))
  }

  const shouldClosePanelFromDrag = (start: { height: number }, deltaY: number) => {
    if (deltaY <= PANEL_CLOSE_THRESHOLD_PX) return false
    const proportionalThreshold = start.height * 0.35
    return deltaY >= Math.min(proportionalThreshold, 220)
  }

  const finishPanelDrag = () => {
    pointerDragStartRef.current = null
    touchDragStartRef.current = null
    setIsPanelDragging(false)
  }

  const resolveBodyScrollTop = (target: EventTarget | null) => {
    const node = target instanceof Node ? target : null
    return node && bodyRef.current?.contains(node)
      ? bodyRef.current.scrollTop
      : null
  }

  const handlePanelPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary) return
    if (event.pointerType === 'touch') return

    pointerDragStartRef.current = {
      y: event.clientY,
      pointerId: event.pointerId,
      height: mobileHeightPx ?? resolveInitialPanelHeight(mobileSnap, window.innerHeight),
      bodyScrollTop: resolveBodyScrollTop(event.target),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePanelPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = pointerDragStartRef.current
    if (!start || start.pointerId !== event.pointerId) return

    const deltaY = event.clientY - start.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return
    if (!canUsePanelDrag(start, deltaY)) return

    event.preventDefault()
    setIsPanelDragging(true)
    applyPanelDrag(start, deltaY)
  }

  const handlePanelPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = pointerDragStartRef.current
    finishPanelDrag()
    if (!start || start.pointerId !== event.pointerId) return

    const deltaY = event.clientY - start.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) {
      return
    }

    if (!canUsePanelDrag(start, deltaY)) {
      return
    }

    if (
      start.bodyScrollTop !== null &&
      bodyRef.current &&
      bodyRef.current.scrollTop !== start.bodyScrollTop
    ) {
      return
    }

    markPanelDragHandled()
    if (shouldClosePanelFromDrag(start, deltaY)) {
      onClose()
      return
    }

    applyPanelDrag(start, deltaY)
  }

  const handlePanelPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (pointerDragStartRef.current?.pointerId === event.pointerId) {
      finishPanelDrag()
    }
  }

  const findTrackedTouch = (
    touches: TouchList,
    identifier: number,
  ) => {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index)
      if (touch?.identifier === identifier) return touch
    }
    return null
  }

  const handlePanelTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) {
      touchDragStartRef.current = null
      return
    }

    const touch = event.touches.item(0)
    if (!touch) return

    touchDragStartRef.current = {
      y: touch.clientY,
      identifier: touch.identifier,
      height: mobileHeightPx ?? resolveInitialPanelHeight(mobileSnap, window.innerHeight),
      bodyScrollTop: resolveBodyScrollTop(event.target),
    }
  }

  const handlePanelTouchMove = (event: TouchEvent<HTMLElement>) => {
    const start = touchDragStartRef.current
    if (!start) return

    const touch = findTrackedTouch(event.touches, start.identifier)
    if (!touch) return

    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return
    if (!canUsePanelDrag(start, deltaY)) return

    event.preventDefault()
    setIsPanelDragging(true)
    applyPanelDrag(start, deltaY)
  }

  const handlePanelTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchDragStartRef.current
    if (!start) return

    const touch = findTrackedTouch(event.changedTouches, start.identifier)
    finishPanelDrag()
    if (!touch) return

    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return
    if (!canUsePanelDrag(start, deltaY)) return

    if (
      start.bodyScrollTop !== null &&
      bodyRef.current &&
      bodyRef.current.scrollTop !== start.bodyScrollTop
    ) {
      return
    }

    markPanelDragHandled()
    if (shouldClosePanelFromDrag(start, deltaY)) {
      onClose()
      return
    }

    applyPanelDrag(start, deltaY)
  }

  const handlePanelTouchCancel = () => {
    finishPanelDrag()
  }

  const panelStyle = mobileHeightPx === null
    ? undefined
    : ({
        '--sg-panel-mobile-height': `${mobileHeightPx}px`,
      } as CSSProperties)

  return (
    <aside
      className="sg-panel"
      data-mobile-dragging={isPanelDragging ? 'true' : undefined}
      data-mobile-snap={mobileSnap}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerCancel={handlePanelPointerCancel}
      onPointerDown={handlePanelPointerDown}
      onPointerMove={handlePanelPointerMove}
      onPointerUp={handlePanelPointerUp}
      onTouchCancel={handlePanelTouchCancel}
      onTouchEnd={handlePanelTouchEnd}
      onTouchMove={handlePanelTouchMove}
      onTouchStart={handlePanelTouchStart}
      style={panelStyle}
    >
      <div
        aria-label="Deslizar panel"
        aria-orientation="horizontal"
        className="sg-panel__grabber"
        role="separator"
      >
        <span />
      </div>
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
      <div className="sg-panel__body" ref={bodyRef}>{children}</div>
    </aside>
  )
})
