import type {
  AppStateCreator,
  KeywordLayerState,
  KeywordMatch,
  KeywordSlice,
} from '@/features/graph/app/store/types'

export const createInitialKeywordLayerState = (): KeywordLayerState => ({
  status: 'disabled',
  loadedFrom: 'none',
  isPartial: false,
  message: null,
  corpusNodeCount: 0,
  extractCount: 0,
  matchCount: 0,
  matchNodeCount: 0,
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
): {
  matchCount: number
  matchNodeCount: number
  matchesByPubkey: Record<string, KeywordMatch[]>
} => {
  let matchCount = 0
  const normalizedEntries = Object.entries(matchesByPubkey)
    .map(([pubkey, matches]) => {
      const sortedMatches = sortKeywordMatches(matches)
      matchCount += sortedMatches.length
      return [pubkey, sortedMatches] as const
    })
    .sort(([leftPubkey], [rightPubkey]) => leftPubkey.localeCompare(rightPubkey))

  return {
    matchCount,
    matchNodeCount: normalizedEntries.length,
    matchesByPubkey: Object.fromEntries(normalizedEntries),
  }
}

export const createKeywordSlice: AppStateCreator<KeywordSlice> = (set) => ({
  keywordLayer: createInitialKeywordLayerState(),
  setKeywordLayerState: (keywordLayerPatch) => {
    const normalizedMatches =
      keywordLayerPatch.matchesByPubkey !== undefined
        ? normalizeMatchesByPubkey(keywordLayerPatch.matchesByPubkey)
        : null

    set((state) => ({
      keywordLayer: {
        ...state.keywordLayer,
        ...keywordLayerPatch,
        matchesByPubkey:
          normalizedMatches?.matchesByPubkey ?? state.keywordLayer.matchesByPubkey,
        matchCount: normalizedMatches?.matchCount ?? state.keywordLayer.matchCount,
        matchNodeCount:
          normalizedMatches?.matchNodeCount ?? state.keywordLayer.matchNodeCount,
      },
    }))
  },
  setKeywordMatches: (matchesByPubkey) => {
    const normalizedMatches = normalizeMatchesByPubkey(matchesByPubkey)

    set((state) => ({
      keywordLayer: {
        ...state.keywordLayer,
        matchesByPubkey: normalizedMatches.matchesByPubkey,
        matchCount: normalizedMatches.matchCount,
        matchNodeCount: normalizedMatches.matchNodeCount,
      },
    }))
  },
  resetKeywordLayer: () => {
    set({
      keywordLayer: createInitialKeywordLayerState(),
    })
  },
})
