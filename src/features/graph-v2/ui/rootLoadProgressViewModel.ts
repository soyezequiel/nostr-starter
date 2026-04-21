import type {
  RootCollectionProgress,
  RootLoadState,
} from '@/features/graph-runtime/app/store/types'

export type RootLoadProgressTone =
  | 'idle'
  | 'loading'
  | 'partial'
  | 'ready'
  | 'error'

export type RootLoadProgressStepStatus = 'done' | 'active' | 'pending'

export interface RootLoadProgressMetric {
  label: string
  value: string
  tone?: 'good' | 'warn'
}

export interface RootLoadProgressStep {
  id: string
  label: string
  status: RootLoadProgressStepStatus
}

export interface RootLoadProgressViewModel {
  title: string
  phaseLabel: string
  stepIndex: number
  stepCount: number
  percent: number
  progressLabel: string
  isEstimatedTotal: boolean
  isIndeterminate: boolean
  tone: RootLoadProgressTone
  metrics: RootLoadProgressMetric[]
  steps: RootLoadProgressStep[]
  ariaLabel: string
}

interface BuildRootLoadProgressViewModelInput {
  rootLoad: RootLoadState
  identityLabel?: string | null
  nodeCount: number
  fallbackMessage?: string | null
}

const STEP_DEFINITIONS = [
  { id: 'identity', label: 'Resolver identidad', floor: 6 },
  { id: 'cache', label: 'Leer cache local', floor: 12 },
  { id: 'relays', label: 'Consultar relays activos', floor: 24 },
  { id: 'discovery', label: 'Descubrir contact list + inbound', floor: 42 },
  { id: 'pagination', label: 'Paginar followers inbound', floor: 62 },
  { id: 'parse', label: 'Correlacionar evidencia en worker', floor: 74 },
  { id: 'merge', label: 'Integrar grafo visible', floor: 86 },
  { id: 'enrich', label: 'Hidratar perfiles y zaps', floor: 92 },
] as const

const NUMBER_FORMATTER = new Intl.NumberFormat('es-AR')

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

const compactRelayUrl = (relayUrl: string | null) => {
  if (!relayUrl) return 'sin relay'

  try {
    return new URL(relayUrl).host || relayUrl.replace(/^wss?:\/\//, '')
  } catch {
    return relayUrl.replace(/^wss?:\/\//, '')
  }
}

const formatInteger = (value: number) => NUMBER_FORMATTER.format(value)

const formatCollectionProgress = (progress: RootCollectionProgress) => {
  const loaded = formatInteger(progress.loadedCount)
  if (progress.totalCount === null) {
    return loaded
  }

  if (!progress.isTotalKnown && progress.totalCount <= progress.loadedCount) {
    return `${loaded}+`
  }

  const total = formatInteger(progress.totalCount)
  return `${loaded} / ${progress.isTotalKnown ? '' : '~'}${total}`
}

const getCombinedTotal = (
  following: RootCollectionProgress,
  followers: RootCollectionProgress,
) => {
  if (following.totalCount === null || followers.totalCount === null) {
    return null
  }

  return following.totalCount + followers.totalCount
}

const getCollectionRatio = (
  following: RootCollectionProgress,
  followers: RootCollectionProgress,
) => {
  const total = getCombinedTotal(following, followers)
  if (total === null || total <= 0) {
    return null
  }

  return Math.min(1, (following.loadedCount + followers.loadedCount) / total)
}

const detectActiveStepIndex = (
  rootLoad: RootLoadState,
  nodeCount: number,
  message: string,
) => {
  const progress = rootLoad.visibleLinkProgress
  const normalizedMessage = message.toLowerCase()

  if (rootLoad.status === 'ready' || rootLoad.status === 'empty') {
    return STEP_DEFINITIONS.length - 1
  }

  if (
    normalizedMessage.includes('grafo inicial cargado') ||
    normalizedMessage.includes('enriqueciendo') ||
    (rootLoad.status === 'partial' && nodeCount > 0)
  ) {
    return 7
  }

  if (
    normalizedMessage.includes('integrando') ||
    normalizedMessage.includes('persistiendo') ||
    normalizedMessage.includes('merge')
  ) {
    return 6
  }

  if (
    normalizedMessage.includes('correlacionando') ||
    normalizedMessage.includes('parseando')
  ) {
    return 5
  }

  if (normalizedMessage.includes('paginando')) {
    return 4
  }

  if (
    progress &&
    (progress.contactListEventCount > 0 ||
      progress.inboundCandidateEventCount > 0 ||
      progress.following.loadedCount > 0 ||
      progress.followers.loadedCount > 0)
  ) {
    return 3
  }

  if (
    normalizedMessage.includes('count') ||
    normalizedMessage.includes('relays') ||
    progress?.lastRelayUrl
  ) {
    return 2
  }

  if (rootLoad.loadedFrom === 'cache') {
    return 1
  }

  return 0
}

const resolveTone = (rootLoad: RootLoadState): RootLoadProgressTone => {
  switch (rootLoad.status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'loading'
    case 'partial':
      return 'partial'
    case 'ready':
    case 'empty':
      return 'ready'
    case 'error':
      return 'error'
  }
}

const buildProgressLabel = (
  rootLoad: RootLoadState,
  nodeCount: number,
) => {
  const progress = rootLoad.visibleLinkProgress
  if (!progress) {
    return nodeCount > 0 ? `${formatInteger(nodeCount)} nodos` : 'Midiendo links'
  }

  const loaded = progress.following.loadedCount + progress.followers.loadedCount
  const total = getCombinedTotal(progress.following, progress.followers)
  if (total === null) {
    return `${formatInteger(loaded)} links`
  }

  const isKnown =
    progress.following.isTotalKnown && progress.followers.isTotalKnown
  if (!isKnown && total <= loaded) {
    return `${formatInteger(loaded)}+ links`
  }

  return `${formatInteger(loaded)} / ${isKnown ? '' : '~'}${formatInteger(total)} links`
}

const buildMetrics = (
  rootLoad: RootLoadState,
  nodeCount: number,
): RootLoadProgressMetric[] => {
  const progress = rootLoad.visibleLinkProgress
  if (!progress) {
    return [
      {
        label: 'Nodos',
        value: formatInteger(nodeCount),
      },
    ]
  }

  const metrics: RootLoadProgressMetric[] = [
    {
      label: 'Follows',
      value: formatCollectionProgress(progress.following),
      tone: progress.following.status === 'complete' ? 'good' : undefined,
    },
    {
      label: 'Followers',
      value: formatCollectionProgress(progress.followers),
      tone: progress.followers.status === 'complete' ? 'good' : undefined,
    },
    {
      label: 'Eventos',
      value: `${formatInteger(progress.contactListEventCount)} contact lists - ${formatInteger(
        progress.inboundCandidateEventCount,
      )} inbound`,
    },
    {
      label: 'Ultimo relay',
      value: compactRelayUrl(progress.lastRelayUrl),
    },
  ]

  if (rootLoad.loadedFrom === 'cache') {
    metrics.push({
      label: 'Origen',
      value: 'cache local + live',
      tone: 'warn',
    })
  }

  return metrics
}

export const buildRootLoadProgressViewModel = ({
  rootLoad,
  identityLabel,
  nodeCount,
  fallbackMessage,
}: BuildRootLoadProgressViewModelInput): RootLoadProgressViewModel => {
  const displayName = identityLabel?.trim() || 'identidad'
  const message = rootLoad.message ?? fallbackMessage ?? ''
  const activeStepIndex = detectActiveStepIndex(rootLoad, nodeCount, message)
  const stepCount = STEP_DEFINITIONS.length
  const tone = resolveTone(rootLoad)
  const progress = rootLoad.visibleLinkProgress
  const ratio = progress
    ? getCollectionRatio(progress.following, progress.followers)
    : null
  const currentFloor = STEP_DEFINITIONS[activeStepIndex]?.floor ?? 0
  const nextFloor = STEP_DEFINITIONS[activeStepIndex + 1]?.floor ?? 96
  const phasePercent =
    ratio === null
      ? currentFloor
      : currentFloor + (nextFloor - currentFloor) * ratio
  const percent =
    tone === 'ready'
      ? 100
      : tone === 'error'
        ? clampPercent(Math.max(currentFloor, 8))
        : clampPercent(Math.round(Math.min(96, phasePercent)))
  const progressLabel = buildProgressLabel(rootLoad, nodeCount)
  const isEstimatedTotal = Boolean(
    progress &&
      progress.following.totalCount !== null &&
      progress.followers.totalCount !== null &&
      (!progress.following.isTotalKnown || !progress.followers.isTotalKnown),
  )
  const isIndeterminate =
    !progress || getCombinedTotal(progress.following, progress.followers) === null
  const phaseLabel =
    tone === 'ready'
      ? 'Carga completa'
      : tone === 'error'
        ? message || 'No llegaron datos live'
        : STEP_DEFINITIONS[activeStepIndex]?.label ?? 'Cargando grafo'
  const steps = STEP_DEFINITIONS.map((step, index) => ({
    id: step.id,
    label: step.label,
    status:
      tone === 'ready' || index < activeStepIndex
        ? 'done'
        : index === activeStepIndex
          ? 'active'
          : 'pending',
  }))

  return {
    title: `Mapeando ${displayName}`,
    phaseLabel,
    stepIndex: Math.min(activeStepIndex + 1, stepCount),
    stepCount,
    percent,
    progressLabel,
    isEstimatedTotal,
    isIndeterminate,
    tone,
    metrics: buildMetrics(rootLoad, nodeCount),
    steps,
    ariaLabel: `${progressLabel}. ${phaseLabel}. ${percent} por ciento.`,
  }
}
