import type {
  AppStateCreator,
  RelayHealth,
  RelayHealthStatus,
  RelaySlice,
} from '@/features/graph/app/store/types'

const createRelayHealth = (
  status: RelayHealthStatus = 'unknown',
): RelayHealth => ({
  status,
  lastCheckedAt: null,
  lastNotice: null,
})

export const createInitialRelaySliceState = (): Pick<
  RelaySlice,
  'relayUrls' | 'relayHealth' | 'relayOverrideStatus' | 'isGraphStale'
> => ({
  relayUrls: [],
  relayHealth: {},
  relayOverrideStatus: 'idle',
  isGraphStale: false,
})

export const createRelaySlice: AppStateCreator<RelaySlice> = (set, get) => ({
  ...createInitialRelaySliceState(),
  setRelayUrls: (relayUrls) => {
    const uniqueRelayUrls = Array.from(new Set(relayUrls))
    const currentHealth = get().relayHealth
    const relayHealth = Object.fromEntries(
      uniqueRelayUrls.map((relayUrl) => [
        relayUrl,
        currentHealth[relayUrl] ?? createRelayHealth(),
      ]),
    )

    set({
      relayUrls: uniqueRelayUrls,
      relayHealth,
    })
  },
  resetRelayHealth: (relayUrls) => {
    const targetRelayUrls = relayUrls ?? get().relayUrls
    set({
      relayHealth: Object.fromEntries(
        targetRelayUrls.map((relayUrl) => [relayUrl, createRelayHealth()]),
      ),
    })
  },
  setRelayOverrideStatus: (status) => {
    set({ relayOverrideStatus: status })
  },
  updateRelayHealth: (relayUrl, healthPatch) => {
    const currentHealth = get().relayHealth[relayUrl] ?? createRelayHealth()

    set((state) => ({
      relayHealth: {
        ...state.relayHealth,
        [relayUrl]: {
          ...currentHealth,
          ...healthPatch,
        },
      },
    }))
  },
  markGraphStale: (isStale) => {
    set({ isGraphStale: isStale })
  },
})
