import { expect, test, type Page } from 'playwright/test'

import type {
  DebugNeighborGroups,
  DebugNodePosition,
  DebugDragRuntimeState,
  DebugSelectionState,
  DebugViewportPosition,
} from '../src/features/graph-v2/testing/browserDebug'

const SIGMA_LAB_URL = '/labs/sigma?fixture=drag-local&fixtureSource=local&testMode=1'
const TARGET_PUBKEY = 'fixture-drag-target'
const PINNED_NEIGHBOR_PUBKEY = 'fixture-pinned-neighbor'
const DEPTH1_MOVABLE_PUBKEY = 'fixture-hop1-a'
const DEPTH2_PUBKEY = 'fixture-hop2-a'
const DEPTH3_PUBKEY = 'fixture-hop3-a'
const OUTSIDE_PUBKEY = 'fixture-outside-a'

interface DragMetrics {
  selectedBeforeDrag: string | null
  selectedAfterDrag: string | null
  pinnedNeighborPubkey: string | null
  candidatePubkey: string | null
  degree: number | null
  cursorDistancePx: number[]
  meanDisplacements: Record<string, number>
  pinnedDisplacement: number | null
  residuals: number[]
}

interface SampledNodes {
  target: DebugNodePosition
  depth1: DebugNodePosition
  depth2: DebugNodePosition
  depth3: DebugNodePosition
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
  const [target, depth1, depth2, depth3, outside, pinned] = await Promise.all([
    getNodePosition(page, TARGET_PUBKEY),
    getNodePosition(page, DEPTH1_MOVABLE_PUBKEY),
    getNodePosition(page, DEPTH2_PUBKEY),
    getNodePosition(page, DEPTH3_PUBKEY),
    getNodePosition(page, OUTSIDE_PUBKEY),
    getNodePosition(page, PINNED_NEIGHBOR_PUBKEY),
  ])

  expect(target).not.toBeNull()
  expect(depth1).not.toBeNull()
  expect(depth2).not.toBeNull()
  expect(depth3).not.toBeNull()
  expect(outside).not.toBeNull()
  expect(pinned).not.toBeNull()

  return {
    target: target!,
    depth1: depth1!,
    depth2: depth2!,
    depth3: depth3!,
    outside: outside!,
    pinned: pinned!,
  }
}

test('arrastra un nodo real con influencia elastica continua al estilo Obsidian', async ({
  page,
}, testInfo) => {
  const metrics: DragMetrics = {
    selectedBeforeDrag: null,
    selectedAfterDrag: null,
    pinnedNeighborPubkey: null,
    candidatePubkey: null,
    degree: null,
    cursorDistancePx: [],
    meanDisplacements: {},
    pinnedDisplacement: null,
    residuals: [],
  }

  try {
    await page.goto(SIGMA_LAB_URL)
    await page.waitForFunction(
      () =>
        typeof window.__sigmaLabDebug !== 'undefined' &&
        window.__sigmaLabDebug !== null &&
        window.__sigmaLabDebug.findDragCandidate()?.pubkey === 'fixture-drag-target',
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
    expect(neighborGroups?.depth3).toContain(DEPTH3_PUBKEY)
    expect(neighborGroups?.outside).toContain(OUTSIDE_PUBKEY)

    metrics.pinnedNeighborPubkey = PINNED_NEIGHBOR_PUBKEY
    expect(await getFixedState(page, PINNED_NEIGHBOR_PUBKEY)).toBe(true)
    const initialPinnedSelection = await getSelectionState(page)
    expect(initialPinnedSelection?.pinnedNodePubkeys).toContain(PINNED_NEIGHBOR_PUBKEY)

    const baselineRuntimeState = await getDragRuntimeState(page)
    expect(baselineRuntimeState).toMatchObject({
      draggedNodePubkey: null,
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
      ...neighborGroups!.depth3,
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
        forceAtlasSuspended: true,
        forceAtlasRunning: false,
      })
      expect(sample.cursorErrorPx).toBeLessThan(18)
    }

    const runtimeDuringDrag = await getDragRuntimeState(page)
    expect(runtimeDuringDrag?.influencedNodeCount ?? 0).toBeGreaterThanOrEqual(6)
    expect(runtimeDuringDrag?.maxHopDistance ?? 0).toBeGreaterThanOrEqual(3)
    expect(
      runtimeDuringDrag?.influenceHopSample.some(
        (entry) => entry.pubkey === DEPTH3_PUBKEY && entry.hopDistance === 3,
      ) ?? false,
    ).toBe(true)
    // Outside nodes live in a disconnected component; BFS should leave them
    // out of the drag hop map entirely.
    expect(
      runtimeDuringDrag?.influenceHopSample.some(
        (entry) => entry.pubkey === OUTSIDE_PUBKEY,
      ) ?? false,
    ).toBe(false)

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
    const depth3Displacement = displacement(
      baselinePositions.depth3,
      duringDragPositions.depth3,
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

    // On release the drag pipeline clears and FA2 reheats to relax the graph.
    await expect
      .poll(() => getDragRuntimeState(page))
      .toMatchObject({
        draggedNodePubkey: null,
        forceAtlasSuspended: false,
        forceAtlasRunning: true,
      })
    await expect.poll(() => getFixedState(page, TARGET_PUBKEY)).toBe(false)

    const afterRelease = await collectTrackedNodes(page)
    const postReleaseSamples: SampledNodes[] = []
    for (let index = 0; index < 3; index += 1) {
      await page.waitForTimeout(170)
      postReleaseSamples.push(await collectTrackedNodes(page))
    }

    metrics.meanDisplacements = {
      dragged: targetDragDisplacement,
      draggedAfterRelease: displacement(baselinePositions.target, afterRelease.target),
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
      depth3: meanDisplacement(
        baselineGroupPositions,
        duringDragGroupPositions,
        neighborGroups!.depth3,
      ),
      outside: meanDisplacement(
        baselineGroupPositions,
        duringDragGroupPositions,
        neighborGroups!.outside,
      ),
    }
    metrics.pinnedDisplacement = pinnedDisplacement

    metrics.residuals = [
      displacement(afterRelease.target, postReleaseSamples[0]!.target),
      displacement(postReleaseSamples[0]!.target, postReleaseSamples[1]!.target),
      displacement(postReleaseSamples[1]!.target, postReleaseSamples[2]!.target),
    ]

    expect(targetDragDisplacement).toBeGreaterThan(40)
    expect(depth1Displacement).toBeGreaterThan(20)
    expect(depth2Displacement).toBeGreaterThan(6)
    expect(depth3Displacement).toBeGreaterThan(0.5)
    expect(depth1Displacement).toBeGreaterThan(depth2Displacement)
    expect(depth2Displacement).toBeGreaterThan(depth3Displacement)
    expect(metrics.meanDisplacements.depth1Movable).toBeGreaterThan(
      metrics.meanDisplacements.depth2,
    )
    expect(metrics.meanDisplacements.depth2).toBeGreaterThan(
      metrics.meanDisplacements.depth3,
    )
    // Outside component is not reached by the spring network.
    expect(metrics.meanDisplacements.outside).toBeLessThan(0.5)
    expect(pinnedDisplacement).toBeLessThan(0.01)
    expect(await getFixedState(page, PINNED_NEIGHBOR_PUBKEY)).toBe(true)
    expect(metrics.meanDisplacements.draggedAfterRelease).toBeGreaterThan(40)

    const candidateAfterDrag = await getViewportPosition(page, TARGET_PUBKEY)
    expect(candidateAfterDrag).not.toBeNull()
    await page.mouse.click(candidateAfterDrag!.clientX, candidateAfterDrag!.clientY)
    await page.waitForTimeout(60)

    const selectionAfterSuppressedClick = await getSelectionState(page)
    expect(selectionAfterSuppressedClick?.selectedNodePubkey).toBe(TARGET_PUBKEY)
  } catch (error) {
    await testInfo.attach('drag-metrics', {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json',
    })
    throw error
  }
})
