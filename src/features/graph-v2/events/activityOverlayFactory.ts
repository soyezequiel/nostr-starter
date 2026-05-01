// Factory that selects the best activity overlay backend available.
// Order of preference: WebGL2 (GPU) → Canvas2D (CPU fallback).
// The returned object exposes the same public interface either way.

import { GraphEventOverlay } from '@/features/graph-v2/events/graphEventOverlay'
import type { ViewportPositionResolver } from '@/features/graph-v2/events/graphEventOverlay'
import { WebGLEventRenderer } from '@/features/graph-v2/events/webglEventRenderer'
import type { ParsedGraphEvent } from '@/features/graph-v2/events/types'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

export type ActivityOverlayBackend = 'webgl' | 'canvas2d'

export interface ActivityOverlayController {
  play(event: ParsedGraphEvent): boolean
  playZap(zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>): boolean
  playZapArrival(zap: Pick<ParsedZap, 'toPubkey' | 'sats'>): boolean
  setPaused(paused: boolean): void
  redrawPausedFrame(): void
  dispose(): void
  readonly backend: ActivityOverlayBackend
}

class CanvasActivityOverlay implements ActivityOverlayController {
  readonly backend: ActivityOverlayBackend = 'canvas2d'
  constructor(private readonly inner: GraphEventOverlay) {}
  play(e: ParsedGraphEvent) { return this.inner.play(e) }
  playZap(z: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) { return this.inner.playZap(z) }
  playZapArrival(z: Pick<ParsedZap, 'toPubkey' | 'sats'>) { return this.inner.playZapArrival(z) }
  setPaused(p: boolean) { this.inner.setPaused(p) }
  redrawPausedFrame() { this.inner.redrawPausedFrame() }
  dispose() { this.inner.dispose() }
}

class WebGLActivityOverlay implements ActivityOverlayController {
  readonly backend: ActivityOverlayBackend = 'webgl'
  constructor(private readonly inner: WebGLEventRenderer) {}
  play(e: ParsedGraphEvent) { return this.inner.play(e) }
  playZap(z: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) { return this.inner.playZap(z) }
  playZapArrival(z: Pick<ParsedZap, 'toPubkey' | 'sats'>) { return this.inner.playZapArrival(z) }
  setPaused(p: boolean) { this.inner.setPaused(p) }
  redrawPausedFrame() { this.inner.redrawPausedFrame() }
  dispose() { this.inner.dispose() }
}

/**
 * Create the best available activity overlay for the given container.
 * Tries WebGL2 first; falls back to Canvas2D if unavailable or on error.
 */
export function createActivityOverlay(
  container: HTMLElement,
  getCssViewportPosition: ViewportPositionResolver,
  preferredBackend: ActivityOverlayBackend = 'webgl',
): ActivityOverlayController {
  if (preferredBackend === 'webgl') {
    try {
      const webgl = WebGLEventRenderer.tryCreate(container, getCssViewportPosition)
      if (webgl) return new WebGLActivityOverlay(webgl)
    } catch {
      // fall through to canvas2d
    }
  }
  return new CanvasActivityOverlay(
    new GraphEventOverlay(container, getCssViewportPosition),
  )
}
