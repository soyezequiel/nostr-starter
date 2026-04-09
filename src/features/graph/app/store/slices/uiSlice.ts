import type { AppStateCreator, UiSlice } from '@/features/graph/app/store/types'
import {
  DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
  DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
  normalizeAvatarZoomThresholds,
} from '@/features/graph/render/avatarQualityGuide'

export const createInitialUiSliceState = (): Pick<
  UiSlice,
  | 'selectedNodePubkey'
  | 'comparedNodePubkeys'
  | 'activeLayer'
  | 'openPanel'
  | 'currentKeyword'
  | 'rootLoad'
  | 'renderConfig'
> => ({
  selectedNodePubkey: null,
  comparedNodePubkeys: new Set<string>(),
  activeLayer: 'graph',
  openPanel: 'overview',
  currentKeyword: '',
  rootLoad: {
    status: 'idle',
    message: null,
    loadedFrom: 'none',
  },
  renderConfig: {
    edgeThickness: 1,
    arrowType: 'none',
    nodeSpacingFactor: 1,
    nodeSizeFactor: 1,
    autoSizeNodes: true,
    imageQualityMode: 'full-hd',
    avatarHdZoomThreshold: DEFAULT_AVATAR_HD_ZOOM_THRESHOLD,
    avatarFullHdZoomThreshold: DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD,
    showDiscoveryState: true,
    showSharedEmphasis: false,
    showAvatarQualityGuide: false,
    showImageResidencyDebug: false,
  },
})

export const createUiSlice: AppStateCreator<UiSlice> = (set) => ({
  ...createInitialUiSliceState(),
  setSelectedNodePubkey: (pubkey) => {
    set({ selectedNodePubkey: pubkey })
  },
  setComparedNodePubkeys: (pubkeys) => {
    set({ comparedNodePubkeys: pubkeys })
  },
  clearComparedNodes: () => {
    set({ comparedNodePubkeys: new Set<string>() })
  },
  setActiveLayer: (layer) => {
    set({ activeLayer: layer })
  },
  setOpenPanel: (panel) => {
    set({ openPanel: panel })
  },
  setCurrentKeyword: (keyword) => {
    set({ currentKeyword: keyword })
  },
  setRootLoadState: (rootLoadPatch) => {
    set((state) => ({
      rootLoad: {
        ...state.rootLoad,
        ...rootLoadPatch,
      },
    }))
  },
  resetRootLoadState: () => {
    set({
      rootLoad: createInitialUiSliceState().rootLoad,
    })
  },
  setRenderConfig: (configPatch) => {
    set((state) => ({
      renderConfig: (() => {
        const nextRenderConfig = {
          ...state.renderConfig,
          ...configPatch,
        }
        const normalizedZoomThresholds =
          normalizeAvatarZoomThresholds(nextRenderConfig)

        return {
          ...nextRenderConfig,
          ...normalizedZoomThresholds,
        }
      })(),
    }))
  },
})
