'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import type { PanInfo } from 'motion/react'

import { CloseIcon } from '@/features/graph-v2/ui/SigmaIcons'

export type SigmaPanelSnap = 'peek' | 'mid' | 'full'

interface Props {
  eyebrow: string
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  tabs?: ReactNode
  mobileSnap?: SigmaPanelSnap
  mobileSnapResetKey?: string | number
}

const PANEL_DRAG_THRESHOLD_PX = 42
const PANEL_CLOSE_THRESHOLD_PX = 120
const PANEL_MIN_HEIGHT_PX = 180
const PANEL_TOP_CLEARANCE_PX = 100
const PANEL_SNAP_ORDER: readonly SigmaPanelSnap[] = ['peek', 'mid', 'full']

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

const resolveClosestPanelSnap = (height: number, viewportHeight: number): SigmaPanelSnap => {
  let closestSnap: SigmaPanelSnap = 'mid'
  let closestDistance = Number.POSITIVE_INFINITY

  for (const snap of PANEL_SNAP_ORDER) {
    const snapHeight = resolveInitialPanelHeight(snap, viewportHeight)
    const distance = Math.abs(height - snapHeight)
    if (distance < closestDistance) {
      closestSnap = snap
      closestDistance = distance
    }
  }

  return closestSnap
}

const resolveNextPanelSnap = (
  start: { height: number; snap: SigmaPanelSnap },
  deltaY: number,
  viewportHeight: number,
): SigmaPanelSnap => {
  const currentSnap = resolveClosestPanelSnap(start.height, viewportHeight)
  const currentIndex = Math.max(0, PANEL_SNAP_ORDER.indexOf(currentSnap))

  if (deltaY < 0) {
    return PANEL_SNAP_ORDER[Math.min(PANEL_SNAP_ORDER.length - 1, currentIndex + 1)]
  }

  if (deltaY > 0) {
    return PANEL_SNAP_ORDER[Math.max(0, currentIndex - 1)]
  }

  return start.snap
}

export const SigmaSidePanel = memo(function SigmaSidePanel({
  eyebrow,
  title,
  onClose,
  children,
  tabs,
  mobileSnap = 'mid',
  mobileSnapResetKey,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [mobileHeightPx, setMobileHeightPx] = useState<number | null>(null)
  const [isPanelDragging, setIsPanelDragging] = useState(false)
  const dragStartRef = useRef<{
    height: number
    snap: SigmaPanelSnap
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
  }, [mobileSnap, mobileSnapResetKey])

  const markPanelDragHandled = () => {
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 250)
  }

  const resolveBodyScrollTop = (target: EventTarget | null) => {
    const node = target instanceof Node ? target : null
    return node && bodyRef.current?.contains(node)
      ? bodyRef.current.scrollTop
      : null
  }

  const canUsePanelDrag = (
    start: { bodyScrollTop: number | null },
    deltaY: number,
  ) => {
    if (start.bodyScrollTop === null) return true
    if (deltaY === 0) return false
    return start.bodyScrollTop <= 0
  }

  const applyPanelDrag = (start: { height: number }, deltaY: number) => {
    setMobileHeightPx(clampPanelHeight(start.height - deltaY, window.innerHeight))
  }

  const snapPanelAfterDrag = (start: { height: number; snap: SigmaPanelSnap }, deltaY: number) => {
    const nextSnap = resolveNextPanelSnap(start, deltaY, window.innerHeight)
    setMobileHeightPx(resolveInitialPanelHeight(nextSnap, window.innerHeight))
  }

  const shouldClosePanelFromDrag = (start: { height: number }, deltaY: number) => {
    if (deltaY <= PANEL_CLOSE_THRESHOLD_PX) return false
    const proportionalThreshold = start.height * 0.35
    return deltaY >= Math.min(proportionalThreshold, 220)
  }

  const handlePanelPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary) return
    const target = event.target
    const targetElement = target instanceof Element ? target : null
    const startedOnBodyDragHandle = Boolean(
      targetElement?.closest('[data-panel-drag-handle]'),
    )
    const startedInsideScrollableBody =
      target instanceof Node && bodyRef.current?.contains(target)

    if (
      targetElement?.closest('button, a, input, select, textarea, [data-panel-no-drag]')
    ) {
      return
    }

    if (startedInsideScrollableBody && !startedOnBodyDragHandle) {
      dragStartRef.current = null
      return
    }

    const height = mobileHeightPx ?? resolveInitialPanelHeight(mobileSnap, window.innerHeight)
    dragStartRef.current = {
      height,
      snap: resolveClosestPanelSnap(height, window.innerHeight),
      bodyScrollTop: startedOnBodyDragHandle ? null : resolveBodyScrollTop(event.target),
    }
    if (event.pointerType === 'touch') {
      event.preventDefault()
    }
  }

  const handlePanelPan = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const start = dragStartRef.current
    if (!start) return

    const deltaY = info.offset.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return
    if (!canUsePanelDrag(start, deltaY)) return

    setIsPanelDragging(true)
    applyPanelDrag(start, deltaY)
  }

  const handlePanelPanEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const start = dragStartRef.current
    dragStartRef.current = null
    setIsPanelDragging(false)
    if (!start) return

    const deltaY = info.offset.y
    if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return
    if (!canUsePanelDrag(start, deltaY)) return

    if (shouldClosePanelFromDrag(start, deltaY)) {
      markPanelDragHandled()
      onClose()
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
    snapPanelAfterDrag(start, deltaY)
  }

  const panelStyle = mobileHeightPx === null
    ? undefined
    : ({
        '--sg-panel-mobile-height': `${mobileHeightPx}px`,
      } as CSSProperties)

  return (
    <motion.aside
      className="sg-panel"
      data-mobile-dragging={isPanelDragging ? 'true' : undefined}
      data-mobile-snap={mobileSnap}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      onPan={handlePanelPan}
      onPanEnd={handlePanelPanEnd}
      onPointerDown={handlePanelPointerDown}
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
          data-panel-no-drag
          onClick={onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
      {tabs}
      <div className="sg-panel__body" ref={bodyRef}>{children}</div>
    </motion.aside>
  )
})
