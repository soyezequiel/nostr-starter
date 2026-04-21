import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { ForceAtlas2Settings } from 'graphology-layout-forceatlas2'
// These subpaths ship as plain CommonJS without typings; we narrow to the
// pieces we use through local interfaces.
// @ts-expect-error - untyped CJS subpath module
import * as fa2HelpersRaw from 'graphology-layout-forceatlas2/helpers'
// @ts-expect-error - untyped CJS subpath module
import fa2WebWorkerRaw from 'graphology-layout-forceatlas2/webworker'
import { createEdgeWeightGetter as createEdgeWeightGetterRaw } from 'graphology-utils/getters'
import type Graph from 'graphology-types'

const fa2Helpers = fa2HelpersRaw as {
  graphToByteArrays: (
    graph: unknown,
    getEdgeWeight: unknown,
  ) => { nodes: Float32Array; edges: Float32Array }
  assignLayoutChanges: (graph: unknown, matrix: Float32Array) => void
  createWorker: (fn: () => void) => Worker
}
const fa2WebWorker = fa2WebWorkerRaw as () => void
const createEdgeWeightGetter = createEdgeWeightGetterRaw as (
  key: string,
) => { fromEntry: unknown }

import type { GraphPhysicsSnapshot } from '@/features/graph-v2/renderer/contracts'
import type {
  PhysicsEdgeAttributes,
  PhysicsNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const MINIMUM_RUNNING_NODES = 2
const DENSE_GRAPH_START_NODE_COUNT = 160
const DENSE_GRAPH_FULL_NODE_COUNT = 2200
const BARNES_HUT_START_NODE_COUNT = 2000
const BARNES_HUT_MAX_HUB_RATIO = 0.2
const OBSIDIAN_PHYSICS_PRESET_VERSION = 'obsidian-v2'
const BASE_SCALING_RATIO = 4.5
const DENSE_SCALING_RATIO = 9
const BASE_GRAVITY = 0.2
const DENSE_GRAVITY = 0.32
const BASE_SLOW_DOWN = 14
const DENSE_SLOW_DOWN = 22
const BASE_EDGE_WEIGHT_INFLUENCE = 1.25
const DENSE_EDGE_WEIGHT_INFLUENCE = 0.65
const BASE_BARNES_HUT_THETA = 0.55
const DENSE_BARNES_HUT_THETA = 0.82
const OVERLAP_SAMPLE_LIMIT = 600
const MIN_SCALING_RATIO = 0.5
const MAX_SCALING_RATIO = 72
const MIN_GRAVITY = 0.01
const MAX_GRAVITY = 1
const MIN_CENTRIPETAL_FORCE = 0
const MAX_CENTRIPETAL_FORCE = 0.5
const MIN_SLOW_DOWN = 1
const MAX_SLOW_DOWN = 60
const MIN_EDGE_WEIGHT_INFLUENCE = 0.05
const MAX_EDGE_WEIGHT_INFLUENCE = 3

export interface ForceAtlasPhysicsTuning {
  centripetalForce: number
  repulsionForce: number
  linkForce: number
  linkDistance: number
  damping: number
}

export const DEFAULT_FORCE_ATLAS_PHYSICS_TUNING: ForceAtlasPhysicsTuning = {
  centripetalForce: 0,
  repulsionForce: 5,
  linkForce: 1,
  linkDistance: 0.5,
  damping: 2,
}

export interface ForceAtlasPhysicsDiagnostics {
  presetVersion: string
  graphOrder: number
  graphSize: number
  maxDegree: number
  hubRatio: number
  settingsKey: string | null
  layoutEligible: boolean
  running: boolean
  suspended: boolean
  autoFreezeEnabled: boolean
  denseFactor: number
  tuning: ForceAtlasPhysicsTuning
  settings: ForceAtlas2Settings
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    width: number
    height: number
  } | null
  averageEdgeLength: number | null
  sampledNodeCount: number
  approximateOverlapCount: number
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const interpolateNumber = (start: number, end: number, factor: number) =>
  start + (end - start) * factor

export const createForceAtlasPhysicsTuning = (
  tuning: Partial<ForceAtlasPhysicsTuning> = {},
): ForceAtlasPhysicsTuning => ({
  centripetalForce: clampNumber(
    tuning.centripetalForce ??
      DEFAULT_FORCE_ATLAS_PHYSICS_TUNING.centripetalForce,
    MIN_CENTRIPETAL_FORCE,
    MAX_CENTRIPETAL_FORCE,
  ),
  repulsionForce: clampNumber(
    tuning.repulsionForce ?? DEFAULT_FORCE_ATLAS_PHYSICS_TUNING.repulsionForce,
    0.25,
    5,
  ),
  linkForce: clampNumber(
    tuning.linkForce ?? DEFAULT_FORCE_ATLAS_PHYSICS_TUNING.linkForce,
    0.25,
    2.5,
  ),
  linkDistance: clampNumber(
    tuning.linkDistance ?? DEFAULT_FORCE_ATLAS_PHYSICS_TUNING.linkDistance,
    0.5,
    2,
  ),
  damping: clampNumber(
    tuning.damping ?? DEFAULT_FORCE_ATLAS_PHYSICS_TUNING.damping,
    0.1,
    2.5,
  ),
})

export const resolveForceAtlasDenseFactor = (graphOrder: number) =>
  clampNumber(
    (Math.sqrt(Math.max(0, graphOrder)) -
      Math.sqrt(DENSE_GRAPH_START_NODE_COUNT)) /
      (Math.sqrt(DENSE_GRAPH_FULL_NODE_COUNT) -
        Math.sqrt(DENSE_GRAPH_START_NODE_COUNT)),
    0,
    1,
  )

const resolveHubRatio = (graphOrder: number, maxDegree = 0) =>
  graphOrder <= 1 ? 0 : maxDegree / (graphOrder - 1)

export const shouldUseBarnesHutOptimization = (
  graphOrder: number,
  maxDegree = 0,
) =>
  graphOrder > BARNES_HUT_START_NODE_COUNT &&
  resolveHubRatio(graphOrder, maxDegree) <= BARNES_HUT_MAX_HUB_RATIO

export const resolveForceAtlasSettings = (
  graphOrder: number,
  tuning: Partial<ForceAtlasPhysicsTuning> = DEFAULT_FORCE_ATLAS_PHYSICS_TUNING,
  topology: { maxDegree?: number } = {},
): ForceAtlas2Settings => {
  const denseFactor = resolveForceAtlasDenseFactor(graphOrder)
  const inferredSettings = forceAtlas2.inferSettings(graphOrder)
  const resolvedTuning = createForceAtlasPhysicsTuning(tuning)
  const distanceScale = Math.sqrt(resolvedTuning.linkDistance)

  return {
    ...inferredSettings,
    adjustSizes: false,
    edgeWeightInfluence: clampNumber(
      (interpolateNumber(
        BASE_EDGE_WEIGHT_INFLUENCE,
        DENSE_EDGE_WEIGHT_INFLUENCE,
        denseFactor,
      ) *
        resolvedTuning.linkForce) /
        distanceScale,
      MIN_EDGE_WEIGHT_INFLUENCE,
      MAX_EDGE_WEIGHT_INFLUENCE,
    ),
    // Obsidian's graph feel is link-dominated: repulsion should separate
    // nodes, not explode clusters. Dense graphs get only a smooth lift.
    scalingRatio: clampNumber(
      interpolateNumber(
        BASE_SCALING_RATIO,
        DENSE_SCALING_RATIO,
        denseFactor,
      ) *
        resolvedTuning.repulsionForce *
        distanceScale,
      MIN_SCALING_RATIO,
      MAX_SCALING_RATIO,
    ),
    // Strong gravity scales the pull with distance. Without it, disconnected
    // components and peripheral clusters drift outward for many seconds and
    // keep the render bridge alive as visible residual motion.
    gravity:
      resolvedTuning.centripetalForce === 0
        ? 0
        : clampNumber(
            interpolateNumber(BASE_GRAVITY, DENSE_GRAVITY, denseFactor) *
              resolvedTuning.centripetalForce,
            MIN_GRAVITY,
            MAX_GRAVITY,
          ),
    // SlowDown is the damping knob. Higher dense values preserve controlled
    // inertia without letting hub clusters slingshot after release.
    slowDown: clampNumber(
      interpolateNumber(BASE_SLOW_DOWN, DENSE_SLOW_DOWN, denseFactor) *
        resolvedTuning.damping,
      MIN_SLOW_DOWN,
      MAX_SLOW_DOWN,
    ),
    // Barnes-Hut is an approximation. Activating it too early, or on
    // hub-dominated identity graphs, makes the approximate repulsion field
    // jitter around the central mass instead of converging cleanly.
    barnesHutOptimize: shouldUseBarnesHutOptimization(
      graphOrder,
      topology.maxDegree,
    ),
    barnesHutTheta: interpolateNumber(
      BASE_BARNES_HUT_THETA,
      DENSE_BARNES_HUT_THETA,
      denseFactor,
    ),
    strongGravityMode: true,
  }
}

export interface ForceAtlasLayoutController {
  isRunning(): boolean
  start(): void
  stop(): void
  kill(): void
  setAutoFreezeEnabled?: (enabled: boolean) => void
}

export interface ConvergingLayoutOptions {
  onSettled?: () => void
  autoFreezeEnabled?: boolean
  createWorker?: () => Worker
}

export interface ForceAtlasSyncOptions {
  topologyChanged?: boolean
}

// Convergence threshold expressed as a fraction of the current graph diameter.
// 1e-4 means "a node moved less than 0.01% of the layout extent this frame" —
// below that the camera-normalized view is effectively static. Using a ratio
// (vs. an absolute value in layout units) matters because FA2 expands the
// graph well past the seed radius, so an absolute epsilon that worked at
// start becomes meaninglessly loose (or tight) once the graph is laid out.
const CONVERGENCE_EPSILON_RATIO = 1e-4
// Number of consecutive RAF iterations whose max displacement must stay below
// the ratio threshold before we declare the layout stable and stop.
const CONVERGENCE_STABLE_FRAMES = 30
// Hard cap so a pathological graph (e.g. disconnected components with strong
// gravity) still terminates in a few seconds instead of running forever.
const MAX_ITERATIONS = 900

/**
 * RAF-throttled FA2 supervisor that applies the ForceAtlas2 stopping criterion
 * (max displacement below epsilon for N consecutive iterations). Replaces
 * graphology's built-in FA2LayoutSupervisor, which ping-pongs the worker at
 * max postMessage throughput and has no stop condition — causing the visible
 * "vibration" once the layout relaxes but keeps receiving residual updates.
 */
export class ConvergingFA2Supervisor implements ForceAtlasLayoutController {
  private worker: Worker | null = null
  private matrices: { nodes: Float32Array; edges: Float32Array } | null = null
  private previousPositions: Float32Array | null = null
  private running = false
  private killed = false
  private iterationsRequested = false
  private pendingFrame: number | null = null
  private stableFrames = 0
  private iterationCount = 0
  private autoFreezeEnabled = true
  private runToken = 0
  private hasStartedOnce = false
  private readonly getEdgeWeight: unknown
  private readonly onSettled: (() => void) | undefined
  private readonly createWorker: () => Worker

  public constructor(
    private readonly graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
    private readonly settings: ForceAtlas2Settings,
    options: ConvergingLayoutOptions = {},
  ) {
    this.onSettled = options.onSettled
    this.autoFreezeEnabled = options.autoFreezeEnabled ?? true
    this.getEdgeWeight = createEdgeWeightGetter('weight').fromEntry
    this.createWorker =
      options.createWorker ?? (() => fa2Helpers.createWorker(fa2WebWorker))

    this.spawnWorker()
  }

  public isRunning(): boolean {
    return this.running
  }

  public start(): void {
    if (this.killed) {
      throw new Error('ConvergingFA2Supervisor: layout was killed.')
    }
    if (this.running) return
    this.runToken += 1
    if (this.hasStartedOnce) {
      this.spawnWorker()
    }
    this.hasStartedOnce = true

    this.matrices = fa2Helpers.graphToByteArrays(
      this.graph,
      this.getEdgeWeight,
    )
    this.previousPositions = this.snapshotPositions(this.matrices.nodes)
    this.stableFrames = 0
    this.iterationCount = 0
    this.running = true
    this.iterationsRequested = true
    this.askForIterations(true)
  }

  public stop(): void {
    this.running = false
    this.iterationsRequested = false
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame)
      this.pendingFrame = null
    }
  }

  public setAutoFreezeEnabled(enabled: boolean): void {
    this.autoFreezeEnabled = enabled
  }

  public kill(): void {
    if (this.killed) return
    this.killed = true
    this.stop()
    this.matrices = null
    this.previousPositions = null
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  private spawnWorker() {
    if (this.worker) this.worker.terminate()
    this.worker = this.createWorker()
    this.worker.addEventListener('message', this.handleMessage)
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (!this.running || !this.worker || !this.matrices) return
    if (event.currentTarget !== this.worker) return

    const matrix = new Float32Array(
      (event.data as { nodes: ArrayBuffer }).nodes,
    )
    fa2Helpers.assignLayoutChanges(this.graph, matrix)
    this.matrices.nodes = matrix

    const maxDisplacement = this.measureMaxDisplacement(matrix)
    const diameter = this.measureGraphDiameter(matrix)
    this.previousPositions = this.snapshotPositions(matrix)
    this.iterationCount += 1

    // Relative threshold: stop when the largest single-frame move is <0.01%
    // of the current graph diameter. Guard against zero diameter (single
    // node / degenerate layout) by requiring a minimum absolute displacement.
    const threshold = Math.max(diameter * CONVERGENCE_EPSILON_RATIO, 1e-4)
    if (maxDisplacement < threshold) {
      this.stableFrames += 1
    } else {
      this.stableFrames = 0
    }

    if (
      this.autoFreezeEnabled &&
      (this.stableFrames >= CONVERGENCE_STABLE_FRAMES ||
        this.iterationCount >= MAX_ITERATIONS)
    ) {
      this.stop()
      this.onSettled?.()
      return
    }

    // RAF throttle: one iteration per frame. This caps the rate to ~60 Hz
    // instead of the postMessage-bound ~1 kHz the default supervisor produces,
    // and lets the main thread breathe between matrix applications.
    this.iterationsRequested = false
    this.scheduleNextIteration()
  }

  private scheduleNextIteration() {
    if (!this.running || this.iterationsRequested) return
    const runToken = this.runToken
    this.iterationsRequested = true
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null
      if (this.runToken !== runToken) return
      if (!this.running) return
      this.askForIterations(false)
    })
  }

  private askForIterations(withEdges: boolean) {
    if (!this.worker || !this.matrices) return

    const nodesBuffer = this.matrices.nodes.buffer as ArrayBuffer
    const payload: {
      settings: ForceAtlas2Settings
      nodes: ArrayBuffer
      edges?: ArrayBuffer
    } = {
      settings: this.settings,
      nodes: nodesBuffer,
    }
    const transfer: ArrayBuffer[] = [nodesBuffer]
    if (withEdges) {
      const edgesBuffer = this.matrices.edges.buffer as ArrayBuffer
      payload.edges = edgesBuffer
      transfer.push(edgesBuffer)
    }
    this.worker.postMessage(payload, transfer)
  }

  private snapshotPositions(matrix: Float32Array): Float32Array {
    // Node matrix layout: 10 floats per node, first two are x/y.
    const nodeCount = matrix.length / 10
    const snapshot = new Float32Array(nodeCount * 2)
    for (let i = 0, j = 0; i < matrix.length; i += 10, j += 2) {
      snapshot[j] = matrix[i]!
      snapshot[j + 1] = matrix[i + 1]!
    }
    return snapshot
  }

  private measureGraphDiameter(matrix: Float32Array): number {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < matrix.length; i += 10) {
      const x = matrix[i]!
      const y = matrix[i + 1]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const w = maxX - minX
    const h = maxY - minY
    return Math.sqrt(w * w + h * h)
  }

  private measureMaxDisplacement(matrix: Float32Array): number {
    if (!this.previousPositions) return Number.POSITIVE_INFINITY
    let maxSquared = 0
    for (let i = 0, j = 0; i < matrix.length; i += 10, j += 2) {
      const dx = matrix[i]! - this.previousPositions[j]!
      const dy = matrix[i + 1]! - this.previousPositions[j + 1]!
      const distSq = dx * dx + dy * dy
      if (distSq > maxSquared) maxSquared = distSq
    }
    return Math.sqrt(maxSquared)
  }
}

const createSettingsKey = (
  graphOrder: number,
  tuning: ForceAtlasPhysicsTuning,
  maxDegree = 0,
) => {
  const denseBucket = Math.round(resolveForceAtlasDenseFactor(graphOrder) * 12)
  const tuningBuckets = [
    tuning.centripetalForce,
    tuning.repulsionForce,
    tuning.linkForce,
    tuning.linkDistance,
    tuning.damping,
  ].map((value) => Math.round(value * 100))

  return [
    OBSIDIAN_PHYSICS_PRESET_VERSION,
    Math.floor(Math.log2(Math.max(graphOrder, 1))),
    shouldUseBarnesHutOptimization(graphOrder, maxDegree),
    denseBucket,
    ...tuningBuckets,
  ].join('::')
}

const resolveMaxGraphDegree = (
  graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
) => {
  let maxDegree = 0
  graph.forEachNode((pubkey) => {
    maxDegree = Math.max(maxDegree, graph.degree(pubkey))
  })
  return maxDegree
}

const createEmptyBounds = () => ({
  minX: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
})

const resolveGraphBounds = (
  graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
): ForceAtlasPhysicsDiagnostics['bounds'] => {
  if (graph.order === 0) {
    return null
  }

  const bounds = createEmptyBounds()

  for (const node of graph.nodes()) {
    const attributes = graph.getNodeAttributes(node)
    bounds.minX = Math.min(bounds.minX, attributes.x)
    bounds.maxX = Math.max(bounds.maxX, attributes.x)
    bounds.minY = Math.min(bounds.minY, attributes.y)
    bounds.maxY = Math.max(bounds.maxY, attributes.y)
  }

  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

const resolveAverageEdgeLength = (
  graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
) => {
  if (graph.size === 0) {
    return null
  }

  let totalLength = 0
  let measuredEdges = 0

  for (const edge of graph.edges()) {
    const source = graph.getNodeAttributes(graph.source(edge))
    const target = graph.getNodeAttributes(graph.target(edge))
    totalLength += Math.hypot(target.x - source.x, target.y - source.y)
    measuredEdges += 1
  }

  return measuredEdges > 0 ? totalLength / measuredEdges : null
}

const resolveApproximateOverlapCount = (
  graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
) => {
  const nodes = graph.nodes().slice(0, OVERLAP_SAMPLE_LIMIT)
  let overlapCount = 0

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = graph.getNodeAttributes(nodes[leftIndex]!)

    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = graph.getNodeAttributes(nodes[rightIndex]!)
      const minimumDistance = (left.size + right.size) * 0.5

      if (Math.hypot(right.x - left.x, right.y - left.y) < minimumDistance) {
        overlapCount += 1
      }
    }
  }

  return {
    sampledNodeCount: nodes.length,
    approximateOverlapCount: overlapCount,
  }
}

export class ForceAtlasRuntime {
  private layout: ForceAtlasLayoutController | null = null

  private lastSettingsKey: string | null = null

  private lastFixedNodeSignature: string | null = null

  private suspended = false

  private layoutEligible = false

  private settled = false

  private autoFreezeEnabled = true

  private physicsTuning = DEFAULT_FORCE_ATLAS_PHYSICS_TUNING

  private readonly markSettled = () => {
    this.settled = true
  }

  public constructor(
    private readonly graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
    private readonly layoutFactory: (
      graph: Graph<PhysicsNodeAttributes, PhysicsEdgeAttributes>,
      settings: ForceAtlas2Settings,
      options: ConvergingLayoutOptions,
    ) => ForceAtlasLayoutController = (graph, settings, options) =>
      new ConvergingFA2Supervisor(graph, settings, options),
  ) {}

  private createFixedNodeSignature(scene: GraphPhysicsSnapshot) {
    return scene.nodes
      .map((node) => `${node.pubkey}:${node.fixed ? 1 : 0}`)
      .sort()
      .join('|')
  }

  private createGraphFixedNodeSignature() {
    return this.graph
      .nodes()
      .map((pubkey) => {
        const attributes = this.graph.getNodeAttributes(pubkey)
        return `${pubkey}:${attributes.fixed ? 1 : 0}`
      })
      .sort()
      .join('|')
  }

  public sync(
    scene: GraphPhysicsSnapshot,
    options: ForceAtlasSyncOptions = {},
  ) {
    const shouldRun =
      scene.nodes.length >= MINIMUM_RUNNING_NODES && scene.edges.length > 0
    this.layoutEligible = shouldRun

    if (!shouldRun) {
      this.stop()
      if (options.topologyChanged) {
        this.kill()
        this.settled = false
      }
      return
    }

    const maxDegree = resolveMaxGraphDegree(this.graph)
    const settingsKey = createSettingsKey(
      this.graph.order,
      this.physicsTuning,
      maxDegree,
    )
    const fixedNodeSignature = this.createFixedNodeSignature(scene)

    if (this.suspended) {
      if (options.topologyChanged) {
        this.stop()
        this.kill()
        this.settled = false
      }
      return
    }

    if (this.layout === null) {
      this.layout = this.createLayout()
      this.lastSettingsKey = settingsKey
      this.lastFixedNodeSignature = fixedNodeSignature
      this.layout.start()
      return
    }

    if (
      options.topologyChanged ||
      this.lastSettingsKey !== settingsKey ||
      this.lastFixedNodeSignature !== fixedNodeSignature
    ) {
      this.restartLayout(settingsKey, fixedNodeSignature)
      return
    }

    // Sync is called on every scene change (hover, selection, filters). If
    // the layout already converged and nothing structural (settings / fixed
    // nodes / topology — handled above) changed, don't restart it: doing so
    // re-iterates from equilibrium and produces visible residual motion.
    if (!this.layout.isRunning() && !this.settled) {
      this.layout.start()
    }
  }

  private restartLayout(settingsKey: string, fixedNodeSignature: string) {
    this.stop()
    this.kill()
    this.layout = this.createLayout()
    this.lastSettingsKey = settingsKey
    this.lastFixedNodeSignature = fixedNodeSignature
    this.layout.start()
  }

  public reheat() {
    if (this.suspended) {
      return
    }

    if (!this.layoutEligible) {
      return
    }

    this.stop()
    this.kill()
    this.layout = this.createLayout()
    this.lastSettingsKey = createSettingsKey(
      this.graph.order,
      this.physicsTuning,
      resolveMaxGraphDegree(this.graph),
    )
    this.lastFixedNodeSignature = this.createGraphFixedNodeSignature()
    this.layout.start()
  }

  public setAutoFreezeEnabled(enabled: boolean) {
    if (this.autoFreezeEnabled === enabled) {
      return
    }

    this.autoFreezeEnabled = enabled
    this.layout?.setAutoFreezeEnabled?.(enabled)

    if (enabled) {
      return
    }

    this.settled = false
    if (this.suspended || !this.layoutEligible) {
      return
    }

    if (this.layout === null) {
      this.layout = this.createLayout()
      this.lastSettingsKey = createSettingsKey(
        this.graph.order,
        this.physicsTuning,
        resolveMaxGraphDegree(this.graph),
      )
      this.lastFixedNodeSignature = this.createGraphFixedNodeSignature()
    }

    if (!this.layout.isRunning()) {
      this.layout.start()
    }
  }

  public setPhysicsTuning(tuning: Partial<ForceAtlasPhysicsTuning> = {}) {
    const nextTuning = createForceAtlasPhysicsTuning(tuning)
    const maxDegree = resolveMaxGraphDegree(this.graph)
    const currentKey = createSettingsKey(
      this.graph.order,
      this.physicsTuning,
      maxDegree,
    )
    const nextKey = createSettingsKey(this.graph.order, nextTuning, maxDegree)

    this.physicsTuning = nextTuning

    if (currentKey === nextKey) {
      return
    }

    if (!this.layoutEligible || this.suspended) {
      this.stop()
      this.kill()
      return
    }

    this.stop()
    this.kill()
    this.layout = this.createLayout()
    this.lastSettingsKey = nextKey
    this.lastFixedNodeSignature = this.createGraphFixedNodeSignature()
    this.layout.start()
  }

  public stop() {
    if (this.layout?.isRunning()) {
      this.layout.stop()
    }
  }

  public suspend() {
    this.suspended = true
    this.stop()
  }

  public resume(options: { invalidateConvergence?: boolean } = {}) {
    if (!this.suspended) {
      return
    }

    this.suspended = false
    if (options.invalidateConvergence) {
      this.settled = false
    }

    if (!this.layoutEligible) {
      return
    }

    if (this.layout === null) {
      this.layout = this.createLayout()
      this.lastSettingsKey = createSettingsKey(
        this.graph.order,
        this.physicsTuning,
        resolveMaxGraphDegree(this.graph),
      )
      this.lastFixedNodeSignature = this.createGraphFixedNodeSignature()
      this.layout.start()
      return
    }

    if (!this.layout.isRunning() && !this.settled) {
      this.layout.start()
    }
  }

  public isSuspended() {
    return this.suspended
  }

  public isRunning() {
    return this.layout?.isRunning() ?? false
  }

  public getDiagnostics(): ForceAtlasPhysicsDiagnostics {
    const overlap = resolveApproximateOverlapCount(this.graph)
    const maxDegree = resolveMaxGraphDegree(this.graph)
    const hubRatio = resolveHubRatio(this.graph.order, maxDegree)

    return {
      presetVersion: OBSIDIAN_PHYSICS_PRESET_VERSION,
      graphOrder: this.graph.order,
      graphSize: this.graph.size,
      maxDegree,
      hubRatio,
      settingsKey: this.lastSettingsKey,
      layoutEligible: this.layoutEligible,
      running: this.isRunning(),
      suspended: this.suspended,
      autoFreezeEnabled: this.autoFreezeEnabled,
      denseFactor: resolveForceAtlasDenseFactor(this.graph.order),
      tuning: this.physicsTuning,
      settings: resolveForceAtlasSettings(this.graph.order, this.physicsTuning, {
        maxDegree,
      }),
      bounds: resolveGraphBounds(this.graph),
      averageEdgeLength: resolveAverageEdgeLength(this.graph),
      ...overlap,
    }
  }

  public kill() {
    this.layout?.kill()
    this.layout = null
    this.lastSettingsKey = null
    this.lastFixedNodeSignature = null
  }

  public dispose() {
    this.stop()
    this.kill()
  }

  private createLayout() {
    // Every new layout instance starts "unsettled": it is about to iterate
    // from the current positions and we want sync() to respect the layout's
    // own convergence signal, not the previous one.
    this.settled = false
    return this.layoutFactory(
      this.graph,
      resolveForceAtlasSettings(this.graph.order, this.physicsTuning, {
        maxDegree: resolveMaxGraphDegree(this.graph),
      }),
      {
        onSettled: this.markSettled,
        autoFreezeEnabled: this.autoFreezeEnabled,
      },
    )
  }
}
