import { DirectedGraph } from 'graphology'

import type { GraphSceneEdge, GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'

export interface SigmaNodeAttributes {
  x: number
  y: number
  size: number
  color: string
  label: string
  hidden: boolean
  highlighted: boolean
  forceLabel: boolean
  fixed: boolean
  pictureUrl: string | null
  isDimmed: boolean
  isSelected: boolean
  isNeighbor: boolean
  isRoot: boolean
  isPinned: boolean
  zIndex: number
}

export interface SigmaEdgeAttributes {
  size: number
  color: string
  hidden: boolean
  label: string | null
  weight: number
  isDimmed: boolean
  touchesFocus: boolean
  zIndex: number
}

const hasNodeAttributeChanges = (
  current: SigmaNodeAttributes,
  next: SigmaNodeAttributes,
) =>
  current.x !== next.x ||
  current.y !== next.y ||
  current.size !== next.size ||
  current.color !== next.color ||
  current.label !== next.label ||
  current.hidden !== next.hidden ||
  current.highlighted !== next.highlighted ||
  current.forceLabel !== next.forceLabel ||
  current.fixed !== next.fixed ||
  current.pictureUrl !== next.pictureUrl ||
  current.isDimmed !== next.isDimmed ||
  current.isSelected !== next.isSelected ||
  current.isNeighbor !== next.isNeighbor ||
  current.isRoot !== next.isRoot ||
  current.isPinned !== next.isPinned ||
  current.zIndex !== next.zIndex

const hasEdgeAttributeChanges = (
  current: SigmaEdgeAttributes,
  next: SigmaEdgeAttributes,
) =>
  current.size !== next.size ||
  current.color !== next.color ||
  current.hidden !== next.hidden ||
  current.label !== next.label ||
  current.weight !== next.weight ||
  current.isDimmed !== next.isDimmed ||
  current.touchesFocus !== next.touchesFocus ||
  current.zIndex !== next.zIndex

const createSeedPosition = (index: number, total: number) => {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2
  const radius = Math.max(4, Math.sqrt(total) * 2)

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

const mergeEdgeMaps = (scene: GraphSceneSnapshot) => {
  const edges = new Map<string, GraphSceneEdge>()

  for (const edge of scene.forceEdges) {
    edges.set(edge.id, edge)
  }

  for (const edge of scene.visibleEdges) {
    edges.set(edge.id, {
      ...edge,
      hidden: false,
    })
  }

  return edges
}

const createDirectedPairKey = (source: string, target: string) =>
  `${source}->${target}`

export class GraphologyProjectionStore {
  private readonly graph = new DirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>()

  private readonly positionCache = new Map<string, { x: number; y: number }>()

  public getGraph() {
    return this.graph
  }

  public applyScene(scene: GraphSceneSnapshot) {
    const nextNodeIds = new Set(scene.nodes.map((node) => node.pubkey))
    const nextEdges = mergeEdgeMaps(scene)
    const nextEdgeIdsByPair = new Map<string, string>()
    const currentNodeIds = this.graph.nodes()
    const currentEdgeIds = this.graph.edges()

    for (const edge of nextEdges.values()) {
      nextEdgeIdsByPair.set(createDirectedPairKey(edge.source, edge.target), edge.id)
    }

    for (const nodeId of currentNodeIds) {
      if (!nextNodeIds.has(nodeId)) {
        const attrs = this.graph.getNodeAttributes(nodeId)
        this.positionCache.set(nodeId, { x: attrs.x, y: attrs.y })
      }
    }

    for (const edgeId of currentEdgeIds) {
      const source = this.graph.source(edgeId)
      const target = this.graph.target(edgeId)
      const nextEdgeIdForPair = nextEdgeIdsByPair.get(
        createDirectedPairKey(source, target),
      )

      if (!nextEdges.has(edgeId) || nextEdgeIdForPair !== edgeId) {
        this.graph.dropEdge(edgeId)
      }
    }

    for (const nodeId of currentNodeIds) {
      if (!nextNodeIds.has(nodeId)) {
        this.graph.dropNode(nodeId)
      }
    }

    scene.nodes.forEach((node, index) => {
      const existingPosition = this.graph.hasNode(node.pubkey)
        ? this.graph.getNodeAttributes(node.pubkey)
        : this.positionCache.get(node.pubkey)
      const seedPosition =
        existingPosition ?? createSeedPosition(index, scene.nodes.length)
      const zIndex = node.isSelected
        ? 8
        : node.isRoot
          ? 6
          : node.isNeighbor
            ? 5
            : node.isPinned
              ? 4
              : node.isDimmed
                ? -2
                : 0
      const attributes: SigmaNodeAttributes = {
        x: seedPosition.x,
        y: seedPosition.y,
        size: node.size,
        color: node.color,
        label: node.label,
        hidden: false,
        highlighted: node.isSelected || node.isNeighbor,
        forceLabel:
          node.isRoot || node.isSelected || node.isPinned || node.isNeighbor,
        fixed: node.isPinned,
        pictureUrl: node.pictureUrl,
        isDimmed: node.isDimmed,
        isSelected: node.isSelected,
        isNeighbor: node.isNeighbor,
        isRoot: node.isRoot,
        isPinned: node.isPinned,
        zIndex,
      }

      if (this.graph.hasNode(node.pubkey)) {
        const currentAttributes = this.graph.getNodeAttributes(node.pubkey)
        if (hasNodeAttributeChanges(currentAttributes, attributes)) {
          this.graph.replaceNodeAttributes(node.pubkey, attributes)
        }
      } else {
        this.graph.addNode(node.pubkey, attributes)
      }
    })

    for (const edge of nextEdges.values()) {
      const attributes: SigmaEdgeAttributes = {
        size: edge.size,
        color: edge.color,
        hidden: edge.hidden,
        label: null,
        weight: edge.weight,
        isDimmed: edge.isDimmed,
        touchesFocus: edge.touchesFocus,
        zIndex: edge.touchesFocus ? 6 : edge.isDimmed ? -2 : 1,
      }

      if (this.graph.hasEdge(edge.id)) {
        const currentAttributes = this.graph.getEdgeAttributes(edge.id)
        if (hasEdgeAttributeChanges(currentAttributes, attributes)) {
          this.graph.replaceEdgeAttributes(edge.id, attributes)
        }
      } else if (
        this.graph.hasNode(edge.source) &&
        this.graph.hasNode(edge.target)
      ) {
        const existingEdgeId = this.graph.directedEdge(edge.source, edge.target)

        if (existingEdgeId && existingEdgeId !== edge.id) {
          this.graph.dropEdge(existingEdgeId)
        }

        this.graph.addDirectedEdgeWithKey(
          edge.id,
          edge.source,
          edge.target,
          attributes,
        )
      }
    }
  }

  public setNodePosition(pubkey: string, x: number, y: number, fixed = false) {
    if (!this.graph.hasNode(pubkey)) {
      return
    }

    this.graph.mergeNodeAttributes(pubkey, { x, y, fixed })
    this.positionCache.set(pubkey, { x, y })
  }

  public translateNodePosition(pubkey: string, dx: number, dy: number) {
    if (!this.graph.hasNode(pubkey)) {
      return
    }

    const attributes = this.graph.getNodeAttributes(pubkey)
    const nextX = attributes.x + dx
    const nextY = attributes.y + dy

    this.graph.mergeNodeAttributes(pubkey, {
      x: nextX,
      y: nextY,
    })
    this.positionCache.set(pubkey, { x: nextX, y: nextY })
  }

  public setNodeFixed(pubkey: string, fixed: boolean) {
    if (!this.graph.hasNode(pubkey)) {
      return
    }

    this.graph.setNodeAttribute(pubkey, 'fixed', fixed)
  }

  public isNodeFixed(pubkey: string) {
    if (!this.graph.hasNode(pubkey)) {
      return false
    }

    return this.graph.getNodeAttribute(pubkey, 'fixed')
  }

  public getNodePosition(pubkey: string) {
    if (!this.graph.hasNode(pubkey)) {
      return null
    }

    const attrs = this.graph.getNodeAttributes(pubkey)
    return { x: attrs.x, y: attrs.y }
  }
}
