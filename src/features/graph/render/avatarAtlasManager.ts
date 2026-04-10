import type {
  ImageRendererDeliverySnapshot,
  ImageSourceHandle,
} from '@/features/graph/render/imageRuntime'

type AvatarIconDescriptor = {
  id: string
  image: CanvasImageSource
  width: number
  height: number
  mask: false
}

export type AvatarAtlasEntry = {
  pubkey: string
  icon: AvatarIconDescriptor
}

export const createAvatarAtlasEntry = ({
  pubkey,
  handle,
}: {
  pubkey: string
  handle: ImageSourceHandle
}): AvatarAtlasEntry => ({
  pubkey,
  icon: {
    id: handle.key,
    image: handle.image,
    width: handle.bucket,
    height: handle.bucket,
    mask: false,
  },
})

type AvatarAtlasRecord = {
  icon: AvatarIconDescriptor
  status: 'loaded'
}

type AvatarAtlasSlot = {
  bucket: number
  pageIndex: number
  slotIndex: number
}

type AvatarAtlasPageLayout = {
  bucket: number
  pageIndex: number
  columns: number
  rows: number
  capacity: number
  nextSlotIndex: number
  freeSlotIndexes: number[]
}

type AvatarAtlasPageSurface = {
  frontCanvas: HTMLCanvasElement
  frontContext2d: CanvasRenderingContext2D
  backCanvas: HTMLCanvasElement
  backContext2d: CanvasRenderingContext2D
  revision: number
}

type AvatarDirtyPageEntry = {
  icon: AvatarIconDescriptor
  image: CanvasImageSource
  slot: AvatarAtlasSlot
}

type AvatarDirtyPagePlan = {
  pageKey: string
  entries: AvatarDirtyPageEntry[]
  estimatedPixels: number
}

export type AvatarIconMapping = {
  x: number
  y: number
  width: number
  height: number
  mask: false
}

export type AvatarAtlasPage = {
  key: string
  iconAtlas: HTMLCanvasElement
  iconMapping: Record<string, AvatarIconMapping>
  iconIds: string[]
  revision: number
}

export type AvatarAtlasSnapshot = {
  version: number
  pages: AvatarAtlasPage[]
  delivery: ImageRendererDeliverySnapshot
  dirtyPages: number
  pendingPageCommits: number
  committedPageCount: number
}

type AvatarAtlasManagerOptions = {
  padding?: number
  maxWidth?: number
  maxHeight?: number
  supportedBuckets?: readonly number[]
  scheduleFrame?: (flush: () => void) => void
  maxPageCommitsPerFrame?: number
  maxBurstPageCommitsPerFrame?: number
  burstCommitPixelBudget?: number
}

export type AvatarAtlasLayoutDebugSnapshot = {
  assignments: Array<{
    iconId: string
    bucket: number
    pageIndex: number
    slotIndex: number
  }>
}

const DEFAULT_PADDING = 4
const DEFAULT_MAX_WIDTH = 1024
const DEFAULT_MAX_HEIGHT = 1024
const DEFAULT_MAX_PAGE_COMMITS_PER_FRAME = 4
const DEFAULT_MAX_BURST_PAGE_COMMITS_PER_FRAME = 8
const DEFAULT_BURST_COMMIT_PIXEL_BUDGET =
  DEFAULT_MAX_WIDTH * DEFAULT_MAX_HEIGHT * 4
const BASE_ATLAS_BUCKETS = new Set([64, 128])

const createEmptyAvatarAtlasSnapshot = (): AvatarAtlasSnapshot => ({
  version: 0,
  pages: [],
  delivery: {
    paintedPubkeys: [],
    failedPubkeys: [],
  },
  dirtyPages: 0,
  pendingPageCommits: 0,
  committedPageCount: 0,
})

const nextPowerOfTwo = (value: number) => {
  if (value <= 1) {
    return 1
  }

  return 2 ** Math.ceil(Math.log2(value))
}

const scheduleAvatarAtlasFrame = (flush: () => void) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => flush())
    return
  }

  queueMicrotask(flush)
}

const equalStringLists = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

export class AvatarAtlasManager {
  private readonly padding: number
  private readonly maxWidth: number
  private readonly maxHeight: number
  private readonly supportedBuckets: ReadonlySet<number>
  private readonly scheduleFrame: (flush: () => void) => void
  private readonly maxPageCommitsPerFrame: number
  private readonly maxBurstPageCommitsPerFrame: number
  private readonly burstCommitPixelBudget: number
  private readonly recordsByIconId = new Map<string, AvatarAtlasRecord>()
  private readonly slotsByIconId = new Map<string, AvatarAtlasSlot>()
  private readonly pageLayoutsByBucket = new Map<number, AvatarAtlasPageLayout[]>()
  private readonly pageSurfacesByKey = new Map<string, AvatarAtlasPageSurface>()
  private readonly pagesByKey = new Map<string, AvatarAtlasPage>()
  private readonly dirtyPageKeys = new Set<string>()
  private visibleEntries: AvatarAtlasEntry[] = []
  private snapshot = createEmptyAvatarAtlasSnapshot()
  private version = 0
  private flushScheduled = false
  private snapshotChangeListener?: () => void

  public constructor(options: AvatarAtlasManagerOptions = {}) {
    this.padding = options.padding ?? DEFAULT_PADDING
    this.maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
    this.maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT
    this.supportedBuckets = new Set(options.supportedBuckets ?? [...BASE_ATLAS_BUCKETS])
    this.scheduleFrame = options.scheduleFrame ?? scheduleAvatarAtlasFrame
    this.maxPageCommitsPerFrame =
      options.maxPageCommitsPerFrame ?? DEFAULT_MAX_PAGE_COMMITS_PER_FRAME
    this.maxBurstPageCommitsPerFrame = Math.max(
      this.maxPageCommitsPerFrame,
      options.maxBurstPageCommitsPerFrame ?? DEFAULT_MAX_BURST_PAGE_COMMITS_PER_FRAME,
    )
    this.burstCommitPixelBudget = Math.max(
      0,
      options.burstCommitPixelBudget ?? DEFAULT_BURST_COMMIT_PIXEL_BUDGET,
    )
  }

  public setSnapshotChangeListener(listener?: () => void) {
    this.snapshotChangeListener = listener
  }

  public updateVisibleEntries({ entries }: { entries: AvatarAtlasEntry[] }) {
    this.visibleEntries = entries
      .filter((entry) => this.isSupportedEntry(entry))
      .sort((left, right) =>
        left.pubkey.localeCompare(right.pubkey),
      )
    this.syncRecords()
    const flushResult = this.flushSnapshotChanges()
    if (flushResult.pendingPageCommits > 0) {
      this.scheduleSnapshotFlush()
    }
    return this.snapshot
  }

  private isSupportedEntry(entry: AvatarAtlasEntry) {
    return (
      entry.icon.width === entry.icon.height &&
      this.supportedBuckets.has(entry.icon.width)
    )
  }

  public debugLayoutSnapshot(): AvatarAtlasLayoutDebugSnapshot {
    return {
      assignments: [...this.slotsByIconId.entries()]
        .map(([iconId, slot]) => ({
          iconId,
          bucket: slot.bucket,
          pageIndex: slot.pageIndex,
          slotIndex: slot.slotIndex,
        }))
        .sort((left, right) => left.iconId.localeCompare(right.iconId)),
    }
  }

  private syncRecords() {
    const nextIconIds = new Set(this.visibleEntries.map((entry) => entry.icon.id))

    for (const iconId of [...this.recordsByIconId.keys()]) {
      if (nextIconIds.has(iconId)) {
        continue
      }

      const currentRecord = this.recordsByIconId.get(iconId)
      if (currentRecord?.status === 'loaded') {
        this.markPageDirtyForIcon(iconId)
      }

      this.recordsByIconId.delete(iconId)
      this.releaseSlot(iconId)
    }

    for (const entry of this.visibleEntries) {
      const currentRecord = this.recordsByIconId.get(entry.icon.id)
      const shouldReuseRecord =
        currentRecord &&
        currentRecord.icon.image === entry.icon.image &&
        currentRecord.icon.width === entry.icon.width &&
        currentRecord.icon.height === entry.icon.height

      if (shouldReuseRecord) {
        continue
      }

      if (currentRecord?.status === 'loaded') {
        this.markPageDirtyForIcon(entry.icon.id)
      }

      if (
        currentRecord &&
        (currentRecord.icon.width !== entry.icon.width ||
          currentRecord.icon.height !== entry.icon.height)
      ) {
        this.releaseSlot(entry.icon.id)
      }

      this.ensureSlot(entry.icon)

      this.recordsByIconId.set(entry.icon.id, {
        icon: entry.icon,
        status: 'loaded',
      })
      this.markPageDirtyForIcon(entry.icon.id)
    }
  }

  private ensureSlot(icon: AvatarIconDescriptor) {
    const currentSlot = this.slotsByIconId.get(icon.id)
    if (currentSlot && currentSlot.bucket === icon.width) {
      return currentSlot
    }

    const pageLayouts = this.getOrCreatePageLayouts(icon.width)
    for (const pageLayout of pageLayouts) {
      const reusableSlotIndex = pageLayout.freeSlotIndexes.shift()
      if (reusableSlotIndex !== undefined) {
        const slot = {
          bucket: icon.width,
          pageIndex: pageLayout.pageIndex,
          slotIndex: reusableSlotIndex,
        }
        this.slotsByIconId.set(icon.id, slot)
        return slot
      }

      if (pageLayout.nextSlotIndex < pageLayout.capacity) {
        const slot = {
          bucket: icon.width,
          pageIndex: pageLayout.pageIndex,
          slotIndex: pageLayout.nextSlotIndex,
        }
        pageLayout.nextSlotIndex += 1
        this.slotsByIconId.set(icon.id, slot)
        return slot
      }
    }

    const nextPageLayout = this.createPageLayout(icon.width, pageLayouts.length)
    pageLayouts.push(nextPageLayout)
    const slot = {
      bucket: icon.width,
      pageIndex: nextPageLayout.pageIndex,
      slotIndex: 0,
    }
    nextPageLayout.nextSlotIndex = 1
    this.slotsByIconId.set(icon.id, slot)
    return slot
  }

  private releaseSlot(iconId: string) {
    const slot = this.slotsByIconId.get(iconId)
    if (!slot) {
      return
    }

    const pageLayouts = this.pageLayoutsByBucket.get(slot.bucket)
    const pageLayout = pageLayouts?.[slot.pageIndex]
    if (pageLayout && !pageLayout.freeSlotIndexes.includes(slot.slotIndex)) {
      pageLayout.freeSlotIndexes.push(slot.slotIndex)
      pageLayout.freeSlotIndexes.sort((left, right) => left - right)
    }
    this.slotsByIconId.delete(iconId)
  }

  private getOrCreatePageLayouts(bucket: number) {
    let pageLayouts = this.pageLayoutsByBucket.get(bucket)
    if (!pageLayouts) {
      pageLayouts = [this.createPageLayout(bucket, 0)]
      this.pageLayoutsByBucket.set(bucket, pageLayouts)
    }

    return pageLayouts
  }

  private createPageLayout(bucket: number, pageIndex: number): AvatarAtlasPageLayout {
    const stride = bucket + this.padding
    const columns = Math.max(1, Math.floor((this.maxWidth - this.padding) / stride))
    const rows = Math.max(1, Math.floor((this.maxHeight - this.padding) / stride))

    return {
      bucket,
      pageIndex,
      columns,
      rows,
      capacity: columns * rows,
      nextSlotIndex: 0,
      freeSlotIndexes: [],
    }
  }

  private markPageDirtyForIcon(iconId: string) {
    const slot = this.slotsByIconId.get(iconId)
    if (!slot) {
      return
    }

    this.dirtyPageKeys.add(this.buildPageKey(slot.bucket, slot.pageIndex))
  }

  private scheduleSnapshotFlush() {
    if (this.flushScheduled) {
      return
    }

    this.flushScheduled = true
    this.scheduleFrame(() => {
      this.flushScheduled = false
      const flushResult = this.flushSnapshotChanges()
      if (flushResult.pendingPageCommits > 0) {
        this.scheduleSnapshotFlush()
      }
      if (!flushResult.snapshotChanged) {
        return
      }

      this.snapshotChangeListener?.()
    })
  }

  private flushSnapshotChanges() {
    const dirtyPages = this.dirtyPageKeys.size
    const { pagesChanged, committedPageCount } = this.flushDirtyPages()
    const failedPubkeys = this.buildFailedPubkeys()
    const failedPubkeysChanged = !equalStringLists(
      this.snapshot.delivery.failedPubkeys,
      failedPubkeys,
    )
    const pendingPageCommits = this.resolvePageCommitCount(this.collectDirtyPagePlans())
    const metricsChanged =
      this.snapshot.dirtyPages !== dirtyPages ||
      this.snapshot.pendingPageCommits !== pendingPageCommits ||
      this.snapshot.committedPageCount !== committedPageCount

    if (!pagesChanged && !failedPubkeysChanged && !metricsChanged) {
      return {
        snapshotChanged: false,
        pendingPageCommits,
      }
    }

    this.version += 1
    this.snapshot = {
      version: this.version,
      pages: this.buildSortedPages(),
      delivery: {
        paintedPubkeys: [],
        failedPubkeys,
      },
      dirtyPages,
      pendingPageCommits,
      committedPageCount,
    }

    return {
      snapshotChanged: true,
      pendingPageCommits,
    }
  }

  private flushDirtyPages() {
    if (typeof document === 'undefined') {
      const hadPages = this.pagesByKey.size > 0
      this.pagesByKey.clear()
      this.dirtyPageKeys.clear()
      return {
        pagesChanged: hadPages,
        committedPageCount: hadPages ? 1 : 0,
      }
    }

    if (this.dirtyPageKeys.size === 0) {
      return {
        pagesChanged: false,
        committedPageCount: 0,
      }
    }

    const dirtyPagePlans = this.collectDirtyPagePlans()
    const dirtyPageKeys = dirtyPagePlans
      .slice(0, this.resolvePageCommitCount(dirtyPagePlans))
      .map((plan) => plan.pageKey)
    const entriesByPageKey = new Map(
      dirtyPagePlans.map((plan) => [plan.pageKey, plan.entries]),
    )

    for (const pageKey of dirtyPageKeys) {
      this.dirtyPageKeys.delete(pageKey)
    }

    let pagesChanged = false
    let committedPageCount = 0

    for (const pageKey of dirtyPageKeys) {
      const nextPage = this.buildAtlasPage(pageKey, entriesByPageKey.get(pageKey) ?? [])
      const currentPage = this.pagesByKey.get(pageKey)

      if (!nextPage) {
        if (currentPage) {
          this.pagesByKey.delete(pageKey)
          this.pageSurfacesByKey.delete(pageKey)
          pagesChanged = true
        }
        continue
      }

      this.pagesByKey.set(pageKey, nextPage)
      pagesChanged = true
      committedPageCount += 1
    }

    return {
      pagesChanged,
      committedPageCount,
    }
  }

  private buildFailedPubkeys() {
    return []
  }

  private collectDirtyPagePlans(): AvatarDirtyPagePlan[] {
    if (this.dirtyPageKeys.size === 0) {
      return []
    }

    const dirtyPageKeySet = new Set(this.dirtyPageKeys)
    const entriesByPageKey = new Map<string, AvatarDirtyPageEntry[]>()

    for (const entry of this.visibleEntries) {
      const record = this.recordsByIconId.get(entry.icon.id)
      const slot = this.slotsByIconId.get(entry.icon.id)
      if (record?.status !== 'loaded' || !slot) {
        continue
      }

      const pageKey = this.buildPageKey(slot.bucket, slot.pageIndex)
      if (!dirtyPageKeySet.has(pageKey)) {
        continue
      }

      const pageEntries = entriesByPageKey.get(pageKey) ?? []
      pageEntries.push({
        icon: entry.icon,
        image: record.icon.image,
        slot,
      })
      entriesByPageKey.set(pageKey, pageEntries)
    }

    const shouldBurstCommit = this.shouldBurstCommit(dirtyPageKeySet)

    return [...dirtyPageKeySet]
      .map((pageKey) => ({
        pageKey,
        entries: entriesByPageKey.get(pageKey) ?? [],
        estimatedPixels: this.resolvePageEstimatedPixels(pageKey),
      }))
      .sort((left, right) => {
        if (left.entries.length !== right.entries.length) {
          // Paint the pages that unblock the most visible avatars first.
          return right.entries.length - left.entries.length
        }

        if (shouldBurstCommit && left.estimatedPixels !== right.estimatedPixels) {
          return left.estimatedPixels - right.estimatedPixels
        }

        return left.pageKey.localeCompare(right.pageKey)
      })
  }

  private resolvePageCommitCount(dirtyPagePlans: readonly AvatarDirtyPagePlan[]) {
    const steadyCommitCount = Math.min(
      this.maxPageCommitsPerFrame,
      dirtyPagePlans.length,
    )
    if (
      dirtyPagePlans.length <= steadyCommitCount ||
      this.burstCommitPixelBudget <= 0 ||
      steadyCommitCount === 0 ||
      !this.shouldBurstCommit(new Set(dirtyPagePlans.map((plan) => plan.pageKey)))
    ) {
      return steadyCommitCount
    }

    let burstCommitCount = steadyCommitCount
    // Initial paint can safely spend a little more canvas work to avoid a long
    // runtime-ready -> on-screen gap, but we still cap the burst by texel budget.
    let remainingPixelBudget = this.burstCommitPixelBudget

    for (
      let index = steadyCommitCount;
      index < dirtyPagePlans.length &&
      burstCommitCount < this.maxBurstPageCommitsPerFrame;
      index += 1
    ) {
      const nextPlan = dirtyPagePlans[index]
      if (nextPlan.estimatedPixels > remainingPixelBudget) {
        break
      }

      remainingPixelBudget -= nextPlan.estimatedPixels
      burstCommitCount += 1
    }

    return burstCommitCount
  }

  private shouldBurstCommit(dirtyPageKeySet: ReadonlySet<string>) {
    if (dirtyPageKeySet.size === 0) {
      return false
    }

    const visiblePageKeys = new Set<string>()
    for (const entry of this.visibleEntries) {
      const slot = this.slotsByIconId.get(entry.icon.id)
      if (!slot) {
        continue
      }

      visiblePageKeys.add(this.buildPageKey(slot.bucket, slot.pageIndex))
    }

    if (visiblePageKeys.size === 0) {
      return false
    }

    const cleanVisibleCommittedPageCount = [...visiblePageKeys].filter(
      (pageKey) => !dirtyPageKeySet.has(pageKey) && this.pagesByKey.has(pageKey),
    ).length

    return cleanVisibleCommittedPageCount === 0
  }

  private resolvePageEstimatedPixels(pageKey: string) {
    const slot = this.parsePageKey(pageKey)
    if (!slot) {
      return this.maxWidth * this.maxHeight
    }

    const pageLayout = this.pageLayoutsByBucket.get(slot.bucket)?.[slot.pageIndex]
    if (!pageLayout) {
      return this.maxWidth * this.maxHeight
    }

    const stride = pageLayout.bucket + this.padding
    const width = Math.min(
      this.maxWidth,
      this.padding + pageLayout.columns * stride,
    )
    const height = Math.min(
      this.maxHeight,
      this.padding + pageLayout.rows * stride,
    )

    return nextPowerOfTwo(width) * nextPowerOfTwo(height)
  }

  private buildSortedPages() {
    return [...this.pagesByKey.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    )
  }

  private buildAtlasPage(
    pageKey: string,
    entries: Array<{
      icon: AvatarIconDescriptor
      image: CanvasImageSource
      slot: AvatarAtlasSlot
    }>,
  ) {
    const bucket = entries[0]?.slot.bucket
    const pageIndex = entries[0]?.slot.pageIndex
    if (bucket === undefined || pageIndex === undefined) {
      return null
    }

    const pageLayout = this.pageLayoutsByBucket.get(bucket)?.[pageIndex]
    if (!pageLayout) {
      return null
    }

    const surface = this.getOrCreatePageSurface(pageKey)
    if (!surface) {
      return null
    }

    const stride = bucket + this.padding
    const width = Math.min(
      this.maxWidth,
      this.padding + pageLayout.columns * stride,
    )
    const height = Math.min(
      this.maxHeight,
      this.padding + pageLayout.rows * stride,
    )
    const atlasWidth = nextPowerOfTwo(width)
    const atlasHeight = nextPowerOfTwo(height)

    if (surface.frontCanvas.width !== atlasWidth) {
      surface.frontCanvas.width = atlasWidth
      surface.backCanvas.width = atlasWidth
    }
    if (surface.frontCanvas.height !== atlasHeight) {
      surface.frontCanvas.height = atlasHeight
      surface.backCanvas.height = atlasHeight
    }
    surface.backContext2d.clearRect(
      0,
      0,
      surface.backCanvas.width,
      surface.backCanvas.height,
    )

    const iconMapping: Record<string, AvatarIconMapping> = {}
    const iconIds: string[] = []

    for (const entry of entries.sort((left, right) =>
      left.icon.id.localeCompare(right.icon.id),
    )) {
      const column = entry.slot.slotIndex % pageLayout.columns
      const row = Math.floor(entry.slot.slotIndex / pageLayout.columns)
      const x = this.padding + column * stride
      const y = this.padding + row * stride

      iconMapping[entry.icon.id] = {
        x,
        y,
        width: entry.icon.width,
        height: entry.icon.height,
        mask: false,
      }
      iconIds.push(entry.icon.id)
      surface.backContext2d.save()
      surface.backContext2d.beginPath()
      surface.backContext2d.arc(
        x + entry.icon.width / 2,
        y + entry.icon.height / 2,
        Math.min(entry.icon.width, entry.icon.height) / 2,
        0,
        Math.PI * 2,
      )
      surface.backContext2d.closePath()
      surface.backContext2d.clip()
      surface.backContext2d.drawImage(
        entry.image,
        x,
        y,
        entry.icon.width,
        entry.icon.height,
      )
      surface.backContext2d.restore()
    }

    ;[surface.frontCanvas, surface.backCanvas] = [
      surface.backCanvas,
      surface.frontCanvas,
    ]
    ;[surface.frontContext2d, surface.backContext2d] = [
      surface.backContext2d,
      surface.frontContext2d,
    ]
    surface.revision += 1

    return {
      key: pageKey,
      iconAtlas: surface.frontCanvas,
      iconMapping,
      iconIds,
      revision: surface.revision,
    }
  }

  private getOrCreatePageSurface(pageKey: string) {
    const existingSurface = this.pageSurfacesByKey.get(pageKey)
    if (existingSurface) {
      return existingSurface
    }

    const frontCanvas = document.createElement('canvas')
    const frontContext2d = frontCanvas.getContext('2d')
    const backCanvas = document.createElement('canvas')
    const backContext2d = backCanvas.getContext('2d')
    if (!frontContext2d || !backContext2d) {
      return null
    }

    const nextSurface = {
      frontCanvas,
      frontContext2d,
      backCanvas,
      backContext2d,
      revision: 0,
    }
    this.pageSurfacesByKey.set(pageKey, nextSurface)
    return nextSurface
  }

  private buildPageKey(bucket: number, pageIndex: number) {
    return `bucket-${bucket}-page-${pageIndex}`
  }

  private parsePageKey(pageKey: string) {
    const match = /^bucket-(\d+)-page-(\d+)$/.exec(pageKey)
    if (!match) {
      return null
    }

    return {
      bucket: Number(match[1]),
      pageIndex: Number(match[2]),
    }
  }
}
