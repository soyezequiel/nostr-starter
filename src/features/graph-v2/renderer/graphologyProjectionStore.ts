import { DirectedGraph } from 'graphology'

import type {
  GraphPhysicsEdge,
  GraphRenderEdge,
  GraphRenderSnapshot,
  GraphSceneFocusState,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'

export interface NodePosition {
  x: number
  y: number
}

export interface PositionedNodeSample {
  pubkey?: string
  size: number
  x: number
  y: number
}

export interface RenderNodeAttributes {
  x: number
  y: number
  size: number
  color: string
  focusState: GraphSceneFocusState
  label: string
  hidden: boolean
  highlighted: boolean
  forceLabel: boolean
  fixed: boolean
  pictureUrl: string | null
  isExpanding: boolean
  expansionProgress: number | null
  isDimmed: boolean
  isSelected: boolean
  isNeighbor: boolean
  isRoot: boolean
  isExpanded?: boolean
  isPinned: boolean
  zIndex: number
}

export interface RenderEdgeAttributes {
  size: number
  color: string
  hidden: boolean
  label: string | null
  weight: number
  opacityScale: number
  isDimmed: boolean
  touchesFocus: boolean
  zIndex: number
}

export interface PhysicsNodeAttributes {
  x: number
  y: number
  size: number
  fixed: boolean
}

export interface PhysicsEdgeAttributes {
  weight: number
}

export interface GraphTopologyApplyResult {
  topologyChanged: boolean
  rebuilt: boolean
  addedNodeCount: number
  droppedNodeCount: number
  addedEdgeCount: number
  droppedEdgeCount: number
}

const hasRenderNodeAttributeChanges = (
  current: RenderNodeAttributes,
  next: RenderNodeAttributes,
) =>
  current.x !== next.x ||
  current.y !== next.y ||
  current.size !== next.size ||
  current.color !== next.color ||
  current.focusState !== next.focusState ||
  current.label !== next.label ||
  current.hidden !== next.hidden ||
  current.highlighted !== next.highlighted ||
  current.forceLabel !== next.forceLabel ||
  current.fixed !== next.fixed ||
  current.pictureUrl !== next.pictureUrl ||
  current.isExpanding !== next.isExpanding ||
  current.expansionProgress !== next.expansionProgress ||
  current.isDimmed !== next.isDimmed ||
  current.isSelected !== next.isSelected ||
  current.isNeighbor !== next.isNeighbor ||
  current.isRoot !== next.isRoot ||
  current.isExpanded !== next.isExpanded ||
  current.isPinned !== next.isPinned ||
  current.zIndex !== next.zIndex

const hasRenderEdgeAttributeChanges = (
  current: RenderEdgeAttributes,
  next: RenderEdgeAttributes,
) =>
  current.size !== next.size ||
  current.color !== next.color ||
  current.hidden !== next.hidden ||
  current.label !== next.label ||
  current.weight !== next.weight ||
  current.opacityScale !== next.opacityScale ||
  current.isDimmed !== next.isDimmed ||
  current.touchesFocus !== next.touchesFocus ||
  current.zIndex !== next.zIndex

const hasPhysicsNodeAttributeChanges = (
  current: PhysicsNodeAttributes,
  next: PhysicsNodeAttributes,
) =>
  current.x !== next.x ||
  current.y !== next.y ||
  current.size !== next.size ||
  current.fixed !== next.fixed

const hasPhysicsEdgeAttributeChanges = (
  current: PhysicsEdgeAttributes,
  next: PhysicsEdgeAttributes,
) => current.weight !== next.weight

export const createSeedPosition = (index: number, total: number) => {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2
  const radius = Math.max(4, Math.sqrt(total) * 2)

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

const DETACHED_NODE_CANDIDATE_COUNT = 24
const DETACHED_NODE_RING_COUNT = 5

const isFinitePosition = (value: number) => Number.isFinite(value)

export const resolveDetachedNodePlacement = ({
  nodes,
  targetPubkey,
  targetSize = 0,
}: {
  nodes: ReadonlyArray<PositionedNodeSample>
  targetPubkey?: string | null
  targetSize?: number
}): NodePosition => {
  const positionedNodes = nodes.filter(
    (node) =>
      node.pubkey !== targetPubkey &&
      isFinitePosition(node.x) &&
      isFinitePosition(node.y),
  )

  if (positionedNodes.length === 0) {
    return { x: 0, y: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxNodeSize = Math.max(targetSize, 0)

  for (const node of positionedNodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
    maxNodeSize = Math.max(maxNodeSize, node.size)
  }

  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const baseMargin = Math.max(8, maxNodeSize * 2.5, Math.min(width, height) * 0.25)
  let bestCandidate: NodePosition = {
    x: maxX + baseMargin,
    y: centerY,
  }
  let bestScore = -Infinity

  for (let ringIndex = 0; ringIndex < DETACHED_NODE_RING_COUNT; ringIndex += 1) {
    const ringOffset = baseMargin + ringIndex * Math.max(baseMargin * 0.6, 6)
    const radiusX = width / 2 + ringOffset
    const radiusY = height / 2 + ringOffset

    for (
      let candidateIndex = 0;
      candidateIndex < DETACHED_NODE_CANDIDATE_COUNT;
      candidateIndex += 1
    ) {
      const angle = (candidateIndex / DETACHED_NODE_CANDIDATE_COUNT) * Math.PI * 2
      const candidate = {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      }
      const score = Math.min(
        ...positionedNodes.map((node) =>
          Math.hypot(candidate.x - node.x, candidate.y - node.y),
        ),
      )

      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidate
      }
    }

    if (bestScore >= baseMargin) {
      return bestCandidate
    }
  }

  return bestCandidate
}

const createDirectedPairKey = (source: string, target: string) =>
  `${source}->${target}`

const FULL_REBUILD_EDGE_DROP_THRESHOLD = 1_500
const FULL_REBUILD_NODE_DROP_THRESHOLD = 700
const FULL_REBUILD_EDGE_DROP_RATIO = 0.35

const shouldRebuildForTopologyChange = ({
  currentEdgeCount,
  droppedEdgeCount,
  droppedNodeCount,
}: {
  currentEdgeCount: number
  droppedEdgeCount: number
  droppedNodeCount: number
}) =>
  droppedEdgeCount >= FULL_REBUILD_EDGE_DROP_THRESHOLD ||
  droppedNodeCount >= FULL_REBUILD_NODE_DROP_THRESHOLD ||
  (currentEdgeCount >= FULL_REBUILD_EDGE_DROP_THRESHOLD &&
    droppedEdgeCount / Math.max(currentEdgeCount, 1) >=
      FULL_REBUILD_EDGE_DROP_RATIO)

const resolveRenderNodeZIndex = (
  focusState: GraphSceneFocusState,
  isRoot: boolean,
  isPinned: boolean,
) =>
  isRoot
    ? 6
    : isPinned || focusState === 'pinned'
      ? 4
      : 0

export class NodePositionLedger {
  private readonly positions = new Map<string, NodePosition>()

  public get(pubkey: string) {
    return this.positions.get(pubkey) ?? null
  }

  public set(pubkey: string, x: number, y: number) {
    const current = this.positions.get(pubkey)
    if (current && current.x === x && current.y === y) {
      return false
    }

    this.positions.set(pubkey, { x, y })
    return true
  }

  public setPosition(pubkey: string, position: NodePosition) {
    return this.set(pubkey, position.x, position.y)
  }
}

export class RenderGraphStore {
  private readonly graph = new DirectedGraph<
    RenderNodeAttributes,
    RenderEdgeAttributes
  >()

  public constructor(private readonly ledger: NodePositionLedger) {}

  public getGraph() {
    return this.graph
  }

  public getNodePosition(pubkey: string) {
    if (!this.graph.hasNode(pubkey)) {
      return null
    }

    const attrs = this.graph.getNodeAttributes(pubkey)
    return { x: attrs.x, y: attrs.y }
  }

  public hasNode(pubkey: string) {
    return this.graph.hasNode(pubkey)
  }

  public applyScene(scene: GraphRenderSnapshot) {
    const nextNodeIds = new Set(scene.nodes.map((node) => node.pubkey))
    const nextEdges = new Map(scene.visibleEdges.map((edge) => [edge.id, edge]))
    const nextEdgeIdsByPair = new Map<string, string>()
    const currentNodeIds = this.graph.nodes()
    const currentEdgeIds = this.graph.edges()
    const droppedNodeIds: string[] = []
    const droppedEdgeIds: string[] = []

    for (const edge of nextEdges.values()) {
      nextEdgeIdsByPair.set(
        createDirectedPairKey(edge.source, edge.target),
        edge.id,
      )
    }

    for (const nodeId of currentNodeIds) {
      if (!nextNodeIds.has(nodeId)) {
        const attrs = this.graph.getNodeAttributes(nodeId)
        this.ledger.set(nodeId, attrs.x, attrs.y)
        droppedNodeIds.push(nodeId)
      }
    }

    for (const edgeId of currentEdgeIds) {
      const source = this.graph.source(edgeId)
      const target = this.graph.target(edgeId)
      const nextEdgeIdForPair = nextEdgeIdsByPair.get(
        createDirectedPairKey(source, target),
      )

      if (!nextEdges.has(edgeId) || nextEdgeIdForPair !== edgeId) {
        droppedEdgeIds.push(edgeId)
      }
    }

    if (
      shouldRebuildForTopologyChange({
        currentEdgeCount: currentEdgeIds.length,
        droppedEdgeCount: droppedEdgeIds.length,
        droppedNodeCount: droppedNodeIds.length,
      })
    ) {
      for (const nodeId of currentNodeIds) {
        const attrs = this.graph.getNodeAttributes(nodeId)
        this.ledger.set(nodeId, attrs.x, attrs.y)
      }
      this.graph.clear()
      this.applySceneNodes(scene)
      this.applySceneEdges(nextEdges)
      return
    }

    for (const edgeId of droppedEdgeIds) {
      this.graph.dropEdge(edgeId)
    }

    for (const nodeId of droppedNodeIds) {
      this.graph.dropNode(nodeId)
    }

    this.applySceneNodes(scene)
    this.applySceneEdges(nextEdges)
  }

  public setNodePosition(pubkey: string, x: number, y: number) {
    if (!this.graph.hasNode(pubkey)) {
      return false
    }

    const current = this.graph.getNodeAttributes(pubkey)
    if (current.x === x && current.y === y) {
      this.ledger.set(pubkey, x, y)
      return false
    }

    this.graph.mergeNodeAttributes(pubkey, { x, y })
    this.ledger.set(pubkey, x, y)
    return true
  }

  private applySceneNodes(scene: GraphRenderSnapshot) {
    scene.nodes.forEach((node, index) => {
      const existingPosition = this.graph.hasNode(node.pubkey)
        ? this.graph.getNodeAttributes(node.pubkey)
        : this.ledger.get(node.pubkey)
      const seedPosition =
        existingPosition ?? createSeedPosition(index, scene.nodes.length)
      const attributes: RenderNodeAttributes = {
        x: seedPosition.x,
        y: seedPosition.y,
        size: node.size,
        color: node.color,
        focusState: node.focusState,
        label: node.label,
        hidden: false,
        highlighted: false,
        forceLabel: node.forceLabel === true,
        fixed: node.isPinned,
        pictureUrl: node.pictureUrl,
        isExpanding: node.isExpanding,
        expansionProgress: node.expansionProgress,
        isDimmed: node.isDimmed,
        isSelected: node.isSelected,
        isNeighbor: node.isNeighbor,
        isRoot: node.isRoot,
        isExpanded: node.isExpanded,
        isPinned: node.isPinned,
        zIndex: resolveRenderNodeZIndex(
          node.focusState,
          node.isRoot,
          node.isPinned,
        ),
      }

      if (this.graph.hasNode(node.pubkey)) {
        const currentAttributes = this.graph.getNodeAttributes(node.pubkey)
        if (hasRenderNodeAttributeChanges(currentAttributes, attributes)) {
          this.graph.replaceNodeAttributes(node.pubkey, attributes)
        }
      } else {
        this.graph.addNode(node.pubkey, attributes)
      }

      this.ledger.set(node.pubkey, seedPosition.x, seedPosition.y)
    })
  }

  private applySceneEdges(nextEdges: Map<string, GraphRenderEdge>) {
    for (const edge of nextEdges.values()) {
      const attributes: RenderEdgeAttributes = {
        size: edge.size,
        color: edge.color,
        hidden: edge.hidden,
        label: null,
        weight: edge.weight,
        opacityScale: edge.opacityScale,
        isDimmed: edge.isDimmed,
        touchesFocus: edge.touchesFocus,
        zIndex: edge.isDimmed ? -2 : 1,
      }

      if (this.graph.hasEdge(edge.id)) {
        const currentAttributes = this.graph.getEdgeAttributes(edge.id)
        if (hasRenderEdgeAttributeChanges(currentAttributes, attributes)) {
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
}

export class PhysicsGraphStore {
  private readonly graph = new DirectedGraph<
    PhysicsNodeAttributes,
    PhysicsEdgeAttributes
  >()

  public constructor(private readonly ledger: NodePositionLedger) {}

  public getGraph() {
    return this.graph
  }

  public hasNode(pubkey: string) {
    return this.graph.hasNode(pubkey)
  }

  public applyScene(scene: GraphSceneSnapshot['physics']): GraphTopologyApplyResult {
    const nextNodeIds = new Set(scene.nodes.map((node) => node.pubkey))
    const nextEdges = new Map(scene.edges.map((edge) => [edge.id, edge]))
    const nextEdgeIdsByPair = new Map<string, string>()
    const currentNodeIdSet = new Set(this.graph.nodes())
    const currentEdgeIdsByPair = new Map<string, string>()
    const currentNodeIds = this.graph.nodes()
    const currentEdgeIds = this.graph.edges()
    const droppedNodeIds: string[] = []
    const droppedEdgeIds: string[] = []

    for (const edgeId of currentEdgeIds) {
      currentEdgeIdsByPair.set(
        createDirectedPairKey(
          this.graph.source(edgeId),
          this.graph.target(edgeId),
        ),
        edgeId,
      )
    }

    for (const edge of nextEdges.values()) {
      nextEdgeIdsByPair.set(
        createDirectedPairKey(edge.source, edge.target),
        edge.id,
      )
    }

    for (const nodeId of currentNodeIds) {
      if (!nextNodeIds.has(nodeId)) {
        const attrs = this.graph.getNodeAttributes(nodeId)
        this.ledger.set(nodeId, attrs.x, attrs.y)
        droppedNodeIds.push(nodeId)
      }
    }

    for (const edgeId of currentEdgeIds) {
      const source = this.graph.source(edgeId)
      const target = this.graph.target(edgeId)
      const nextEdgeIdForPair = nextEdgeIdsByPair.get(
        createDirectedPairKey(source, target),
      )

      if (!nextEdges.has(edgeId) || nextEdgeIdForPair !== edgeId) {
        droppedEdgeIds.push(edgeId)
      }
    }

    let addedNodeCount = 0
    for (const node of scene.nodes) {
      if (!currentNodeIdSet.has(node.pubkey)) {
        addedNodeCount += 1
      }
    }

    let addedEdgeCount = 0
    for (const edge of nextEdges.values()) {
      if (!nextNodeIds.has(edge.source) || !nextNodeIds.has(edge.target)) {
        continue
      }

      const pairKey = createDirectedPairKey(edge.source, edge.target)
      if (currentEdgeIdsByPair.get(pairKey) !== edge.id) {
        addedEdgeCount += 1
      }
    }

    if (
      shouldRebuildForTopologyChange({
        currentEdgeCount: currentEdgeIds.length,
        droppedEdgeCount: droppedEdgeIds.length,
        droppedNodeCount: droppedNodeIds.length,
      })
    ) {
      for (const nodeId of currentNodeIds) {
        const attrs = this.graph.getNodeAttributes(nodeId)
        this.ledger.set(nodeId, attrs.x, attrs.y)
      }
      this.graph.clear()
      this.applySceneNodes(scene)
      this.applySceneEdges(nextEdges)
      return {
        topologyChanged:
          addedNodeCount > 0 ||
          droppedNodeIds.length > 0 ||
          addedEdgeCount > 0 ||
          droppedEdgeIds.length > 0,
        rebuilt: true,
        addedNodeCount,
        droppedNodeCount: droppedNodeIds.length,
        addedEdgeCount,
        droppedEdgeCount: droppedEdgeIds.length,
      }
    }

    for (const edgeId of droppedEdgeIds) {
      this.graph.dropEdge(edgeId)
    }

    for (const nodeId of droppedNodeIds) {
      this.graph.dropNode(nodeId)
    }

    this.applySceneNodes(scene)
    this.applySceneEdges(nextEdges)

    return {
      topologyChanged:
        addedNodeCount > 0 ||
        droppedNodeIds.length > 0 ||
        addedEdgeCount > 0 ||
        droppedEdgeIds.length > 0,
      rebuilt: false,
      addedNodeCount,
      droppedNodeCount: droppedNodeIds.length,
      addedEdgeCount,
      droppedEdgeCount: droppedEdgeIds.length,
    }
  }

  public setNodePosition(pubkey: string, x: number, y: number, fixed?: boolean) {
    if (!this.graph.hasNode(pubkey)) {
      return false
    }

    const current = this.graph.getNodeAttributes(pubkey)
    const nextFixed = fixed ?? current.fixed
    if (current.x === x && current.y === y && current.fixed === nextFixed) {
      this.ledger.set(pubkey, x, y)
      return false
    }

    this.graph.mergeNodeAttributes(pubkey, { x, y, fixed: nextFixed })
    this.ledger.set(pubkey, x, y)
    return true
  }

  public translateNodePosition(pubkey: string, dx: number, dy: number) {
    if (!this.graph.hasNode(pubkey)) {
      return false
    }

    const attributes = this.graph.getNodeAttributes(pubkey)
    const nextX = attributes.x + dx
    const nextY = attributes.y + dy

    this.graph.mergeNodeAttributes(pubkey, {
      x: nextX,
      y: nextY,
    })
    this.ledger.set(pubkey, nextX, nextY)
    return true
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

  private applySceneNodes(scene: GraphSceneSnapshot['physics']) {
    scene.nodes.forEach((node, index) => {
      const existingPosition = this.graph.hasNode(node.pubkey)
        ? this.graph.getNodeAttributes(node.pubkey)
        : this.ledger.get(node.pubkey)
      const seedPosition =
        existingPosition ?? createSeedPosition(index, scene.nodes.length)
      const attributes: PhysicsNodeAttributes = {
        x: seedPosition.x,
        y: seedPosition.y,
        size: node.size,
        fixed: node.fixed,
      }

      if (this.graph.hasNode(node.pubkey)) {
        const currentAttributes = this.graph.getNodeAttributes(node.pubkey)
        if (hasPhysicsNodeAttributeChanges(currentAttributes, attributes)) {
          this.graph.replaceNodeAttributes(node.pubkey, attributes)
        }
      } else {
        this.graph.addNode(node.pubkey, attributes)
      }

      this.ledger.set(node.pubkey, seedPosition.x, seedPosition.y)
    })
  }

  private applySceneEdges(nextEdges: Map<string, GraphPhysicsEdge>) {
    for (const edge of nextEdges.values()) {
      const attributes: PhysicsEdgeAttributes = {
        weight: edge.weight,
      }

      if (this.graph.hasEdge(edge.id)) {
        const currentAttributes = this.graph.getEdgeAttributes(edge.id)
        if (hasPhysicsEdgeAttributeChanges(currentAttributes, attributes)) {
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
}
