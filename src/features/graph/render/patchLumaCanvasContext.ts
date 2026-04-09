'use client'

import { CanvasContext } from '@luma.gl/core'

type CanvasContextWithDevice = CanvasContext & {
  device?: {
    limits?: {
      maxTextureDimension2D?: number
    }
  }
}

type PatchedCanvasContext = typeof CanvasContext & {
  __nostrGraphPatched?: boolean
}

const patchedCanvasContext = CanvasContext as PatchedCanvasContext

if (!patchedCanvasContext.__nostrGraphPatched) {
  CanvasContext.prototype.getMaxDrawingBufferSize = function () {
    const context = this as CanvasContextWithDevice
    const maxTextureDimension = context.device?.limits?.maxTextureDimension2D

    if (
      typeof maxTextureDimension === 'number' &&
      Number.isFinite(maxTextureDimension) &&
      maxTextureDimension > 0
    ) {
      return [maxTextureDimension, maxTextureDimension]
    }

    const fallbackWidth =
      typeof this.canvas?.width === 'number' && this.canvas.width > 0
        ? this.canvas.width
        : 4096
    const fallbackHeight =
      typeof this.canvas?.height === 'number' && this.canvas.height > 0
        ? this.canvas.height
        : 4096
    const fallbackDimension = Math.max(fallbackWidth, fallbackHeight, 4096)

    return [fallbackDimension, fallbackDimension]
  }

  patchedCanvasContext.__nostrGraphPatched = true
}
