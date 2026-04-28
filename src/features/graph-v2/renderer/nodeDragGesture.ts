export const SIGMA_NODE_DRAG_THRESHOLD_PX = 4
export const SIGMA_DRAG_CLICK_SUPPRESSION_WINDOW_MS = 200

export interface PointerCoordinates {
  x: number
  y: number
}

export interface PendingNodeDragGesture {
  pubkey: string
  origin: PointerCoordinates
  anchorOffset: { dx: number; dy: number }
  graphBoundsBBox?: {
    x: [number, number]
    y: [number, number]
  } | null
}

export interface SuppressedNodeClick {
  pubkey: string
  expiresAt: number
}

export const createPendingNodeDragGesture = (
  pubkey: string,
  origin: PointerCoordinates,
  anchorOffset: { dx: number; dy: number } = { dx: 0, dy: 0 },
  graphBoundsBBox?: PendingNodeDragGesture['graphBoundsBBox'],
): PendingNodeDragGesture => ({
  pubkey,
  origin,
  anchorOffset,
  graphBoundsBBox,
})

export const shouldStartNodeDrag = (
  gesture: PendingNodeDragGesture,
  pointer: PointerCoordinates,
  thresholdPx = SIGMA_NODE_DRAG_THRESHOLD_PX,
) => {
  const dx = pointer.x - gesture.origin.x
  const dy = pointer.y - gesture.origin.y

  return dx * dx + dy * dy >= thresholdPx * thresholdPx
}

export const createSuppressedNodeClick = (
  pubkey: string,
  now = Date.now(),
  windowMs = SIGMA_DRAG_CLICK_SUPPRESSION_WINDOW_MS,
): SuppressedNodeClick => ({
  pubkey,
  expiresAt: now + windowMs,
})

export const shouldSuppressNodeClick = (
  suppression: SuppressedNodeClick | null,
  pubkey: string,
  now = Date.now(),
) => suppression?.pubkey === pubkey && now <= suppression.expiresAt
