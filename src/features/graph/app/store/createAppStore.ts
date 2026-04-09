import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { createAnalysisSlice } from '@/features/graph/app/store/slices/analysisSlice'
import { createExportSlice } from '@/features/graph/app/store/slices/exportSlice'
import { createGraphSlice } from '@/features/graph/app/store/slices/graphSlice'
import { createRelaySlice } from '@/features/graph/app/store/slices/relaySlice'
import { createUiSlice } from '@/features/graph/app/store/slices/uiSlice'
import { createZapSlice } from '@/features/graph/app/store/slices/zapSlice'
import type { AppStore, AppStoreApi } from '@/features/graph/app/store/types'

export const createAppStore = (): AppStoreApi =>
  createStore<AppStore>()((...args) => ({
    ...createGraphSlice(...args),
    ...createAnalysisSlice(...args),
    ...createZapSlice(...args),
    ...createRelaySlice(...args),
    ...createUiSlice(...args),
    ...createExportSlice(...args),
  }))

export const appStore = createAppStore()

export const useAppStore = <T>(selector: (state: AppStore) => T) =>
  useStore(appStore, selector)
