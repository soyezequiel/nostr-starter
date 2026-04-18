import {
  DEFAULT_BUDGETS,
  type AvatarBudget,
  type DeviceTier,
} from '@/features/graph-v2/renderer/avatar/types'
import type { ImageLodBucket } from '@/features/graph/render/avatar'

const EMA_ALPHA = 0.1
const DOWNGRADE_MS = 40
const UPGRADE_MS = 18
const DOWNGRADE_WINDOW_MS = 2000
const UPGRADE_WINDOW_MS = 5000

const TIER_ORDER: DeviceTier[] = ['low', 'mid', 'high']

const bucketForTier: Record<DeviceTier, ImageLodBucket> = {
  low: 64,
  mid: 128,
  high: 256,
}

export interface PerfBudgetSnapshot {
  baseTier: DeviceTier
  tier: DeviceTier
  isDegraded: boolean
  emaFrameMs: number
  budget: AvatarBudget
}

export class PerfBudget {
  private readonly baseTier: DeviceTier
  private currentTier: DeviceTier
  private emaFrameMs = 16
  private overBudgetSinceMs: number | null = null
  private underBudgetSinceMs: number | null = null
  private overrides: Partial<AvatarBudget> = {}
  private readonly now: () => number

  constructor(tier: DeviceTier, nowImpl: () => number = () => performance.now()) {
    this.baseTier = tier
    this.currentTier = tier
    this.now = nowImpl
  }

  public recordFrame(deltaMs: number) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return
    }
    const clamped = Math.min(200, deltaMs)
    this.emaFrameMs = this.emaFrameMs * (1 - EMA_ALPHA) + clamped * EMA_ALPHA
    const nowMs = this.now()

    if (this.emaFrameMs >= DOWNGRADE_MS) {
      this.overBudgetSinceMs ??= nowMs
      this.underBudgetSinceMs = null
      if (nowMs - this.overBudgetSinceMs >= DOWNGRADE_WINDOW_MS) {
        this.downgrade()
        this.overBudgetSinceMs = nowMs
      }
    } else if (this.emaFrameMs <= UPGRADE_MS) {
      this.underBudgetSinceMs ??= nowMs
      this.overBudgetSinceMs = null
      if (nowMs - this.underBudgetSinceMs >= UPGRADE_WINDOW_MS) {
        this.upgrade()
        this.underBudgetSinceMs = nowMs
      }
    } else {
      this.overBudgetSinceMs = null
      this.underBudgetSinceMs = null
    }
  }

  public getBudget(): AvatarBudget {
    const base = DEFAULT_BUDGETS[this.currentTier]
    return { ...base, ...this.overrides }
  }

  public snapshot(): PerfBudgetSnapshot {
    return {
      baseTier: this.baseTier,
      tier: this.currentTier,
      isDegraded:
        TIER_ORDER.indexOf(this.currentTier) < TIER_ORDER.indexOf(this.baseTier),
      emaFrameMs: this.emaFrameMs,
      budget: this.getBudget(),
    }
  }

  public disable() {
    this.overrides = { ...this.overrides, drawAvatars: false }
  }

  public enable() {
    const next = { ...this.overrides }
    delete next.drawAvatars
    this.overrides = next
  }

  private downgrade() {
    const idx = TIER_ORDER.indexOf(this.currentTier)
    if (idx > 0) {
      this.currentTier = TIER_ORDER[idx - 1]
      return
    }
    const current = this.getBudget()
    this.overrides = {
      ...this.overrides,
      sizeThreshold: Math.min(current.sizeThreshold + 6, 32),
      concurrency: Math.max(1, current.concurrency - 1),
      maxBucket: Math.min(current.maxBucket, 32) as ImageLodBucket,
      lruCap: Math.max(64, Math.floor(current.lruCap / 2)),
      maxAvatarDrawsPerFrame: Math.max(
        32,
        Math.floor(current.maxAvatarDrawsPerFrame * 0.65),
      ),
      maxImageDrawsPerFrame: Math.max(
        12,
        Math.floor(current.maxImageDrawsPerFrame * 0.5),
      ),
    }
  }

  private upgrade() {
    if (Object.keys(this.overrides).length > 0) {
      this.overrides = {}
      return
    }
    const baseIdx = TIER_ORDER.indexOf(this.baseTier)
    const idx = TIER_ORDER.indexOf(this.currentTier)
    if (idx < baseIdx) {
      this.currentTier = TIER_ORDER[idx + 1]
      return
    }
    const current = this.getBudget()
    if (current.maxBucket < bucketForTier[this.baseTier]) {
      this.overrides = { ...this.overrides, maxBucket: bucketForTier[this.baseTier] }
    }
  }
}
