export interface ActivityOverlayViewportAdapter {
  getViewportPosition: (pubkey: string) => { x: number; y: number } | null
}

export function resolveActivityOverlayCssPosition(
  adapter: ActivityOverlayViewportAdapter | null,
  pubkey: string,
): { x: number; y: number } | null {
  const viewportPosition = adapter?.getViewportPosition(pubkey)
  if (!viewportPosition) {
    return null
  }

  // Sigma's graphToViewport returns viewport coordinates in CSS pixels.
  // The activity overlay canvas already applies its own DPR transform, so
  // scaling these coordinates by canvas.width would drift on dense screens.
  return {
    x: viewportPosition.x,
    y: viewportPosition.y,
  }
}
