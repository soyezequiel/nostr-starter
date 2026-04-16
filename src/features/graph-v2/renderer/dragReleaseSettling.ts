export interface DragReleaseSettlingConfig {
  frictionPerMillisecond: number
  stopSpeedThreshold: number
  maxDurationMs: number
  maxInitialSpeed: number
  maxTranslationPerFrame: number
}

export interface DragReleaseSettlingState {
  elapsedMs: number
  velocityX: number
  velocityY: number
}

export interface DragReleaseSettlingStepResult {
  done: boolean
  nextState: DragReleaseSettlingState
  translationX: number
  translationY: number
  speed: number
}

export const DEFAULT_DRAG_RELEASE_SETTLING_CONFIG: DragReleaseSettlingConfig = {
  frictionPerMillisecond: 0.025,
  stopSpeedThreshold: 0.006,
  maxDurationMs: 220,
  maxInitialSpeed: 1.1,
  maxTranslationPerFrame: 10,
}

export const getSettlingSpeedMagnitude = ({
  velocityX,
  velocityY,
}: Pick<DragReleaseSettlingState, 'velocityX' | 'velocityY'>) =>
  Math.hypot(velocityX, velocityY)

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const createDragReleaseSettlingState = (
  velocityX: number,
  velocityY: number,
  config: DragReleaseSettlingConfig = DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
): DragReleaseSettlingState => {
  const speed = Math.hypot(velocityX, velocityY)

  if (speed === 0 || speed <= config.maxInitialSpeed) {
    return {
      elapsedMs: 0,
      velocityX,
      velocityY,
    }
  }

  const scale = config.maxInitialSpeed / speed

  return {
    elapsedMs: 0,
    velocityX: velocityX * scale,
    velocityY: velocityY * scale,
  }
}

export const stepDragReleaseSettling = (
  state: DragReleaseSettlingState,
  deltaMs: number,
  config: DragReleaseSettlingConfig = DEFAULT_DRAG_RELEASE_SETTLING_CONFIG,
): DragReleaseSettlingStepResult => {
  const boundedDeltaMs = clamp(
    deltaMs,
    0,
    Math.max(config.maxDurationMs - state.elapsedMs, 0),
  )
  const currentSpeed = getSettlingSpeedMagnitude(state)

  if (boundedDeltaMs === 0 || currentSpeed <= config.stopSpeedThreshold) {
    return {
      done: true,
      nextState: state,
      translationX: 0,
      translationY: 0,
      speed: currentSpeed,
    }
  }

  const decay = Math.exp(-config.frictionPerMillisecond * boundedDeltaMs)
  const nextVelocityX = state.velocityX * decay
  const nextVelocityY = state.velocityY * decay
  const translationX = clamp(
    ((state.velocityX + nextVelocityX) * boundedDeltaMs) / 2,
    -config.maxTranslationPerFrame,
    config.maxTranslationPerFrame,
  )
  const translationY = clamp(
    ((state.velocityY + nextVelocityY) * boundedDeltaMs) / 2,
    -config.maxTranslationPerFrame,
    config.maxTranslationPerFrame,
  )
  const nextState: DragReleaseSettlingState = {
    elapsedMs: state.elapsedMs + boundedDeltaMs,
    velocityX: nextVelocityX,
    velocityY: nextVelocityY,
  }
  const nextSpeed = getSettlingSpeedMagnitude(nextState)
  const done =
    nextState.elapsedMs >= config.maxDurationMs ||
    nextSpeed <= config.stopSpeedThreshold

  return {
    done,
    nextState,
    translationX,
    translationY,
    speed: nextSpeed,
  }
}
