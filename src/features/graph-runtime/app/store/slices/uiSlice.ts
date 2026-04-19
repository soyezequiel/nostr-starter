import type {
  AppStateCreator,
  DevicePerformanceProfile,
  ImageQualityMode,
  SavedRootEntry,
  SavedRootProfileSnapshot,
  UiSlice,
} from '@/features/graph-runtime/app/store/types'
import {
  DEFAULT_DEVICE_PERFORMANCE_PROFILE,
  DEFAULT_EFFECTIVE_GRAPH_CAPS,
  DEFAULT_EFFECTIVE_IMAGE_BUDGET,
  clampImageQualityModeForProfile,
  getDefaultImageQualityModeForProfile,
} from '@/features/graph-runtime/devicePerformance'
import {
  DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
  DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
  normalizeAvatarZoomThresholds,
} from '@/features/graph-runtime/avatarQualityGuide'

const DEFAULT_SAVED_ROOTS = [
  {
    npub: 'npub103zae7ewjdv5eepmc2ckl55m8sut5rd0g2hg2c07dup48zft0h6qlaaz9u',
    pubkey: '7c45dcfb2e93594ce43bc2b16fd29b3c38ba0daf42ae8561fe6f0353892b7df4',
  },
  {
    npub: 'npub1rujdpkd8mwezrvpqd2rx2zphfaztqrtsfg6w3vdnljdghs2q8qrqtt9u68',
    pubkey: '1f24d0d9a7dbb221b0206a866508374f44b00d704a34e8b1b3fc9a8bc1403806',
  },
] as const

const MAX_USER_SAVED_ROOTS = 12
const MAX_SAVED_ROOTS = MAX_USER_SAVED_ROOTS + DEFAULT_SAVED_ROOTS.length
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

export const createDefaultSavedRootEntries = (
  timestamp = Date.now(),
): SavedRootEntry[] =>
  DEFAULT_SAVED_ROOTS.map((root, index) => ({
    pubkey: root.pubkey,
    npub: root.npub,
    addedAt: timestamp - index,
    lastOpenedAt: timestamp - index,
    relayHints: [],
    profile: null,
    profileFetchedAt: null,
  }))

export const seedDefaultSavedRoots = (
  savedRoots: readonly SavedRootEntry[] = [],
  timestamp = Date.now(),
): SavedRootEntry[] => {
  const existingPubkeys = new Set(savedRoots.map((savedRoot) => savedRoot.pubkey))
  const missingDefaultRoots = createDefaultSavedRootEntries(timestamp).filter(
    (savedRoot) => !existingPubkeys.has(savedRoot.pubkey),
  )

  if (missingDefaultRoots.length === 0) {
    return sortSavedRoots([...savedRoots]).slice(0, MAX_SAVED_ROOTS)
  }

  return sortSavedRoots([...missingDefaultRoots, ...savedRoots]).slice(0, MAX_SAVED_ROOTS)
}

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
  | 'pinnedNodePubkeys'
  | 'physicsReheatRevision'
> => ({
  selectedNodePubkey: null,
  comparedNodePubkeys: new Set<string>(),
  activeLayer: 'graph',
  connectionsSourceLayer: 'mutuals',
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
    edgeOpacity: 1,
    arrowType: 'triangle',
    nodeSpacingFactor: 1.25,
    nodeSizeFactor: 0.88,
    autoSizeNodes: false,
    imageQualityMode: 'adaptive',
    physicsEnabled: true,
    physicsAutoFreeze: true,
    avatarHdZoomThreshold: DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
    avatarFullHdZoomThreshold: DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
    showDiscoveryState: true,
    showSharedEmphasis: true,
    showAvatarQualityGuide: false,
    showImageResidencyDebug: false,
    edgeColor: '#94a3b8',
    mutualEdgeColor: '#2dd4bf',
    colorProfile: 'monochrome',
  },
  devicePerformanceProfile: DEFAULT_DEVICE_PERFORMANCE_PROFILE,
  effectiveGraphCaps: DEFAULT_EFFECTIVE_GRAPH_CAPS,
  effectiveImageBudget: DEFAULT_EFFECTIVE_IMAGE_BUDGET,
  savedRoots: createDefaultSavedRootEntries(),
  savedRootsHydrated: typeof window === 'undefined',
  pinnedNodePubkeys: new Set<string>(),
  physicsReheatRevision: 0,
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
  pinNode: (pubkey) => {
    if (!pubkey) {
      return
    }

    set((state) => {
      if (state.pinnedNodePubkeys.has(pubkey)) {
        return state
      }

      const nextPinned = new Set(state.pinnedNodePubkeys)
      nextPinned.add(pubkey)
      return { pinnedNodePubkeys: nextPinned }
    })
  },
  unpinNode: (pubkey) => {
    if (!pubkey) {
      return
    }

    set((state) => {
      if (!state.pinnedNodePubkeys.has(pubkey)) {
        return state
      }

      const nextPinned = new Set(state.pinnedNodePubkeys)
      nextPinned.delete(pubkey)
      return { pinnedNodePubkeys: nextPinned }
    })
  },
  togglePinnedNode: (pubkey) => {
    if (!pubkey) {
      return
    }

    set((state) => {
      const nextPinned = new Set(state.pinnedNodePubkeys)
      if (nextPinned.has(pubkey)) {
        nextPinned.delete(pubkey)
      } else {
        nextPinned.add(pubkey)
      }
      return { pinnedNodePubkeys: nextPinned }
    })
  },
  clearPinnedNodes: () => {
    set((state) =>
      state.pinnedNodePubkeys.size === 0
        ? state
        : { pinnedNodePubkeys: new Set<string>() },
    )
  },
  prunePinnedNodePubkeys: (availablePubkeys) => {
    set((state) => {
      if (state.pinnedNodePubkeys.size === 0) {
        return state
      }

      const nextPinned = new Set(
        Array.from(state.pinnedNodePubkeys).filter((pubkey) =>
          availablePubkeys.has(pubkey),
        ),
      )

      if (nextPinned.size === state.pinnedNodePubkeys.size) {
        return state
      }

      return { pinnedNodePubkeys: nextPinned }
    })
  },
  requestPhysicsReheat: () => {
    set((state) => ({
      physicsReheatRevision: state.physicsReheatRevision + 1,
    }))
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
