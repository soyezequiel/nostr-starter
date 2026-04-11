import type {
  AppStateCreator,
  DevicePerformanceProfile,
  ImageQualityMode,
  SavedRootEntry,
  SavedRootProfileSnapshot,
  UiSlice,
} from '@/features/graph/app/store/types'
import {
  DEFAULT_DEVICE_PERFORMANCE_PROFILE,
  DEFAULT_EFFECTIVE_GRAPH_CAPS,
  DEFAULT_EFFECTIVE_IMAGE_BUDGET,
  clampImageQualityModeForProfile,
  getDefaultImageQualityModeForProfile,
} from '@/features/graph/devicePerformance'
import {
  DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
  DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
  normalizeAvatarZoomThresholds,
} from '@/features/graph/render/avatarQualityGuide'

const MAX_SAVED_ROOTS = 12
const sortRelayHints = (relayHints: readonly string[] | undefined) =>
  relayHints ? Array.from(new Set(relayHints.filter(Boolean))).sort() : []

const sortSavedRoots = (savedRoots: SavedRootEntry[]) =>
  savedRoots
    .slice()
    .sort((left, right) => {
      if (left.lastOpenedAt !== right.lastOpenedAt) {
        return right.lastOpenedAt - left.lastOpenedAt
      }

      if (left.addedAt !== right.addedAt) {
        return right.addedAt - left.addedAt
      }

      return left.npub.localeCompare(right.npub)
    })

const mergeSavedRootProfile = (
  existingProfile: SavedRootProfileSnapshot | null,
  incomingProfile: SavedRootProfileSnapshot | null | undefined,
): SavedRootProfileSnapshot | null => {
  if (incomingProfile === undefined || incomingProfile === null) {
    return existingProfile ?? null
  }

  const mergedProfile = {
    displayName: incomingProfile.displayName ?? existingProfile?.displayName ?? null,
    name: incomingProfile.name ?? existingProfile?.name ?? null,
    picture: incomingProfile.picture ?? existingProfile?.picture ?? null,
    about: incomingProfile.about ?? existingProfile?.about ?? null,
    nip05: incomingProfile.nip05 ?? existingProfile?.nip05 ?? null,
    lud16: incomingProfile.lud16 ?? existingProfile?.lud16 ?? null,
  }

  if (Object.values(mergedProfile).every((value) => value === null)) {
    return null
  }

  return mergedProfile
}

const normalizeRenderConfig = (
  profile: DevicePerformanceProfile,
  currentRenderConfig: UiSlice['renderConfig'],
  configPatch: Partial<UiSlice['renderConfig']>,
  fallbackImageQualityMode?: ImageQualityMode,
) => {
  const nextRenderConfig = {
    ...currentRenderConfig,
    ...configPatch,
  }
  const normalizedZoomThresholds = normalizeAvatarZoomThresholds(nextRenderConfig)
  const requestedImageQualityMode =
    configPatch.imageQualityMode ?? nextRenderConfig.imageQualityMode

  return {
    ...nextRenderConfig,
    ...normalizedZoomThresholds,
    imageQualityMode: clampImageQualityModeForProfile(
      profile,
      requestedImageQualityMode,
      fallbackImageQualityMode,
    ),
  }
}

export const createInitialUiSliceState = (): Pick<
  UiSlice,
  | 'selectedNodePubkey'
  | 'comparedNodePubkeys'
  | 'activeLayer'
  | 'connectionsSourceLayer'
  | 'openPanel'
  | 'currentKeyword'
  | 'rootLoad'
  | 'renderConfig'
  | 'devicePerformanceProfile'
  | 'effectiveGraphCaps'
  | 'effectiveImageBudget'
  | 'savedRoots'
  | 'savedRootsHydrated'
  | 'interactionState'
> => ({
  selectedNodePubkey: null,
  comparedNodePubkeys: new Set<string>(),
  activeLayer: 'graph',
  connectionsSourceLayer: 'graph',
  openPanel: 'overview',
  currentKeyword: '',
  rootLoad: {
    status: 'idle',
    message: null,
    loadedFrom: 'none',
    visibleLinkProgress: null,
  },
  renderConfig: {
    edgeThickness: 1,
    arrowType: 'none',
    nodeSpacingFactor: 1,
    nodeSizeFactor: 1,
    autoSizeNodes: false,
    imageQualityMode: 'adaptive',
    avatarHdZoomThreshold: DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
    avatarFullHdZoomThreshold: DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
    showDiscoveryState: true,
    showSharedEmphasis: false,
    showAvatarQualityGuide: false,
    showImageResidencyDebug: false,
  },
  devicePerformanceProfile: DEFAULT_DEVICE_PERFORMANCE_PROFILE,
  effectiveGraphCaps: DEFAULT_EFFECTIVE_GRAPH_CAPS,
  effectiveImageBudget: DEFAULT_EFFECTIVE_IMAGE_BUDGET,
  savedRoots: [],
  savedRootsHydrated: typeof window === 'undefined',
  interactionState: {
    isViewportActive: false,
    lastViewportInteractionAt: null,
    lastViewportSettledAt: null,
  },
})

export const createUiSlice: AppStateCreator<UiSlice> = (set) => ({
  ...createInitialUiSliceState(),
  setSelectedNodePubkey: (pubkey) => {
    set({ selectedNodePubkey: pubkey })
  },
  setComparedNodePubkeys: (pubkeys) => {
    set({ comparedNodePubkeys: pubkeys })
  },
  clearComparedNodes: () => {
    set({ comparedNodePubkeys: new Set<string>() })
  },
  setActiveLayer: (layer) => {
    set({ activeLayer: layer })
  },
  setConnectionsSourceLayer: (layer) => {
    set({ connectionsSourceLayer: layer })
  },
  setOpenPanel: (panel) => {
    set({ openPanel: panel })
  },
  setCurrentKeyword: (keyword) => {
    set({ currentKeyword: keyword })
  },
  setRootLoadState: (rootLoadPatch) => {
    set((state) => ({
      rootLoad: {
        ...state.rootLoad,
        ...rootLoadPatch,
      },
    }))
  },
  resetRootLoadState: () => {
    set({
      rootLoad: createInitialUiSliceState().rootLoad,
    })
  },
  setRenderConfig: (configPatch) => {
    set((state) => ({
      renderConfig: normalizeRenderConfig(
        state.devicePerformanceProfile,
        state.renderConfig,
        configPatch,
      ),
    }))
  },
  applyDevicePerformanceProfile: ({
    profile,
    graphCaps,
    imageBudget,
    defaultImageQualityMode,
  }) => {
    set((state) => {
      const nextMaxNodes = Math.max(1, Math.round(graphCaps.maxNodes))

      return {
        devicePerformanceProfile: profile,
        effectiveGraphCaps: graphCaps,
        effectiveImageBudget: imageBudget,
        renderConfig: normalizeRenderConfig(
          profile,
          state.renderConfig,
          { imageQualityMode: defaultImageQualityMode },
          getDefaultImageQualityModeForProfile(profile),
        ),
        graphCaps: {
          ...state.graphCaps,
          maxNodes: nextMaxNodes,
          capReached: Object.keys(state.nodes).length >= nextMaxNodes,
        },
      }
    })
  },
  markViewportInteraction: (at = Date.now()) => {
    set((state) => ({
      interactionState:
        state.interactionState.isViewportActive &&
        state.interactionState.lastViewportInteractionAt === at
          ? state.interactionState
          : {
              ...state.interactionState,
              isViewportActive: true,
              lastViewportInteractionAt: at,
            },
    }))
  },
  markViewportSettled: (at = Date.now()) => {
    set((state) => ({
      interactionState:
        !state.interactionState.isViewportActive &&
        state.interactionState.lastViewportSettledAt === at
          ? state.interactionState
          : {
              ...state.interactionState,
              isViewportActive: false,
              lastViewportSettledAt: at,
            },
    }))
  },
  upsertSavedRoot: (entry) => {
    set((state) => {
      const existingEntry = state.savedRoots.find(
        (savedRoot) => savedRoot.pubkey === entry.pubkey,
      )
      const openedAt = entry.openedAt ?? Date.now()
      const nextSavedRoot: SavedRootEntry = {
        pubkey: entry.pubkey,
        npub: entry.npub,
        addedAt: existingEntry?.addedAt ?? openedAt,
        lastOpenedAt: openedAt,
        relayHints:
          entry.relayHints !== undefined
            ? sortRelayHints(entry.relayHints)
            : sortRelayHints(existingEntry?.relayHints),
        profile: mergeSavedRootProfile(existingEntry?.profile ?? null, entry.profile),
        profileFetchedAt:
          entry.profileFetchedAt ?? existingEntry?.profileFetchedAt ?? null,
      }

      return {
        savedRoots: sortSavedRoots([
          nextSavedRoot,
          ...state.savedRoots.filter(
            (savedRoot) => savedRoot.pubkey !== entry.pubkey,
          ),
        ]).slice(0, MAX_SAVED_ROOTS),
      }
    })
  },
  removeSavedRoot: (pubkey) => {
    set((state) => ({
      savedRoots: state.savedRoots.filter((savedRoot) => savedRoot.pubkey !== pubkey),
    }))
  },
  setSavedRootProfile: (pubkey, profile, fetchedAt) => {
    set((state) => ({
      savedRoots: state.savedRoots.map((savedRoot) =>
        savedRoot.pubkey === pubkey
          ? {
            ...savedRoot,
            profile: mergeSavedRootProfile(savedRoot.profile, profile),
            profileFetchedAt: fetchedAt ?? savedRoot.profileFetchedAt,
          }
          : savedRoot,
      ),
    }))
  },
  setSavedRootsHydrated: (hydrated) => {
    set({ savedRootsHydrated: hydrated })
  },
})
