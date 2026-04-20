import { useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import { createAnalysisSlice } from '@/features/graph-runtime/app/store/slices/analysisSlice'
import { createExportSlice } from '@/features/graph-runtime/app/store/slices/exportSlice'
import { createGraphSlice } from '@/features/graph-runtime/app/store/slices/graphSlice'
import { createKeywordSlice } from '@/features/graph-runtime/app/store/slices/keywordSlice'
import { createPathfindingSlice } from '@/features/graph-runtime/app/store/slices/pathfindingSlice'
import { createRelaySlice } from '@/features/graph-runtime/app/store/slices/relaySlice'
import {
  createUiSlice,
  seedDefaultSavedRoots,
} from '@/features/graph-runtime/app/store/slices/uiSlice'
import { createZapSlice } from '@/features/graph-runtime/app/store/slices/zapSlice'
import type {
  AppStore,
  AppStoreApi,
  SavedRootEntry,
} from '@/features/graph-runtime/app/store/types'

const SAVED_ROOTS_PERSIST_VERSION = 1

interface PersistedSavedRootsState {
  savedRoots?: SavedRootEntry[]
}

const getPersistedSavedRoots = (
  persistedState: unknown,
): SavedRootEntry[] => {
  if (
    typeof persistedState === 'object' &&
    persistedState !== null &&
    Array.isArray((persistedState as PersistedSavedRootsState).savedRoots)
  ) {
    return (persistedState as PersistedSavedRootsState).savedRoots ?? []
  }

  return []
}

export const createAppStore = (): AppStoreApi =>
  createStore<AppStore>()(
    subscribeWithSelector(
      persist(
        (...args) => ({
          ...createGraphSlice(...args),
          ...createAnalysisSlice(...args),
          ...createZapSlice(...args),
          ...createKeywordSlice(...args),
          ...createRelaySlice(...args),
          ...createUiSlice(...args),
          ...createExportSlice(...args),
          ...createPathfindingSlice(...args),
        }),
        {
          name: 'nostr-graph-saved-roots',
          version: SAVED_ROOTS_PERSIST_VERSION,
          storage: createJSONStorage(() => localStorage),
          partialize: (state): { savedRoots: SavedRootEntry[] } => ({
            savedRoots: state.savedRoots,
          }),
          migrate: (persistedState, version): PersistedSavedRootsState => {
            const savedRoots = getPersistedSavedRoots(persistedState)

            if (version < SAVED_ROOTS_PERSIST_VERSION) {
              return {
                savedRoots: seedDefaultSavedRoots(savedRoots),
              }
            }

            return { savedRoots }
          },
          onRehydrateStorage: () => (state) => {
            state?.setSavedRootsHydrated(true)
          },
        },
      ),
    ),
  )

export const appStore = createAppStore()

export const useAppStore = <T>(selector: (state: AppStore) => T) =>
  useStore(appStore, selector)
