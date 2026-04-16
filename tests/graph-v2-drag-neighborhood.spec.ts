import { expect, test, type Page } from 'playwright/test'

import type {
  DebugNeighborGroups,
  DebugNodePosition,
  DebugDragRuntimeState,
  DebugSelectionState,
  DebugViewportPosition,
} from '../src/features/graph-v2/testing/browserDebug'

const SIGMA_LAB_URL = '/labs/sigma?fixture=drag-local&testMode=1'
const TARGET_PUBKEY = 'fixture-drag-target'
const PINNED_NEIGHBOR_PUBKEY = 'fixture-pinned-neighbor'
const DEPTH1_MOVABLE_PUBKEY = 'fixture-hop1-a'
const DEPTH2_PUBKEY = 'fixture-hop2-a'
const OUTSIDE_PUBKEY = 'fixture-outside-a'

interface DragMetrics {
  selectedBeforeDrag: string | null
  selectedAfterDrag: string | null
  selectedAfterClick: string | null
  pinnedNeighborPubkey: string | null
  candidatePubkey: string | null
  degree: number | null
  cursorDistancePx: number[]
  meanDisplacements: Record<string, number>
  pinnedDisplacement: number | null
  residuals: number[]
  settlingSpeeds: number[]
  settlingStepDisplacements: number[]
}

interface SampledNodes {
  target: DebugNodePosition
  depth1: DebugNodePosition
  depth2: DebugNodePosition
  outside: DebugNodePosition
  pinned: DebugNodePosition
}

const getViewportPosition = async (page: Page, pubkey: string) =>
  page.evaluate(
    (targetPubkey) => window.__sigmaLabDebug?.getViewportPosition(targetPubkey) ?? null,
    pubkey,
  ) as Promise<DebugViewportPosition | null>

const getNodePosition = async (page: Page, pubkey: string) =>
  page.evaluate(
    (targetPubkey) => window.__sigmaLabDebug?.getNodePosition(targetPubkey) ?? null,
    pubkey,
  ) as Promise<DebugNodePosition | null>

const getNeighborGroups = async (page: Page, pubkey: string) =>
  page.evaluate(
    (targetPubkey) => window.__sigmaLabDebug?.getNeighborGroups(targetPubkey) ?? null,
    pubkey,
  ) as Promise<DebugNeighborGroups | null>

const getSelectionState = async (page: Page) =>
  page.evaluate(
    () => window.__sigmaLabDebug?.getSelectionState() ?? null,
  ) as Promise<DebugSelectionState | null>

const getDragRuntimeState = async (page: Page) =>
  page.evaluate(
    () => window.__sigmaLabDebug?.getDragRuntimeState() ?? null,
  ) as Promise<DebugDragRuntimeState | null>

const getFixedState = async (page: Page, pubkey: string) =>
  page.evaluate(
    (targetPubkey) => window.__sigmaLabDebug?.isNodeFixed(targetPubkey) ?? false,
    pubkey,
  ) as Promise<boolean>

const clickNodeUntilSelected = async (
  page: Page,
  pubkey: string,
  maxAttempts = 10,
) => {
  const clickOffsets = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
    { x: 3, y: 3 },
    { x: -3, y: 3 },
    { x: 3, y: -3 },
    { x: -3, y: -3 },
  ]
  let lastSelection: DebugSelectionState | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const viewport = await getViewportPosition(page, pubkey)
    expect(viewport).not.toBeNull()

    for (const offset of clickOffsets) {
      await page.mouse.click(viewport!.clientX + offset.x, viewport!.clientY + offset.y)
      await page.waitForTimeout(80)
      lastSelection = await getSelectionState(page)
      if (lastSelection?.selectedNodePubkey === pubkey) {
        return
      }
    }
  }

  throw new Error(
    `No se pudo seleccionar ${pubkey}. Ultima seleccion observada: ${
      lastSelection?.selectedNodePubkey ?? 'null'
    }`,
  )
}

const distance = (left: DebugNodePosition, right: DebugNodePosition) =>
  Math.hypot(left.x - right.x, left.y - right.y)

const displacement = (
  baseline: DebugNodePosition,
  current: DebugNodePosition,
) => distance(baseline, current)

const collectPositions = async (
  page: Page,
  pubkeys: readonly string[],
) => {
  const entries = await Promise.all(
    pubkeys.map(async (pubkey) => [pubkey, await getNodePosition(page, pubkey)] as const),
  )

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, DebugNodePosition] => Boolean(entry[1])),
  )
}

const meanDisplacement = (
  baseline: Record<string, DebugNodePosition>,
  current: Record<string, DebugNodePosition>,
  pubkeys: readonly string[],
) => {
  const displacements = pubkeys
    .map((pubkey) => {
      const initial = baseline[pubkey]
      const next = current[pubkey]
      return initial && next ? distance(initial, next) : null
    })
    .filter((value): value is number => value !== null)

  if (displacements.length === 0) {
    return 0
  }

  return displacements.reduce((sum, value) => sum + value, 0) / displacements.length
}

const collectTrackedNodes = async (page: Page): Promise<SampledNodes> => {
  const [target, depth1, depth2, outside, pinned] = await Promise.all([
    getNodePosition(page, TARGET_PUBKEY),
    getNodePosition(page, DEPTH1_MOVABLE_PUBKEY),
    getNodePosition(page, DEPTH2_PUBKEY),
    getNodePosition(page, OUTSIDE_PUBKEY),
    getNodePosition(page, PINNED_NEIGHBOR_PUBKEY),
  ])

  expect(target).not.toBeNull()
  expect(depth1).not.toBeNull()
  expect(depth2).not.toBeNull()
  expect(outside).not.toBeNull()
  expect(pinned).not.toBeNull()

  return {
    target: target!,
    depth1: depth1!,
    depth2: depth2!,
    outside: outside!,
    pinned: pinned!,
  }
}

test('arrastra un nodo real y demuestra influencia local por vecindad', async ({
  page,
}, testInfo) => {
  const metrics: DragMetrics = {
    selectedBeforeDrag: null,
    selectedAfterDrag: null,
    selectedAfterClick: null,
    pinnedNeighborPubkey: null,
    candidatePubkey: null,
    degree: null,
    cursorDistancePx: [],
    meanDisplacements: {},
    pinnedDisplacement: null,
    residuals: [],
    settlingSpeeds: [],
    settlingStepDisplacements: [],
  }

  try {
    await page.goto(SIGMA_LAB_URL)
    await page.waitForFunction(
      () =>
        typeof window.__sigmaLabDebug !== 'undefined' &&
        window.__sigmaLabDebug !== null &&
        window.__sigmaLabDebug.findDragCandidate().pubkey === 'fixture-drag-target',
    )
    await expect.poll(() => getViewportPosition(page, TARGET_PUBKEY)).not.toBeNull()
    await expect.poll(() => getNodePosition(page, TARGET_PUBKEY)).not.toBeNull()

    const candidate = await page.evaluate(
      () => window.__sigmaLabDebug?.findDragCandidate({ minDegree: 3, maxDegree: 10 }) ?? null,
    )
    expect(candidate).toMatchObject({
      pubkey: TARGET_PUBKEY,
    })

    metrics.candidatePubkey = candidate?.pubkey ?? null
    metrics.degree = candidate?.degree ?? null

    const neighborGroups = await getNeighborGroups(page, TARGET_PUBKEY)
    expect(neighborGroups).not.toBeNull()
    expect(neighborGroups).toMatchObject({
      sourcePubkey: TARGET_PUBKEY,
    })
    expect(neighborGroups?.depth1).toContain(PINNED_NEIGHBOR_PUBKEY)
    expect(neighborGroups?.depth1).toContain(DEPTH1_MOVABLE_PUBKEY)
    expect(neighborGroups?.depth2).toContain(DEPTH2_PUBKEY)
    expect(neighborGroups?.outside).toContain(OUTSIDE_PUBKEY)

    metrics.pinnedNeighborPubkey = PINNED_NEIGHBOR_PUBKEY
    expect(await getFixedState(page, PINNED_NEIGHBOR_PUBKEY)).toBe(true)
    const initialPinnedSelection = await getSelectionState(page)
    expect(initialPinnedSelection?.pinnedNodePubkeys).toContain(PINNED_NEIGHBOR_PUBKEY)

    const baselineRuntimeState = await getDragRuntimeState(page)
    expect(baselineRuntimeState).toMatchObject({
      draggedNodePubkey: null,
      settlingDraggedNodePubkey: null,
      forceAtlasRunning: true,
      forceAtlasSuspended: false,
    })

    const baselineSelection = await getSelectionState(page)
    expect(baselineSelection).toMatchObject({
      selectedNodePubkey: null,
    })

    const trackedPubkeys = [
      TARGET_PUBKEY,
      ...neighborGroups!.depth1,
      ...neighborGroups!.depth2,
      ...neighborGroups!.outside,
    ]
    const movableDepth1Pubkeys = neighborGroups!.depth1.filter(
      (pubkey) => pubkey !== PINNED_NEIGHBOR_PUBKEY,
    )
    await clickNodeUntilSelected(page, TARGET_PUBKEY)

    const selectionAfterClick = await getSelectionState(page)
    metrics.selectedBeforeDrag = selectionAfterClick?.selectedNodePubkey ?? null

    const baselinePositions = await collectTrackedNodes(page)
    const baselineGroupPositions = await collectPositions(page, trackedPubkeys)

    const start = await getViewportPosition(page, TARGET_PUBKEY)
    expect(start).not.toBeNull()
    await page.mouse.move(start!.clientX, start!.clientY)
    await page.mouse.down()

    const totalDx = 120
    const totalDy = 72
    const steps = 8
    const dragSamples: Array<{
      viewport: DebugViewportPosition
      runtime: DebugDragRuntimeState | null
      position: DebugNodePosition
      cursorErrorPx: number
    }> = []

    for (let step = 1; step <= steps; step += 1) {
      const nextX = start!.clientX + (totalDx * step) / steps
      const nextY = start!.clientY + (totalDy * step) / steps
      await page.mouse.move(nextX, nextY, { steps: 1 })
      await page.waitForTimeout(32)
      const dragRuntimeState = await getDragRuntimeState(page)
      const viewport = await getViewportPosition(page, TARGET_PUBKEY)
      const position = await getNodePosition(page, TARGET_PUBKEY)
      expect(viewport).not.toBeNull()
      expect(position).not.toBeNull()

      const cursorErrorPx = Math.hypot(viewport!.clientX - nextX, viewport!.clientY - nextY)
      metrics.cursorDistancePx.push(cursorErrorPx)
      dragSamples.push({
        viewport: viewport!,
        runtime: dragRuntimeState,
        position: position!,
        cursorErrorPx,
      })
    }

    const lastCursorX = start!.clientX + totalDx
    const lastCursorY = start!.clientY + totalDy
    await expect
      .poll(async () => {
        const viewport = await getViewportPosition(page, TARGET_PUBKEY)
        if (!viewport) {
          return Number.POSITIVE_INFINITY
        }

        return Math.hypot(viewport.clientX - lastCursorX, viewport.clientY - lastCursorY)
      })
      .toBeLessThan(18)
    const duringDragPositions = await collectTrackedNodes(page)
    const duringDragGroupPositions = await collectPositions(page, trackedPubkeys)

    for (const sample of dragSamples) {
      expect(sample.runtime).toMatchObject({
        draggedNodePubkey: TARGET_PUBKEY,
        settlingDraggedNodePubkey: null,
        forceAtlasSuspended: true,
        forceAtlasRunning: false,
      })
      expect(sample.cursorErrorPx).toBeLessThan(18)
    }

    await expect
      .poll(() => getDragRuntimeState(page))
      .toMatchObject({
        draggedNodePubkey: TARGET_PUBKEY,
        settlingDraggedNodePubkey: null,
        forceAtlasSuspended: true,
        forceAtlasRunning: false,
      })

    const targetDragDisplacement = displacement(
      baselinePositions.target,
      duringDragPositions.target,
    )
    const depth1Displacement = displacement(
      baselinePositions.depth1,
      duringDragPositions.depth1,
    )
    const depth2Displacement = displacement(
      baselinePositions.depth2,
      duringDragPositions.depth2,
    )
    const pinnedDisplacement = displacement(
      baselinePositions.pinned,
      duringDragPositions.pinned,
    )

    await page.mouse.up()
    const selectionAfterDrag = await getSelectionState(page)
    metrics.selectedAfterDrag = selectionAfterDrag?.selectedNodePubkey ?? null
    expect(selectionAfterDrag?.selectedNodePubkey).toBe(TARGET_PUBKEY)
    expect(await getFixedState(page, PINNED_NEIGHBOR_PUBKEY)).toBe(true)
    await expect
      .poll(() => getDragRuntimeState(page))
      .toMatchObject({
        draggedNodePubkey: null,
        settlingDraggedNodePubkey: TARGET_PUBKEY,
        forceAtlasSuspended: true,
        forceAtlasRunning: false,
      })
    const settlingState0 = await getDragRuntimeState(page)
    expect(settlingState0?.settlingSpeed ?? 0).toBeGreaterThan(0)
    metrics.settlingSpeeds.push(settlingState0?.settlingSpeed ?? 0)
    expect(await getFixedState(page, TARGET_PUBKEY)).toBe(true)

    const settlingSamples: Array<{
      runtime: DebugDragRuntimeState | null
      nodes: SampledNodes
    }> = []

    for (let index = 0; index < 3; index += 1) {
      await page.waitForTimeout(35)
      const runtime = await getDragRuntimeState(page)
      const nodes = await collectTrackedNodes(page)
      metrics.settlingSpeeds.push(runtime?.settlingSpeed ?? 0)
      settlingSamples.push({ runtime, nodes })
      if (runtime?.settlingDraggedNodePubkey === TARGET_PUBKEY) {
        expect(runtime).toMatchObject({
          settlingDraggedNodePubkey: TARGET_PUBKEY,
          forceAtlasSuspended: true,
          forceAtlasRunning: false,
        })
      } else {
        expect(runtime).toMatchObject({
          settlingDraggedNodePubkey: null,
          forceAtlasSuspended: false,
          forceAtlasRunning: true,
        })
      }
    }

    const activeSettlingSamples = settlingSamples.filter(
      (sample) => sample.runtime?.settlingDraggedNodePubkey === TARGET_PUBKEY,
    )
    const settlingStepDisplacements = activeSettlingSamples.map((sample, index) =>
      index === 0
        ? displacement(duringDragPositions.target, sample.nodes.target)
        : displacement(activeSettlingSamples[index - 1]!.nodes.target, sample.nodes.target),
    )
    metrics.settlingStepDisplacements = settlingStepDisplacements

    for (let index = 1; index < metrics.settlingSpeeds.length; index += 1) {
      expect(metrics.settlingSpeeds[index]!).toBeLessThanOrEqual(
        metrics.settlingSpeeds[index - 1]! + 1e-6,
      )
    }

    expect(settlingStepDisplacements[0]).toBeGreaterThan(0)
    if (settlingStepDisplacements.length > 1) {
      expect(settlingStepDisplacements[1]!).toBeLessThanOrEqual(
        settlingStepDisplacements[0]! + 1,
      )
    }
    if (settlingStepDisplacements.length > 2) {
      expect(settlingStepDisplacements[2]!).toBeLessThanOrEqual(
        settlingStepDisplacements[1]! + 1,
      )
    }
    expect(activeSettlingSamples.length).toBeGreaterThan(0)
    expect(
      displacement(baselinePositions.target, activeSettlingSamples[0]!.nodes.target),
    ).toBeGreaterThan(targetDragDisplacement * 0.7)

    await expect.poll(() => getFixedState(page, TARGET_PUBKEY)).toBe(false)
    await expect
      .poll(() => getDragRuntimeState(page))
      .toMatchObject({
        draggedNodePubkey: null,
        settlingDraggedNodePubkey: null,
        forceAtlasSuspended: false,
        forceAtlasRunning: true,
      })
    const afterSettling = await collectTrackedNodes(page)

    const postReleaseSamples: SampledNodes[] = []
    for (let index = 0; index < 3; index += 1) {
      await page.waitForTimeout(170)
      postReleaseSamples.push(await collectTrackedNodes(page))
    }

    metrics.meanDisplacements = {
      dragged: targetDragDisplacement,
      draggedSettling: displacement(
        baselinePositions.target,
        activeSettlingSamples[0]!.nodes.target,
      ),
      draggedAfterRelease: displacement(baselinePositions.target, afterSettling.target),
      depth1Movable: meanDisplacement(
        baselineGroupPositions,
        duringDragGroupPositions,
        movableDepth1Pubkeys,
      ),
      depth2: meanDisplacement(
        baselineGroupPositions,
        duringDragGroupPositions,
        neighborGroups!.depth2,
      ),
      outside: meanDisplacement(
        baselineGroupPositions,
        duringDragGroupPositions,
        neighborGroups!.outside,
      ),
    }
    metrics.pinnedDisplacement = pinnedDisplacement

    metrics.residuals = [
      displacement(afterSettling.target, postReleaseSamples[0]!.target),
      displacement(postReleaseSamples[0]!.target, postReleaseSamples[1]!.target),
      displacement(postReleaseSamples[1]!.target, postReleaseSamples[2]!.target),
    ]

    expect(targetDragDisplacement).toBeGreaterThan(40)
    expect(depth1Displacement).toBeGreaterThan(20)
    expect(depth2Displacement).toBeGreaterThan(8)
    expect(metrics.meanDisplacements.depth1Movable).toBeGreaterThan(
      metrics.meanDisplacements.depth2 * 1.8,
    )
    expect(metrics.meanDisplacements.outside).toBeLessThan(metrics.meanDisplacements.depth2)
    expect(metrics.meanDisplacements.outside).toBeLessThan(
      metrics.meanDisplacements.depth1Movable * 0.5,
    )
    expect(pinnedDisplacement).toBeLessThan(0.01)
    expect(await getFixedState(page, PINNED_NEIGHBOR_PUBKEY)).toBe(true)
    expect(displacement(baselinePositions.target, afterSettling.target)).toBeGreaterThan(40)
    expect(metrics.residuals[1]!).toBeLessThanOrEqual(metrics.residuals[0]! + 1)
    expect(metrics.residuals[2]!).toBeLessThanOrEqual(metrics.residuals[1]! + 1)

    const candidateAfterDrag = await getViewportPosition(page, TARGET_PUBKEY)
    expect(candidateAfterDrag).not.toBeNull()
    await page.mouse.click(candidateAfterDrag!.clientX, candidateAfterDrag!.clientY)
    await page.waitForTimeout(60)

    const selectionAfterSuppressedClick = await getSelectionState(page)
    expect(selectionAfterSuppressedClick?.selectedNodePubkey).toBe(TARGET_PUBKEY)

    await page.waitForTimeout(260)
    await clickNodeUntilSelected(page, OUTSIDE_PUBKEY)
    metrics.selectedAfterClick = (await getSelectionState(page))?.selectedNodePubkey ?? null
    expect(metrics.selectedAfterClick).toBe(OUTSIDE_PUBKEY)
  } catch (error) {
    await testInfo.attach('drag-metrics', {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json',
    })
    throw error
  }
})
