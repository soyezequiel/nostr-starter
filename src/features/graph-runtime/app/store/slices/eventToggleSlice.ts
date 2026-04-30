import {
  DEFAULT_GRAPH_EVENT_TOGGLES,
  GRAPH_EVENT_KINDS,
  type GraphEventFeedMode,
  type GraphEventKind,
  type GraphEventToggleState,
} from '@/features/graph-v2/events/types'
import type {
  AppStateCreator,
  EventToggleSlice,
} from '@/features/graph-runtime/app/store/types'

export const sanitizeEventToggles = (
  toggles: Partial<GraphEventToggleState> | undefined,
): GraphEventToggleState => {
  const next: GraphEventToggleState = { ...DEFAULT_GRAPH_EVENT_TOGGLES }
  if (toggles) {
    for (const kind of GRAPH_EVENT_KINDS) {
      const value = toggles[kind]
      if (typeof value === 'boolean') {
        next[kind] = value
      }
    }
  }
  return next
}

export const sanitizeEventFeedMode = (
  mode: GraphEventFeedMode | undefined,
): GraphEventFeedMode => (mode === 'recent' ? 'recent' : 'live')

export const createEventToggleSlice: AppStateCreator<EventToggleSlice> = (
  set,
) => ({
  eventToggles: sanitizeEventToggles(undefined),
  eventFeedMode: 'live',
  pauseLiveEventsWhenSceneIsLarge: false,
  setEventToggle: (kind: GraphEventKind, enabled: boolean) => {
    set((state) => ({
      eventToggles: { ...state.eventToggles, [kind]: enabled },
    }))
  },
  setEventToggles: (toggles) => {
    set(() => ({ eventToggles: sanitizeEventToggles(toggles) }))
  },
  setEventFeedMode: (mode) => {
    set(() => ({ eventFeedMode: sanitizeEventFeedMode(mode) }))
  },
  setPauseLiveEventsWhenSceneIsLarge: (paused) => {
    set(() => ({ pauseLiveEventsWhenSceneIsLarge: Boolean(paused) }))
  },
})
