import type {
  DiscoveredGraphAnalysisResult,
  DiscoveredGraphAnalysisState,
  DiscoveredGraphAnalysisStatus,
} from '@/features/graph/analysis/types'
import type { AnalysisSlice, AppStateCreator } from '@/features/graph/app/store/types'

export const createInitialGraphAnalysisState =
  (): DiscoveredGraphAnalysisState => ({
    status: 'idle',
    isStale: false,
    analysisKey: null,
    message: null,
    result: null,
  })

const shouldReuseExistingResult = (
  status: DiscoveredGraphAnalysisStatus,
  existingResult: DiscoveredGraphAnalysisResult | null,
) =>
  existingResult !== null &&
  (status === 'ready' || status === 'partial' || status === 'loading')

export const createAnalysisSlice: AppStateCreator<AnalysisSlice> = (set) => ({
  graphAnalysis: createInitialGraphAnalysisState(),
  setGraphAnalysisLoading: (analysisKey, message) => {
    set((state) => ({
      graphAnalysis: {
        ...state.graphAnalysis,
        status: 'loading',
        isStale: shouldReuseExistingResult(
          state.graphAnalysis.status,
          state.graphAnalysis.result,
        ),
        analysisKey,
        message,
      },
    }))
  },
  setGraphAnalysisResult: (result, status, message) => {
    set({
      graphAnalysis: {
        status,
        isStale: false,
        analysisKey: result.analysisKey,
        message,
        result,
      },
    })
  },
  setGraphAnalysisError: (analysisKey, message) => {
    set((state) => ({
      graphAnalysis: {
        status: state.graphAnalysis.result ? 'partial' : 'error',
        isStale: state.graphAnalysis.result !== null,
        analysisKey,
        message,
        result: state.graphAnalysis.result,
      },
    }))
  },
  resetGraphAnalysis: () => {
    set({
      graphAnalysis: createInitialGraphAnalysisState(),
    })
  },
})
