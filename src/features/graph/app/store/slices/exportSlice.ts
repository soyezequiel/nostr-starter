import type {
  AppStateCreator,
  ExportJobProgress,
  ExportJobStatus,
  ExportSlice,
} from '@/features/graph/app/store/types'

export const DEFAULT_MAX_SELECTED_DEEP_USERS = 4

const createInitialExportJob = (
  phase: ExportJobStatus = 'idle',
): ExportJobProgress => ({
  phase,
  percent: 0,
  currentPubkey: null,
  errorMessage: null,
})

export const createInitialExportSliceState = (): Pick<
  ExportSlice,
  'selectedDeepUserPubkeys' | 'maxSelectedDeepUsers' | 'exportJob'
> => ({
  selectedDeepUserPubkeys: [],
  maxSelectedDeepUsers: DEFAULT_MAX_SELECTED_DEEP_USERS,
  exportJob: createInitialExportJob(),
})

const isExportJobActive = (phase: ExportJobStatus) =>
  !['idle', 'completed', 'failed'].includes(phase)

export const createExportSlice: AppStateCreator<ExportSlice> = (set, get) => ({
  ...createInitialExportSliceState(),
  toggleDeepUserSelection: (pubkey, selected) => {
    const state = get()

    if (isExportJobActive(state.exportJob.phase)) {
      return {
        selectedDeepUserPubkeys: state.selectedDeepUserPubkeys,
        slotsRemaining:
          state.maxSelectedDeepUsers - state.selectedDeepUserPubkeys.length,
        reason: 'job-active' as const,
      }
    }

    const nextSelected = state.selectedDeepUserPubkeys.filter(
      (selectedPubkey) => selectedPubkey !== pubkey,
    )

    if (
      selected &&
      !state.selectedDeepUserPubkeys.includes(pubkey) &&
      nextSelected.length >= state.maxSelectedDeepUsers
    ) {
      return {
        selectedDeepUserPubkeys: state.selectedDeepUserPubkeys,
        slotsRemaining: 0,
        reason: 'max-selected' as const,
      }
    }

    const selectedDeepUserPubkeys = selected
      ? [...nextSelected, pubkey]
      : nextSelected

    set({
      selectedDeepUserPubkeys,
    })

    return {
      selectedDeepUserPubkeys,
      slotsRemaining: state.maxSelectedDeepUsers - selectedDeepUserPubkeys.length,
      reason: null,
    }
  },
  setExportJobProgress: (progressPatch) => {
    set((state) => ({
      exportJob: {
        ...state.exportJob,
        ...progressPatch,
      },
    }))
  },
  resetExportJob: () => {
    set({
      exportJob: createInitialExportJob(),
    })
  },
})
