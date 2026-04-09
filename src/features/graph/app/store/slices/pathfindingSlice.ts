import type {
  AppStateCreator,
  PathfindingSlice,
  PathfindingState,
} from '@/features/graph/app/store/types'

const createInitialPathfindingState = (): PathfindingState => ({
  sourceQuery: '',
  targetQuery: '',
  sourcePubkey: null,
  targetPubkey: null,
  selectionMode: 'idle',
  status: 'idle',
  path: null,
  visitedCount: 0,
  algorithm: 'bfs',
  message: null,
  previousLayer: null,
})

const clearResolvedPath = (
  state: PathfindingState,
  patch: Partial<PathfindingState>,
): PathfindingState => ({
  ...state,
  ...patch,
  status: 'idle',
  path: null,
  visitedCount: 0,
  message: null,
})

export const createPathfindingSlice: AppStateCreator<PathfindingSlice> = (set) => ({
  pathfinding: createInitialPathfindingState(),
  setPathfindingInput: (role, query) => {
    set((state) => {
      const previousState = state.pathfinding
      const nextQueryKey = role === 'source' ? 'sourceQuery' : 'targetQuery'
      const nextPubkeyKey = role === 'source' ? 'sourcePubkey' : 'targetPubkey'

      if (
        previousState[nextQueryKey] === query &&
        previousState[nextPubkeyKey] === null
      ) {
        return state
      }

      return {
        pathfinding: clearResolvedPath(previousState, {
          [nextQueryKey]: query,
          [nextPubkeyKey]: null,
          selectionMode:
            previousState.selectionMode === role ? 'idle' : previousState.selectionMode,
        }),
      }
    })
  },
  setPathfindingEndpoint: (role, endpoint) => {
    set((state) => {
      const previousState = state.pathfinding
      const nextQueryKey = role === 'source' ? 'sourceQuery' : 'targetQuery'
      const nextPubkeyKey = role === 'source' ? 'sourcePubkey' : 'targetPubkey'
      const nextQuery = endpoint.query ?? endpoint.pubkey ?? ''

      if (
        previousState[nextQueryKey] === nextQuery &&
        previousState[nextPubkeyKey] === endpoint.pubkey &&
        previousState.selectionMode === 'idle'
      ) {
        return state
      }

      return {
        pathfinding: clearResolvedPath(previousState, {
          [nextQueryKey]: nextQuery,
          [nextPubkeyKey]: endpoint.pubkey,
          selectionMode: 'idle',
        }),
      }
    })
  },
  setPathfindingSelectionMode: (mode) => {
    set((state) => {
      if (state.pathfinding.selectionMode === mode) {
        return state
      }

      return {
        pathfinding: {
          ...state.pathfinding,
          selectionMode: mode,
        },
      }
    })
  },
  setPathfindingPending: (algorithm = 'bfs') => {
    set((state) => ({
      pathfinding: {
        ...state.pathfinding,
        selectionMode: 'idle',
        status: 'computing',
        path: null,
        visitedCount: 0,
        algorithm,
        message: 'Buscando camino en el grafo mutuo descubierto...',
      },
    }))
  },
  setPathfindingResult: (result) => {
    set((state) => ({
      pathfinding: {
        ...state.pathfinding,
        selectionMode: 'idle',
        status: result.path ? 'found' : 'not-found',
        path: result.path,
        visitedCount: result.visitedCount,
        algorithm: result.algorithm,
        message: result.message,
        previousLayer:
          typeof result.previousLayer === 'undefined'
            ? state.pathfinding.previousLayer
            : result.previousLayer,
      },
    }))
  },
  setPathfindingError: (message, options) => {
    set((state) => ({
      pathfinding: {
        ...state.pathfinding,
        selectionMode: 'idle',
        status: 'error',
        path: null,
        visitedCount: 0,
        algorithm: options?.algorithm ?? state.pathfinding.algorithm,
        message,
        previousLayer:
          typeof options?.previousLayer === 'undefined'
            ? state.pathfinding.previousLayer
            : options.previousLayer,
      },
    }))
  },
  clearPathfindingResult: () => {
    set((state) => ({
      pathfinding: clearResolvedPath(state.pathfinding, {
        selectionMode: 'idle',
      }),
    }))
  },
  resetPathfinding: () => {
    set({
      pathfinding: createInitialPathfindingState(),
    })
  },
})
