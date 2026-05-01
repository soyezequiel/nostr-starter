// Sprite atlas that pre-renders activity icons to an offscreen canvas once.
// Consumers call drawSprite() which uses drawImage() — a GPU-accelerated path
// that avoids per-frame shadowBlur and repeated path construction.

import type { GraphEventKind } from '@/features/graph-v2/events/types'
import { GRAPH_EVENT_KIND_COLORS } from '@/features/graph-v2/events/types'

// Icon sizes rendered in the atlas (CSS pixels)
const ICON_SIZES = [6, 9, 12] as const
type IconSize = (typeof ICON_SIZES)[number]

// Padding around each sprite to prevent bleeding at draw boundaries
const SPRITE_PAD = 6
// Columns per row in the atlas grid: one column per kind per size
const KINDS: GraphEventKind[] = ['like', 'repost', 'save', 'quote', 'comment']
const SPRITE_CELL = 32 // each cell is 32×32 CSS pixels in the atlas

interface SpriteCell {
  sx: number // source x in atlas
  sy: number // source y
  size: number // cell size in atlas pixels
}

export class SpriteAtlas {
  private readonly atlas: HTMLCanvasElement | OffscreenCanvas
  private readonly cells: Map<string, SpriteCell> = new Map()
  private readonly cellPx: number

  private constructor(atlas: HTMLCanvasElement | OffscreenCanvas, cellPx: number) {
    this.atlas = atlas
    this.cellPx = cellPx
  }

  static create(dpr = 1): SpriteAtlas | null {
    const scaledDpr = Math.min(dpr, 2)
    const cellPx = Math.round(SPRITE_CELL * scaledDpr)
    const cols = KINDS.length
    const rows = ICON_SIZES.length
    const atlasW = cols * cellPx
    const atlasH = rows * cellPx

    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null

    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        canvas = new OffscreenCanvas(atlasW, atlasH)
      } catch {
        // OffscreenCanvas may fail in some environments
      }
    }
    if (!canvas && typeof document !== 'undefined') {
      const el = document.createElement('canvas')
      el.width = atlasW
      el.height = atlasH
      canvas = el
    }
    if (!canvas) return null

    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return null

    ctx.clearRect(0, 0, atlasW, atlasH)

    const atlas = new SpriteAtlas(canvas, cellPx)

    for (let row = 0; row < ICON_SIZES.length; row++) {
      const iconSize = ICON_SIZES[row]!
      for (let col = 0; col < KINDS.length; col++) {
        const kind = KINDS[col]!
        const color = GRAPH_EVENT_KIND_COLORS[kind]
        const sx = col * cellPx
        const sy = row * cellPx
        const cx = sx + cellPx / 2
        const cy = sy + cellPx / 2

        ctx.save()
        ctx.translate(cx, cy)
        const s = scaledDpr
        renderIcon(ctx, kind, iconSize * s, color)
        ctx.restore()

        const key = `${kind}:${iconSize}`
        atlas.cells.set(key, { sx, sy, size: cellPx })
      }
    }

    return atlas
  }

  drawSprite(
    ctx: CanvasRenderingContext2D,
    kind: GraphEventKind,
    x: number,
    y: number,
    iconSize: number,
    alpha: number,
  ): boolean {
    // Pick the atlas size closest to the requested icon size
    const snapped = snapSize(iconSize)
    const key = `${kind}:${snapped}`
    const cell = this.cells.get(key)
    if (!cell) return false

    const half = cell.size / 2
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(
      this.atlas as CanvasImageSource,
      cell.sx,
      cell.sy,
      cell.size,
      cell.size,
      x - half / (this.cellPx / SPRITE_CELL),
      y - half / (this.cellPx / SPRITE_CELL),
      SPRITE_CELL,
      SPRITE_CELL,
    )
    ctx.restore()
    return true
  }
}

function snapSize(size: number): IconSize {
  if (size <= 7.5) return 6
  if (size <= 10.5) return 9
  return 12
}

function renderIcon(
  ctx: CanvasRenderingContext2D,
  kind: GraphEventKind,
  size: number,
  color: string,
): void {
  switch (kind) {
    case 'like':
      renderHeart(ctx, size, color)
      break
    case 'repost':
      renderRepostRing(ctx, size, color)
      break
    case 'save':
      renderBookmark(ctx, size, color)
      break
    case 'quote':
      renderQuoteMark(ctx, size, color)
      break
    case 'comment':
      renderCommentBubble(ctx, size, color)
      break
  }
}

function renderHeart(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const s = size / 16

  // Glow
  ctx.save()
  ctx.scale((size + 5) / 16, (size + 5) / 16)
  ctx.globalAlpha = 0.3
  ctx.fillStyle = color
  heartPath(ctx)
  ctx.fill()
  ctx.restore()

  // Main
  ctx.save()
  ctx.scale(s, s)
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  heartPath(ctx)
  ctx.fill()
  ctx.restore()
}

function heartPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(0, 6)
  ctx.bezierCurveTo(-13, -4, -7, -14, 0, -7)
  ctx.bezierCurveTo(7, -14, 13, -4, 0, 6)
  ctx.closePath()
}

function renderRepostRing(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.8
  ctx.globalAlpha = 1

  // Outer glow ring
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 5.5
  ctx.beginPath()
  ctx.arc(0, 0, size * 0.6, Math.PI * 0.12, Math.PI * 1.42)
  ctx.stroke()

  // Main ring
  ctx.globalAlpha = 1
  ctx.lineWidth = 2.8
  ctx.beginPath()
  ctx.arc(0, 0, size * 0.6, Math.PI * 0.12, Math.PI * 1.42)
  ctx.stroke()

  // Arrow
  const r = size * 0.6
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(r + 1, -1)
  ctx.lineTo(r + 5, -5)
  ctx.lineTo(r + 5, 1)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function renderBookmark(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const s = size / 8
  ctx.save()
  ctx.scale(s, s)

  // Glow
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.globalAlpha = 0.25
  bookmarkPath(ctx, 7)
  ctx.stroke()

  // Fill
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  bookmarkPath(ctx, 7)
  ctx.fill()
  ctx.restore()
}

function bookmarkPath(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath()
  ctx.moveTo(-size * 0.55, -size)
  ctx.lineTo(size * 0.55, -size)
  ctx.lineTo(size * 0.55, size)
  ctx.lineTo(0, size * 0.46)
  ctx.lineTo(-size * 0.55, size)
  ctx.closePath()
}

function renderQuoteMark(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const fontSize = size * 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color

  // Glow via larger text
  ctx.globalAlpha = 0.25
  ctx.font = `700 ${fontSize * 1.3}px Georgia, serif`
  ctx.fillText('"', 0, 1)

  // Main
  ctx.globalAlpha = 1
  ctx.font = `700 ${fontSize}px Georgia, serif`
  ctx.fillText('"', 0, 1)
  ctx.restore()
}

function renderCommentBubble(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const s = size / 8
  const width = 8 * 1.6 * s
  const height = 8 * 1.08 * s
  const radius = 4 * s
  const left = -width / 2
  const top = -height / 2

  ctx.save()

  // Glow stroke
  ctx.strokeStyle = color
  ctx.lineWidth = 5 * s
  ctx.globalAlpha = 0.2
  roundedRectPath(ctx, left, top, width, height, radius)
  ctx.stroke()

  // Main fill
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  roundedRectPath(ctx, left, top, width, height, radius)
  ctx.fill()

  // Tail triangle
  const tailX = 2 * s
  const tailY = height / 2
  ctx.beginPath()
  ctx.moveTo(tailX - 2 * s, tailY - 1 * s)
  ctx.lineTo(tailX + 2 * s, tailY + 4 * s)
  ctx.lineTo(tailX + 3 * s, tailY - 1 * s)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const right = x + width
  const bottom = y + height
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(right - radius, y)
  ctx.quadraticCurveTo(right, y, right, y + radius)
  ctx.lineTo(right, bottom - radius)
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom)
  ctx.lineTo(x + radius, bottom)
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

export const SPRITE_PAD_EXPORT = SPRITE_PAD
