import { useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import { createAnalysisSlice } from '@/features/graph-runtime/app/store/slices/analysisSlice'
import {
  createEventToggleSlice,
  sanitizeEventFeedMode,
  sanitizeEventToggles,
} from '@/features/graph-runtime/app/store/slices/eventToggleSlice'
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
import type {
  GraphEventFeedMode,
  GraphEventToggleState,
} from '@/features/graph-v2/events/types'

const PERSIST_VERSION = 2

interface PersistedAppState {
  savedRoots?: SavedRootEntry[]
  eventToggles?: Partial<GraphEventToggleState>
  eventFeedMode?: GraphEventFeedMode
  pauseLiveEventsWhenSceneIsLarge?: boolean
}

const getPersistedSavedRoots = (
  persistedState: unknown,
): SavedRootEntry[] => {
  if (
    typeof persistedState === 'object' &&
    persistedState !== null &&
    Array.isArray((persistedState as PersistedAppState).savedRoots)
  ) {
    return (persistedState as PersistedAppState).savedRoots ?? []
  }

  return []
}

const getPersistedRecord = <T extends keyof PersistedAppState>(
  persistedState: unknown,
  key: T,
): PersistedAppState[T] | undefined => {
  if (typeof persistedState === 'object' && persistedState !== null) {
    return (persistedState as PersistedAppState)[key]
  }
  return undefined
}

export const createAppStore = (): AppStoreApi =>
  createStore<AppStore>()(
    subscribeWithSelector(
      persist(
        (...args) => ({
          ...createGraphSlice(...args),
          ...createAnalysisSlice(...args),
          ...createZapSlice(...args),
          ...createEventToggleSlice(...args),
          ...createKeywordSlice(...args),
          ...createRelaySlice(...args),
          ...createUiSlice(...args),
          ...createExportSlice(...args),
          ...createPathfindingSlice(...args),
        }),
        {
          name: 'nostr-graph-saved-roots',
          version: PERSIST_VERSION,
          storage: createJSONStorage(() => localStorage),
          partialize: (state): PersistedAppState => ({
            savedRoots: state.savedRoots,
            eventToggles: state.eventToggles,
            eventFeedMode: state.eventFeedMode,
            pauseLiveEventsWhenSceneIsLarge: state.pauseLiveEventsWhenSceneIsLarge,
          }),
          migrate: (persistedState, version): PersistedAppState => {
            const savedRoots = getPersistedSavedRoots(persistedState)
            const seededSavedRoots =
              version < 1 ? seedDefaultSavedRoots(savedRoots) : savedRoots

            // v2 introduces persisted graph-event toggles. Older snapshots
            // simply lack the new keys; sanitiser fills them with defaults.
            return {
              savedRoots: seededSavedRoots,
              eventToggles: sanitizeEventToggles(
                getPersistedRecord(persistedState, 'eventToggles'),
              ),
              eventFeedMode: sanitizeEventFeedMode(
                getPersistedRecord(persistedState, 'eventFeedMode'),
              ),
              pauseLiveEventsWhenSceneIsLarge: Boolean(
                getPersistedRecord(
                  persistedState,
                  'pauseLiveEventsWhenSceneIsLarge',
                ),
              ),
            }
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
