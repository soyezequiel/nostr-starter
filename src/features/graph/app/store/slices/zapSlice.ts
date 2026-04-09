import type {
  AppStateCreator,
  ZapLayerEdge,
  ZapLayerState,
  ZapSlice,
} from '@/features/graph/app/store/types'

export const createInitialZapLayerState = (): ZapLayerState => ({
  status: 'disabled',
  edges: [],
  skippedReceipts: 0,
  loadedFrom: 'none',
  targetPubkeys: [],
  message: null,
  lastUpdatedAt: null,
})

const sortZapEdges = (edges: ZapLayerEdge[]): ZapLayerEdge[] =>
  edges.slice().sort((left, right) => {
    if (left.weight !== right.weight) {
      return right.weight - left.weight
    }

    if (left.source !== right.source) {
      return left.source.localeCompare(right.source)
    }

    return left.target.localeCompare(right.target)
  })

export const createZapSlice: AppStateCreator<ZapSlice> = (set) => ({
  zapLayer: createInitialZapLayerState(),
  setZapLayerState: (zapLayerPatch) => {
    set((state) => ({
      zapLayer: {
        ...state.zapLayer,
        ...zapLayerPatch,
        targetPubkeys: zapLayerPatch.targetPubkeys
          ? [...zapLayerPatch.targetPubkeys].sort()
          : state.zapLayer.targetPubkeys,
      },
    }))
  },
  replaceZapLayerEdges: (edges) => {
    set((state) => ({
      zapLayer: {
        ...state.zapLayer,
        edges: sortZapEdges(edges),
      },
    }))
  },
  resetZapLayer: () => {
    set({
      zapLayer: createInitialZapLayerState(),
    })
  },
})
