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

export interface RootLoadProgressCopy {
  locale: string
  defaultIdentity: string
  title: (identity: string) => string
  measuringLinks: string
  nodesSuffix: string
  linksSuffix: string
  complete: string
  noLiveData: string
  loadingGraph: string
  noRelay: string
  metrics: {
    nodes: string
    follows: string
    followers: string
    events: string
    lastRelay: string
    source: string
  }
  cacheSourceValue: string
  steps: Array<{
    id: string
    label: string
    floor: number
  }>
}

interface BuildRootLoadProgressViewModelInput {
  rootLoad: RootLoadState
  identityLabel?: string | null
  nodeCount: number
  fallbackMessage?: string | null
  copy?: RootLoadProgressCopy
}

const DEFAULT_COPY: RootLoadProgressCopy = {
  locale: 'es-AR',
  defaultIdentity: 'identidad',
  title: (identity) => `Mapeando ${identity}`,
  measuringLinks: 'Midiendo links',
  nodesSuffix: 'nodos',
  linksSuffix: 'links',
  complete: 'Carga completa',
  noLiveData: 'No llegaron datos live',
  loadingGraph: 'Cargando grafo',
  noRelay: 'sin relay',
  metrics: {
    nodes: 'Nodos',
    follows: 'Follows',
    followers: 'Followers',
    events: 'Eventos',
    lastRelay: 'Ultimo relay',
    source: 'Origen',
  },
  cacheSourceValue: 'cache local + live',
  steps: [
  { id: 'identity', label: 'Resolver identidad', floor: 6 },
  { id: 'cache', label: 'Leer cache local', floor: 12 },
  { id: 'relays', label: 'Consultar relays activos', floor: 24 },
  { id: 'discovery', label: 'Descubrir contact list + inbound', floor: 42 },
  { id: 'pagination', label: 'Paginar followers inbound', floor: 62 },
  { id: 'parse', label: 'Correlacionar evidencia en worker', floor: 74 },
  { id: 'merge', label: 'Integrar grafo visible', floor: 86 },
  { id: 'enrich', label: 'Hidratar perfiles y actividad', floor: 92 },
  ],
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

const compactRelayUrl = (relayUrl: string | null, noRelayLabel: string) => {
  if (!relayUrl) return noRelayLabel

  try {
    return new URL(relayUrl).host || relayUrl.replace(/^wss?:\/\//, '')
  } catch {
    return relayUrl.replace(/^wss?:\/\//, '')
  }
}

const formatInteger = (value: number, locale: string) =>
  new Intl.NumberFormat(locale).format(value)

const formatCollectionProgress = (
  progress: RootCollectionProgress,
  locale: string,
) => {
  const loaded = formatInteger(progress.loadedCount, locale)
  if (progress.totalCount === null) {
    return loaded
  }

  if (!progress.isTotalKnown && progress.totalCount <= progress.loadedCount) {
    return `${loaded}+`
  }

  const total = formatInteger(progress.totalCount, locale)
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

export const isRootLoadProgressActive = (rootLoad: RootLoadState): boolean => {
  if (rootLoad.status === 'loading') {
    return true
  }

  if (rootLoad.status !== 'partial') {
    return false
  }

  const progress = rootLoad.visibleLinkProgress
  if (!progress) {
    return true
  }

  return (
    progress.following.status !== 'complete' ||
    progress.followers.status !== 'complete'
  )
}

const detectActiveStepIndex = (
  rootLoad: RootLoadState,
  nodeCount: number,
  message: string,
) => {
  const progress = rootLoad.visibleLinkProgress
  const normalizedMessage = message.toLowerCase()

  if (rootLoad.status === 'ready' || rootLoad.status === 'empty') {
    return DEFAULT_COPY.steps.length - 1
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
  copy: RootLoadProgressCopy,
) => {
  const progress = rootLoad.visibleLinkProgress
  if (!progress) {
    return nodeCount > 0
      ? `${formatInteger(nodeCount, copy.locale)} ${copy.nodesSuffix}`
      : copy.measuringLinks
  }

  const loaded = progress.following.loadedCount + progress.followers.loadedCount
  const total = getCombinedTotal(progress.following, progress.followers)
  if (total === null) {
    return `${formatInteger(loaded, copy.locale)} ${copy.linksSuffix}`
  }

  const isKnown =
    progress.following.isTotalKnown && progress.followers.isTotalKnown
  if (!isKnown && total <= loaded) {
    return `${formatInteger(loaded, copy.locale)}+ ${copy.linksSuffix}`
  }

  return `${formatInteger(loaded, copy.locale)} / ${isKnown ? '' : '~'}${formatInteger(total, copy.locale)} ${copy.linksSuffix}`
}

const buildMetrics = (
  rootLoad: RootLoadState,
  nodeCount: number,
  copy: RootLoadProgressCopy,
): RootLoadProgressMetric[] => {
  const progress = rootLoad.visibleLinkProgress
  if (!progress) {
    return [
      {
        label: copy.metrics.nodes,
        value: formatInteger(nodeCount, copy.locale),
      },
    ]
  }

  const metrics: RootLoadProgressMetric[] = [
    {
      label: copy.metrics.follows,
      value: formatCollectionProgress(progress.following, copy.locale),
      tone: progress.following.status === 'complete' ? 'good' : undefined,
    },
    {
      label: copy.metrics.followers,
      value: formatCollectionProgress(progress.followers, copy.locale),
      tone: progress.followers.status === 'complete' ? 'good' : undefined,
    },
    {
      label: copy.metrics.events,
      value: `${formatInteger(progress.contactListEventCount, copy.locale)} contact lists - ${formatInteger(
        progress.inboundCandidateEventCount,
        copy.locale,
      )} inbound`,
    },
    {
      label: copy.metrics.lastRelay,
      value: compactRelayUrl(progress.lastRelayUrl, copy.noRelay),
    },
  ]

  if (rootLoad.loadedFrom === 'cache') {
    metrics.push({
      label: copy.metrics.source,
      value: copy.cacheSourceValue,
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
  copy,
}: BuildRootLoadProgressViewModelInput): RootLoadProgressViewModel => {
  const resolvedCopy = copy ?? DEFAULT_COPY
  const displayName = identityLabel?.trim() || resolvedCopy.defaultIdentity
  const message = rootLoad.message ?? fallbackMessage ?? ''
  const activeStepIndex = detectActiveStepIndex(rootLoad, nodeCount, message)
  const stepCount = resolvedCopy.steps.length
  const tone = resolveTone(rootLoad)
  const progress = rootLoad.visibleLinkProgress
  const ratio = progress
    ? getCollectionRatio(progress.following, progress.followers)
    : null
  const currentFloor = resolvedCopy.steps[activeStepIndex]?.floor ?? 0
  const nextFloor = resolvedCopy.steps[activeStepIndex + 1]?.floor ?? 96
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
  const progressLabel = buildProgressLabel(rootLoad, nodeCount, resolvedCopy)
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
      ? resolvedCopy.complete
      : tone === 'error'
        ? message || resolvedCopy.noLiveData
        : resolvedCopy.steps[activeStepIndex]?.label ?? resolvedCopy.loadingGraph
  const steps: RootLoadProgressStep[] = resolvedCopy.steps.map((step, index) => ({
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
    title: resolvedCopy.title(displayName),
    phaseLabel,
    stepIndex: Math.min(activeStepIndex + 1, stepCount),
    stepCount,
    percent,
    progressLabel,
    isEstimatedTotal,
    isIndeterminate,
    tone,
    metrics: buildMetrics(rootLoad, nodeCount, resolvedCopy),
    steps,
    ariaLabel: `${resolvedCopy.title(displayName)}. ${phaseLabel}. ${progressLabel}. ${percent}%.`,
  }
}
