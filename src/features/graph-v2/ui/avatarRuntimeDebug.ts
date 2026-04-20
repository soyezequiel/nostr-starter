import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'

export interface AvatarRuntimeDebugBrowserSnapshot {
  userAgent: string
  language?: string
  devicePixelRatio: number
  viewport: {
    width: number
    height: number
  }
}

export interface AvatarRuntimeDebugLocationSnapshot {
  pathname: string
  search: string
}

export interface AvatarRuntimeDebugPayloadInput {
  generatedAt: string
  debugFileName: string
  state: AvatarRuntimeStateDebugSnapshot
  browser?: AvatarRuntimeDebugBrowserSnapshot
  location?: AvatarRuntimeDebugLocationSnapshot
}

export const isAvatarRuntimeDebugDownloadEnabled = (
  nodeEnv = readNodeEnv(),
) => nodeEnv === 'development'

export const buildAvatarRuntimeDebugFilename = (stamp: string) =>
  `sigma-avatar-runtime-${stamp}.debug.json`

export const buildAvatarRuntimeDebugPayload = ({
  generatedAt,
  debugFileName,
  state,
  browser,
  location,
}: AvatarRuntimeDebugPayloadInput) => {
  const overlay = state.overlay
  const cache = state.cache
  const scheduler = state.scheduler
  const loader = state.loader
  const failedReasons = Object.fromEntries(
    Object.entries(
      (cache?.entries ?? []).reduce<Record<string, number>>((acc, entry) => {
        if (entry.state !== 'failed') {
          return acc
        }
        const key = entry.reason ?? 'cache_failed'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )
  const blockedReasons = Object.fromEntries(
    Object.entries(
      (loader?.blocked ?? []).reduce<Record<string, number>>((acc, entry) => {
        const key = entry.reason ?? 'blocked'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )

  return {
    schemaVersion: 1,
    type: 'sigma-avatar-runtime-debug',
    generatedAt,
    environment: {
      nodeEnv: readNodeEnv() ?? null,
      devOnly: true,
    },
    surface: {
      route: '/labs/sigma',
      debugFileName,
      location: location ?? null,
      rootPubkey: state.rootPubkey,
      selectedNodePubkey: state.selectedNodePubkey,
      viewport: state.viewport,
      camera: state.camera,
      physicsRunning: state.physicsRunning,
      motionActive: state.motionActive,
      hideAvatarsOnMove: state.hideAvatarsOnMove,
    },
    browser: browser ?? null,
    counts: {
      visibleNodes: overlay?.counts.visibleNodes ?? null,
      nodesWithPictureUrl: overlay?.counts.nodesWithPictureUrl ?? null,
      nodesWithSafePictureUrl: overlay?.counts.nodesWithSafePictureUrl ?? null,
      selectedForImage: overlay?.counts.selectedForImage ?? null,
      loadCandidates: overlay?.counts.loadCandidates ?? null,
      drawnImages: overlay?.counts.drawnImages ?? null,
      monogramDraws: overlay?.counts.monogramDraws ?? null,
      withPictureMonogramDraws: overlay?.counts.withPictureMonogramDraws ?? null,
      cacheReady: cache?.byState.ready ?? null,
      cacheLoading: cache?.byState.loading ?? null,
      cacheFailed: cache?.byState.failed ?? null,
      loaderBlocked: loader?.blockedCount ?? null,
      inflight: scheduler?.inflightCount ?? null,
    },
    reasons: {
      disableImage: sortCountMap(overlay?.byDisableReason),
      loadSkip: sortCountMap(overlay?.byLoadSkipReason),
      drawFallback: sortCountMap(overlay?.byDrawFallbackReason),
      cacheState: sortCountMap(overlay?.byCacheState),
      cacheFailures: failedReasons,
      blockedReasons,
    },
    runtime: {
      options: state.runtimeOptions,
      perfBudget: state.perfBudget,
      cache: cache ?? null,
      loader: loader ?? null,
      scheduler: scheduler ?? null,
      overlay: overlay ?? null,
    },
  }
}

export const readAvatarRuntimeDebugBrowserSnapshot =
  (): AvatarRuntimeDebugBrowserSnapshot | undefined => {
    if (typeof window === 'undefined') return undefined
    return {
      userAgent: window.navigator.userAgent,
      language: window.navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }
  }

export const readAvatarRuntimeDebugLocationSnapshot =
  (): AvatarRuntimeDebugLocationSnapshot | undefined => {
    if (typeof window === 'undefined') return undefined
    return {
      pathname: window.location.pathname,
      search: window.location.search,
    }
  }

const readNodeEnv = () => {
  if (typeof process === 'undefined') return undefined
  return process.env.NODE_ENV
}

const sortCountMap = (values: Record<string, number> | undefined) =>
  Object.fromEntries(
    Object.entries(values ?? {}).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  )
