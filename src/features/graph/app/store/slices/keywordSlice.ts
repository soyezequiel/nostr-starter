import type {
  AppStateCreator,
  KeywordLayerState,
  KeywordMatch,
  KeywordSlice,
} from '@/features/graph/app/store/types'

export const createInitialKeywordLayerState = (): KeywordLayerState => ({
  status: 'disabled',
  searchScope: 'graph',
  loadedFrom: 'none',
  isPartial: false,
  message: null,
  corpusNodeCount: 0,
  extractCount: 0,
  matchesByPubkey: {},
  lastUpdatedAt: null,
})

const sortKeywordMatches = (matches: KeywordMatch[]): KeywordMatch[] =>
  matches.slice().sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score
    }

    return left.noteId.localeCompare(right.noteId)
  })

const normalizeMatchesByPubkey = (
  matchesByPubkey: Record<string, KeywordMatch[]>,
): Record<string, KeywordMatch[]> =>
  Object.fromEntries(
    Object.entries(matchesByPubkey)
      .map(([pubkey, matches]) => [pubkey, sortKeywordMatches(matches)] as const)
      .sort(([leftPubkey], [rightPubkey]) => leftPubkey.localeCompare(rightPubkey)),
  )

export const createKeywordSlice: AppStateCreator<KeywordSlice> = (set) => ({
  keywordLayer: createInitialKeywordLayerState(),
  setKeywordLayerState: (keywordLayerPatch) => {
    set((state) => ({
      keywordLayer: {
        ...state.keywordLayer,
        ...keywordLayerPatch,
        matchesByPubkey:
          keywordLayerPatch.matchesByPubkey !== undefined
            ? normalizeMatchesByPubkey(keywordLayerPatch.matchesByPubkey)
            : state.keywordLayer.matchesByPubkey,
      },
    }))
  },
  setKeywordSearchScope: (searchScope) => {
    set((state) => ({
      keywordLayer: {
        ...state.keywordLayer,
        searchScope,
      },
    }))
  },
  setKeywordMatches: (matchesByPubkey) => {
    set((state) => ({
      keywordLayer: {
        ...state.keywordLayer,
        matchesByPubkey: normalizeMatchesByPubkey(matchesByPubkey),
      },
    }))
  },
  resetKeywordLayer: () => {
    set({
      keywordLayer: createInitialKeywordLayerState(),
    })
  },
})
