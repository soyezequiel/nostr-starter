export type ConnectionColorMode = 'semantic' | 'calm' | 'mono'

export type ConnectionFocusStyle = 'soft' | 'balanced' | 'dramatic'

export type ConnectionVisualConfig = {
  opacity: number
  thicknessScale: number
  colorMode: ConnectionColorMode
  focusStyle: ConnectionFocusStyle
}

export const DEFAULT_CONNECTION_VISUAL_CONFIG: ConnectionVisualConfig = {
  opacity: 0.58,
  thicknessScale: 0.55,
  colorMode: 'calm',
  focusStyle: 'balanced',
}

export const MIN_CONNECTION_OPACITY = 0.1
export const MAX_CONNECTION_OPACITY = 1
export const CONNECTION_OPACITY_STEP = 0.05
export const MIN_CONNECTION_THICKNESS_SCALE = 0.35
export const MAX_CONNECTION_THICKNESS_SCALE = 1.75
export const CONNECTION_THICKNESS_SCALE_STEP = 0.05

const CONNECTION_COLOR_MODES = new Set<ConnectionColorMode>([
  'semantic',
  'calm',
  'mono',
])

const CONNECTION_FOCUS_STYLES = new Set<ConnectionFocusStyle>([
  'soft',
  'balanced',
  'dramatic',
])

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const clampConnectionOpacity = (value: number) =>
  Number.isFinite(value)
    ? clampNumber(value, MIN_CONNECTION_OPACITY, MAX_CONNECTION_OPACITY)
    : DEFAULT_CONNECTION_VISUAL_CONFIG.opacity

export const clampConnectionThicknessScale = (value: number) =>
  Number.isFinite(value)
    ? clampNumber(
        value,
        MIN_CONNECTION_THICKNESS_SCALE,
        MAX_CONNECTION_THICKNESS_SCALE,
      )
    : DEFAULT_CONNECTION_VISUAL_CONFIG.thicknessScale

export const normalizeConnectionVisualConfig = (
  value: Partial<ConnectionVisualConfig> | null | undefined,
): ConnectionVisualConfig => ({
  opacity: clampConnectionOpacity(
    value?.opacity ?? DEFAULT_CONNECTION_VISUAL_CONFIG.opacity,
  ),
  thicknessScale: clampConnectionThicknessScale(
    value?.thicknessScale ?? DEFAULT_CONNECTION_VISUAL_CONFIG.thicknessScale,
  ),
  colorMode: CONNECTION_COLOR_MODES.has(
    value?.colorMode as ConnectionColorMode,
  )
    ? (value?.colorMode as ConnectionColorMode)
    : DEFAULT_CONNECTION_VISUAL_CONFIG.colorMode,
  focusStyle: CONNECTION_FOCUS_STYLES.has(
    value?.focusStyle as ConnectionFocusStyle,
  )
    ? (value?.focusStyle as ConnectionFocusStyle)
    : DEFAULT_CONNECTION_VISUAL_CONFIG.focusStyle,
})
