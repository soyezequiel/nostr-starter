import type Sigma from 'sigma'
import type { Coordinates } from 'sigma/types'

import type {
  RenderEdgeAttributes,
  RenderGraphStore,
  RenderNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

type SigmaGraph = ReturnType<RenderGraphStore['getGraph']>

type SigmaRuntimeNodePicker = {
  getNodeAtPosition(position: Coordinates): string | null
}

type EventedTarget = {
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

interface HitCandidate {
  pubkey: string
  x: number
  y: number
  radius: number
  zIndex: number
}

const DEFAULT_CELL_SIZE_PX = 64
const TOUCH_HIT_RADIUS_PX = 24

const toCell = (value: number, cellSize: number) => Math.floor(value / cellSize)

const toCellKey = (x: number, y: number) => `${x}:${y}`

const isFinitePoint = (point: Coordinates) =>
  Number.isFinite(point.x) && Number.isFinite(point.y)

const isTouchPointer = (position: Coordinates) => {
  const original = (position as { original?: unknown }).original
  return (
    typeof original === 'object' &&
    original !== null &&
    ('touches' in original || 'changedTouches' in original)
  )
}

export class SpatialNodeHitTester {
  private readonly cells = new Map<string, HitCandidate[]>()
  private readonly disposeListeners: Array<() => void> = []
  private readonly originalGetNodeAtPosition: SigmaRuntimeNodePicker['getNodeAtPosition']
  private dirty = true

  public constructor(
    private readonly sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>,
    private readonly graph: SigmaGraph,
    private readonly cellSize = DEFAULT_CELL_SIZE_PX,
  ) {
    this.originalGetNodeAtPosition = (sigma as unknown as SigmaRuntimeNodePicker)
      .getNodeAtPosition
      .bind(sigma)
  }

  public install() {
    ;(this.sigma as unknown as SigmaRuntimeNodePicker).getNodeAtPosition = (
      position,
    ) => this.pick(position)

    this.listenToGraphChanges()
    this.listenToCameraChanges()
    this.listenToResizes()

    return this
  }

  public markDirty() {
    this.dirty = true
  }

  public pick(position: Coordinates): string | null {
    if (!isFinitePoint(position)) {
      return null
    }

    if (this.dirty) {
      this.rebuild()
    }

    const candidates =
      this.cells.get(
        toCellKey(
          toCell(position.x, this.cellSize),
          toCell(position.y, this.cellSize),
        ),
      ) ?? []

    let best: HitCandidate | null = null
    let bestDistanceSq = Number.POSITIVE_INFINITY

    for (const candidate of candidates) {
      const dx = position.x - candidate.x
      const dy = position.y - candidate.y
      const distanceSq = dx * dx + dy * dy
      const interactionRadius = isTouchPointer(position)
        ? Math.max(candidate.radius, TOUCH_HIT_RADIUS_PX)
        : candidate.radius
      const radiusSq = interactionRadius * interactionRadius

      if (distanceSq > radiusSq) {
        continue
      }

      const isBetterDistance = distanceSq < bestDistanceSq
      const isBetterZIndex =
        distanceSq === bestDistanceSq &&
        best !== null &&
        candidate.zIndex > best.zIndex

      if (!best || isBetterDistance || isBetterZIndex) {
        best = candidate
        bestDistanceSq = distanceSq
      }
    }

    return best?.pubkey ?? null
  }

  public dispose() {
    ;(this.sigma as unknown as SigmaRuntimeNodePicker).getNodeAtPosition =
      this.originalGetNodeAtPosition

    for (const disposeListener of this.disposeListeners) {
      disposeListener()
    }
    this.disposeListeners.length = 0
    this.cells.clear()
  }

  private rebuild() {
    this.cells.clear()

    this.graph.forEachNode((pubkey, attributes) => {
      const displayData = this.sigma.getNodeDisplayData(pubkey)
      if (!displayData || displayData.hidden) {
        return
      }

      const center = this.sigma.graphToViewport({
        x: attributes.x,
        y: attributes.y,
      })
      const radius = displayData.size

      if (!isFinitePoint(center) || !Number.isFinite(radius) || radius <= 0) {
        return
      }

      this.addCandidate({
        pubkey,
        x: center.x,
        y: center.y,
        radius,
        zIndex: displayData.zIndex,
      })
    })

    this.dirty = false
  }

  private addCandidate(candidate: HitCandidate) {
    const cellRadius = Math.max(candidate.radius, TOUCH_HIT_RADIUS_PX)
    const minCellX = toCell(candidate.x - cellRadius, this.cellSize)
    const maxCellX = toCell(candidate.x + cellRadius, this.cellSize)
    const minCellY = toCell(candidate.y - cellRadius, this.cellSize)
    const maxCellY = toCell(candidate.y + cellRadius, this.cellSize)

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = toCellKey(cellX, cellY)
        const bucket = this.cells.get(key)

        if (bucket) {
          bucket.push(candidate)
        } else {
          this.cells.set(key, [candidate])
        }
      }
    }
  }

  private listenToGraphChanges() {
    const graphEvents = this.graph as unknown as EventedTarget
    const markDirty = () => this.markDirty()
    const eventNames = [
      'nodeAdded',
      'nodeDropped',
      'nodeAttributesUpdated',
      'eachNodeAttributesUpdated',
      'cleared',
    ]

    for (const eventName of eventNames) {
      graphEvents.on(eventName, markDirty)
      this.disposeListeners.push(() => {
        graphEvents.removeListener(eventName, markDirty)
      })
    }
  }

  private listenToCameraChanges() {
    const camera = this.sigma.getCamera() as unknown as EventedTarget
    const markDirty = () => this.markDirty()

    camera.on('updated', markDirty)
    this.disposeListeners.push(() => {
      camera.removeListener('updated', markDirty)
    })
  }

  private listenToResizes() {
    if (typeof window === 'undefined') {
      return
    }

    const markDirty = () => this.markDirty()
    window.addEventListener('resize', markDirty)
    this.disposeListeners.push(() => {
      window.removeEventListener('resize', markDirty)
    })
  }
}

export function installStrictNodeHitTesting(
  sigma: Sigma<RenderNodeAttributes, RenderEdgeAttributes>,
  graph: SigmaGraph,
) {
  return new SpatialNodeHitTester(sigma, graph).install()
}
