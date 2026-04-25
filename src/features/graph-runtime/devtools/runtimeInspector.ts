import type {
  DevicePerformanceProfile,
  EffectiveGraphCaps,
  EffectiveImageBudget,
  ImageQualityMode,
  RelayHealthStatus,
  ZapLayerStatus,
} from '@/features/graph-runtime/app/store/types'
import type {
  CanonicalGraphSceneState,
  CanonicalGraphUiState,
} from '@/features/graph-v2/domain/types'
import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import {
  resolveFpsFromFrameMs,
  type PerfBudgetSnapshot,
} from '@/features/graph-v2/renderer/avatar/perfBudget'
import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import type { DebugPhysicsDiagnostics } from '@/features/graph-v2/testing/browserDebug'
import type { VisibleProfileWarmupDebugSnapshot } from '@/features/graph-v2/ui/visibleProfileWarmup'
import { hasUsableCanonicalProfile } from '@/features/graph-v2/ui/visibleProfileWarmup'

export type RuntimeInspectorTone = 'ok' | 'warn' | 'bad' | 'neutral'

export interface RuntimeInspectorMetric {
  label: string
  value: string
  tone?: RuntimeInspectorTone
}

export interface RuntimeInspectorResourceMode {
  id:
    | 'graph-layer'
    | 'physics'
    | 'avatars'
    | 'zaps'
    | 'profiles'
    | 'root-load'
  rank: number
  titulo: string
  intensidad: 'alta' | 'media' | 'baja'
  valor: string
  detalle: string
  tone: RuntimeInspectorTone
}

export interface RuntimeInspectorSummaryItem {
  id:
    | 'coverage'
    | 'profiles'
    | 'avatars'
    | 'zaps'
    | 'performance'
    | 'relays'
  title: string
  tone: RuntimeInspectorTone
  estado: string
  valor: string
  detalle: string
}

export interface RuntimeInspectorPrimaryIssue {
  titulo: string
  causaProbable: string
  confianza: 'alta' | 'media' | 'baja'
  abrirAhora:
    | 'coverage'
    | 'profiles'
    | 'avatars'
    | 'zaps'
    | 'performance'
    | 'relays'
    | 'load'
  tone: RuntimeInspectorTone
}

interface RuntimeInspectorSectionBase {
  tone: RuntimeInspectorTone
  titulo: string
  resumen: string
  estado: string
  queSignifica: string
  quePasaAhora: string
  queLeerAhora: string
}

export interface RuntimeInspectorCoverageSection
  extends RuntimeInspectorSectionBase {
  cadena: RuntimeInspectorMetric[]
  relays: Array<{
    relay: string
    estado: string
    detalle: string
  }>
  notas: string[]
}

export interface RuntimeInspectorProfilesSection
  extends RuntimeInspectorSectionBase {
  metricas: RuntimeInspectorMetric[]
  notas: string[]
}

export interface RuntimeInspectorAvatarsSection
  extends RuntimeInspectorSectionBase {
  metricas: RuntimeInspectorMetric[]
  razones: RuntimeInspectorMetric[]
  casos: Array<{
    nodo: string
    causa: string
  }>
}

export interface RuntimeInspectorZapsSection
  extends RuntimeInspectorSectionBase {
  cadena: RuntimeInspectorMetric[]
  notas: string[]
}

export interface RuntimeInspectorPerformanceSection
  extends RuntimeInspectorSectionBase {
  metricas: RuntimeInspectorMetric[]
  sospechosos: string[]
}

export interface RuntimeInspectorRelaysSection
  extends RuntimeInspectorSectionBase {
  metricas: RuntimeInspectorMetric[]
  filas: Array<{
    relay: string
    estado: string
    detalle: string
  }>
}

export interface RuntimeInspectorLoadSection
  extends RuntimeInspectorSectionBase {
  metricas: RuntimeInspectorMetric[]
}

export interface RuntimeInspectorSnapshot {
  generadoA: string
  primary: RuntimeInspectorPrimaryIssue
  summary: RuntimeInspectorSummaryItem[]
  coverage: RuntimeInspectorCoverageSection
  profiles: RuntimeInspectorProfilesSection
  avatars: RuntimeInspectorAvatarsSection
  zaps: RuntimeInspectorZapsSection
  performance: RuntimeInspectorPerformanceSection
  relays: RuntimeInspectorRelaysSection
  load: RuntimeInspectorLoadSection
  resourceTop: RuntimeInspectorResourceMode[]
}

export interface RuntimeInspectorBuildInput {
  generatedAtMs: number | null
  sceneState: CanonicalGraphSceneState
  uiState: CanonicalGraphUiState
  scene: GraphSceneSnapshot
  graphSummary: {
    nodeCount: number
    linkCount: number
    maxNodes: number
    capReached: boolean
  }
  deviceSummary: {
    devicePerformanceProfile: DevicePerformanceProfile
    effectiveGraphCaps: EffectiveGraphCaps
    effectiveImageBudget: EffectiveImageBudget
  }
  zapSummary: {
    status: ZapLayerStatus
    edgeCount: number
    skippedReceipts: number
    loadedFrom: 'none' | 'cache' | 'live'
    message: string | null
    targetCount: number
    lastUpdatedAt: number | null
  }
  avatarPerfSnapshot: PerfBudgetSnapshot | null
  avatarRuntimeSnapshot: AvatarRuntimeStateDebugSnapshot | null
  physicsDiagnostics: DebugPhysicsDiagnostics | null
  visibleProfileWarmup: VisibleProfileWarmupDebugSnapshot | null
  visibleNodePubkeys: string[]
  liveZapFeedback: string | null
  showZaps: boolean
  physicsEnabled: boolean
  imageQualityMode: ImageQualityMode
  sceneUpdatesPerMinute: number
  uiUpdatesPerMinute: number
}

const PRIORITY: Array<RuntimeInspectorSummaryItem['id']> = [
  'coverage',
  'profiles',
  'avatars',
  'zaps',
  'performance',
  'relays',
]

const COVERAGE_PROJECTION_ONLY_SUMMARIES = new Set([
  'La capa actual filtra nodos cargados',
  'La capa actual puede ocultar followers',
])

const formatInteger = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return 'sin dato'
  }
  return new Intl.NumberFormat('es-AR').format(value)
}

const formatDecimal = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'sin dato'
  }
  return value.toFixed(digits)
}

const formatFps = (frameMs: number | null | undefined) => {
  const fps = resolveFpsFromFrameMs(frameMs)
  if (fps === null) {
    return 'sin dato'
  }
  return `${fps >= 10 ? fps.toFixed(0) : fps.toFixed(1)} fps`
}

const formatFpsWithFrameMs = (frameMs: number | null | undefined) => {
  const fpsLabel = formatFps(frameMs)
  if (
    fpsLabel === 'sin dato' ||
    frameMs === null ||
    frameMs === undefined ||
    !Number.isFinite(frameMs)
  ) {
    return fpsLabel
  }
  return `${fpsLabel} (${formatDecimal(frameMs)} ms)`
}

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'sin dato'
  }
  if (value < 1024 * 1024) {
    return `${formatDecimal(value / 1024, 1)} KB`
  }
  return `${formatDecimal(value / (1024 * 1024), 1)} MB`
}

const compactPubkey = (value: string) =>
  value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value

const compactRelay = (value: string) => {
  try {
    return new URL(value).host || value.replace(/^wss?:\/\//, '')
  } catch {
    return value.replace(/^wss?:\/\//, '')
  }
}

const translateLayer = (layer: string) => {
  switch (layer) {
    case 'graph':
      return 'Toda la red'
    case 'followers':
      return 'Me siguen'
    case 'following':
      return 'A quienes sigo'
    case 'mutuals':
      return 'Mutuos'
    case 'connections':
      return 'Conexiones'
    case 'following-non-followers':
      return 'Sin reciprocidad saliente'
    case 'nonreciprocal-followers':
      return 'Sin reciprocidad entrante'
    case 'zaps':
      return 'Zaps'
    case 'pathfinding':
      return 'Camino'
    default:
      return layer
  }
}

const translateImageQualityMode = (mode: ImageQualityMode) => {
  switch (mode) {
    case 'performance':
      return 'performance'
    case 'adaptive':
      return 'adaptativa'
    case 'quality':
      return 'calidad'
    case 'full-hd':
      return 'full HD'
    default:
      return mode
  }
}

const translateRelayStatus = (status: RelayHealthStatus) => {
  switch (status) {
    case 'connected':
      return 'Conectado'
    case 'partial':
      return 'Parcial'
    case 'degraded':
      return 'Degradado'
    case 'offline':
      return 'Offline'
    default:
      return 'Sin dato'
  }
}

const COUNT_UNSUPPORTED_RELAY_NOTICE = 'COUNT no soportado por este relay'
const COUNT_UNSUPPORTED_NOTICE_PATTERNS = [
  'unknown cmd',
  'does not support nip-45',
  'count unsupported',
  'count not supported',
  'count no soportado',
]

const translateRelayNotice = (notice: string | null | undefined) => {
  const trimmed = notice?.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed.toLowerCase()
  if (
    COUNT_UNSUPPORTED_NOTICE_PATTERNS.some((pattern) =>
      normalized.includes(pattern),
    )
  ) {
    return COUNT_UNSUPPORTED_RELAY_NOTICE
  }

  return trimmed
}

const formatRelayEndpointDetail = (
  endpoint:
    | CanonicalGraphUiState['relayState']['endpoints'][string]
    | undefined,
) =>
  translateRelayNotice(endpoint?.lastNotice) ||
  (endpoint?.lastCheckedAt
    ? `Ultima revision ${new Date(endpoint.lastCheckedAt).toLocaleTimeString('es-AR')}`
    : 'Sin aviso reciente')

const formatToneLabel = (tone: RuntimeInspectorTone) => {
  switch (tone) {
    case 'ok':
      return 'Verde'
    case 'warn':
      return 'Amarillo'
    case 'bad':
      return 'Rojo'
    default:
      return 'Gris'
  }
}

const translateAvatarReason = (reason: string | null | undefined) => {
  if (!reason) {
    return 'Sin motivo reportado'
  }

  const normalized = reason.toLowerCase()

  if (normalized === 'cache_miss') {
    return 'Todavia no hay bitmap en cache'
  }
  if (normalized === 'cache_loading') {
    return 'La foto esta cargando'
  }
  if (normalized === 'cache_warmup') {
    return 'La foto espera warmup de cache'
  }
  if (normalized === 'cache_failed') {
    return 'La cache marco una falla reutilizable'
  }
  if (normalized === 'not_selected_for_image') {
    return 'No fue seleccionada por presupuesto visual'
  }
  if (normalized === 'global_motion_active') {
    return 'Se degrado por movimiento global'
  }
  if (normalized === 'fast_moving') {
    return 'Se degrado por movimiento del nodo'
  }
  if (normalized === 'monogram_only') {
    return 'Monograma intencional por zoom'
  }
  if (normalized === 'image_draw_cap') {
    return 'Se alcanzo el limite de fotos por frame'
  }
  if (normalized === 'missing_url') {
    return 'El perfil no trae URL de foto'
  }
  if (normalized === 'unresolved_host') {
    return 'No se pudo resolver el host de la imagen'
  }
  if (normalized.startsWith('http_')) {
    return `El servidor respondio ${normalized.slice(5)}`
  }
  if (normalized.includes('403')) {
    return 'El servidor rechazo la imagen'
  }
  if (normalized.includes('404')) {
    return 'La imagen ya no existe en origen'
  }
  if (normalized.includes('proxy')) {
    return 'Fallo la ruta por proxy'
  }
  if (normalized.includes('direct')) {
    return 'Fallo la ruta directa'
  }
  if (normalized.includes('blocked')) {
    return 'La carga quedo bloqueada temporalmente'
  }
  if (normalized.includes('fast') || normalized.includes('motion')) {
    return 'Se degrado por movimiento'
  }
  if (normalized.includes('zoom')) {
    return 'Quedo fuera por zoom'
  }
  if (normalized.includes('size')) {
    return 'Quedo fuera por tamano en pantalla'
  }
  if (normalized.includes('picture')) {
    return 'No hay foto utilizable'
  }
  if (normalized.includes('cache')) {
    return 'La cache marco una falla reutilizable'
  }
  if (normalized.includes('safe')) {
    return 'La URL no paso la validacion de seguridad'
  }
  return `Motivo interno: ${reason}`
}

const toneForAvatarReason = (label: string): RuntimeInspectorTone => {
  const normalized = label.toLowerCase()
  if (
    normalized.includes('todavia no hay bitmap') ||
    normalized.includes('esta cargando') ||
    normalized.includes('espera warmup') ||
    normalized.includes('presupuesto visual') ||
    normalized.includes('no trae url') ||
    normalized.includes('no hay foto') ||
    normalized.includes('fuera por zoom') ||
    normalized.includes('fuera por tamano') ||
    normalized.includes('movimiento') ||
    normalized.includes('monograma intencional')
  ) {
    return 'neutral'
  }
  return 'warn'
}

const isExternalAvatarFailureReason = (reason: string | null | undefined) => {
  if (!reason) {
    return false
  }

  const normalized = reason.toLowerCase()
  return (
    normalized === 'unresolved_host' ||
    normalized.startsWith('http_') ||
    normalized.includes('safe') ||
    normalized.includes('403') ||
    normalized.includes('404') ||
    normalized.includes('410') ||
    normalized.includes('451')
  )
}

const classifyProfileState = (
  pubkey: string,
  nodesByPubkey: CanonicalGraphSceneState['nodesByPubkey'],
) => {
  const node = nodesByPubkey[pubkey]
  if (!node) {
    return 'unknown'
  }
  if (node.profileState === 'ready') {
    return hasUsableCanonicalProfile(node) ? 'readyUsable' : 'readyEmpty'
  }
  return node.profileState
}

const countVisibleProfileStates = (
  visiblePubkeys: readonly string[],
  nodesByPubkey: CanonicalGraphSceneState['nodesByPubkey'],
) => {
  const counts = {
    idle: 0,
    loading: 0,
    readyUsable: 0,
    readyEmpty: 0,
    missing: 0,
    unknown: 0,
  }

  for (const pubkey of visiblePubkeys) {
    const state = classifyProfileState(pubkey, nodesByPubkey)
    counts[state] += 1
  }

  return counts
}

const pushReasonCounts = (
  target: Map<string, number>,
  input: Record<string, number> | undefined,
  translate: (reason: string | null | undefined) => string,
) => {
  for (const [reason, count] of Object.entries(input ?? {})) {
    const key = translate(reason)
    target.set(key, (target.get(key) ?? 0) + count)
  }
}

const rankReasons = (map: Map<string, number>): RuntimeInspectorMetric[] =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label, value]) => ({
      label,
      value: formatInteger(value),
      tone: toneForAvatarReason(label),
    }))

const BENIGN_AVATAR_SAMPLE_REASONS = new Set([
  'cache_miss',
  'cache_loading',
  'cache_warmup',
  'not_selected_for_image',
  'global_motion_active',
  'fast_moving',
  'monogram_only',
  'zoom_threshold',
  'image_draw_cap',
])

const isBenignAvatarSampleReason = (reason: string | null | undefined) => {
  if (!reason) {
    return true
  }
  return BENIGN_AVATAR_SAMPLE_REASONS.has(reason.toLowerCase())
}

type RuntimeAvatarNodeSnapshot = NonNullable<
  AvatarRuntimeStateDebugSnapshot['overlay']
>['nodes'][number]

const selectProblematicAvatarReason = (node: RuntimeAvatarNodeSnapshot) =>
  node.blockReason ??
  node.cacheFailureReason ??
  (!isBenignAvatarSampleReason(node.drawFallbackReason)
    ? node.drawFallbackReason
    : null) ??
  (!isBenignAvatarSampleReason(node.disableImageReason)
    ? node.disableImageReason
    : null) ??
  (!isBenignAvatarSampleReason(node.loadSkipReason)
    ? node.loadSkipReason
    : null)

const isVisibleAvatarNodeAffected = (node: RuntimeAvatarNodeSnapshot) =>
  node.hasPictureUrl &&
  (node.blocked ||
    node.cacheState === 'failed' ||
    selectProblematicAvatarReason(node) !== null)

const visibleAvatarFailureLooksExternal = (node: RuntimeAvatarNodeSnapshot) =>
  isExternalAvatarFailureReason(selectProblematicAvatarReason(node))

const toneRank = (tone: RuntimeInspectorTone) => {
  switch (tone) {
    case 'bad':
      return 3
    case 'warn':
      return 2
    case 'ok':
      return 1
    default:
      return 0
  }
}

const primaryToneRank = (
  id: RuntimeInspectorSummaryItem['id'],
  section: {
    tone: RuntimeInspectorTone
    resumen: string
  },
) => {
  if (
    id === 'coverage' &&
    COVERAGE_PROJECTION_ONLY_SUMMARIES.has(section.resumen)
  ) {
    return toneRank('neutral')
  }
  return toneRank(section.tone)
}

const buildCoverageSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorCoverageSection => {
  const progress = input.uiState.rootLoad.visibleLinkProgress
  const expectedFollowers = progress?.followers.totalCount ?? null
  const expectedApproximate =
    progress?.followers.totalCount !== null &&
    progress?.followers.isTotalKnown === false
  const followerCountInGraph = progress?.followers.loadedCount ?? 0
  const inboundCandidateEvents = progress?.inboundCandidateEventCount ?? 0
  const layerLabel = translateLayer(input.sceneState.activeLayer)
  const relays = input.uiState.relayState.urls.map((relayUrl) => {
    const endpoint = input.uiState.relayState.endpoints[relayUrl]
    return {
      relay: compactRelay(relayUrl),
      estado: translateRelayStatus(endpoint?.status ?? 'unknown'),
      detalle: formatRelayEndpointDetail(endpoint),
    }
  })

  const activeLayerFiltersFollowers =
    input.sceneState.activeLayer !== 'graph' &&
    input.sceneState.activeLayer !== 'followers'
  const coverageLooksComplete =
    expectedFollowers !== null && followerCountInGraph >= expectedFollowers
  const visibleNodeCount = input.scene.render.diagnostics.nodeCount
  const activeLayerIsHidingLoadedFollowers =
    activeLayerFiltersFollowers && visibleNodeCount < followerCountInGraph

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Cobertura consistente'
  let quePasaAhora =
    'La evidencia inbound y los followers integrados no muestran un desbalance fuerte para la carga actual.'
  let queLeerAhora =
    'Revisa relays si esperabas un numero mayor, o cambia a la capa "Me siguen" para aislar followers.'

  if (
    expectedFollowers !== null &&
    followerCountInGraph < Math.max(5, Math.floor(expectedFollowers * 0.35))
  ) {
    tone = 'bad'
    resumen = 'Cobertura incompleta'
    quePasaAhora =
      inboundCandidateEvents === 0
        ? 'COUNT sugiere followers, pero casi no llego evidencia inbound.'
        : 'La evidencia inbound llego, pero el grafo todavia integra muchos menos followers de los esperados.'
    queLeerAhora =
      input.graphSummary.capReached
        ? 'Abre Relays y revisa tambien el cap de nodos: el runtime puede estar recortando cobertura.'
        : 'Abre Relays para ver si faltan consultas utiles o si la carga sigue parcial.'
  } else if (input.graphSummary.capReached) {
    tone = 'warn'
    resumen = 'Cobertura recortada por cap'
    quePasaAhora =
      'El runtime alcanzo el cap de nodos y puede estar dejando followers afuera aunque haya evidencia disponible.'
    queLeerAhora =
      'Abre Cobertura y Relays para confirmar si el recorte es local o si tambien falta fetch.'
  } else if (activeLayerIsHidingLoadedFollowers) {
    tone = 'warn'
    resumen = 'La capa actual filtra nodos cargados'
    quePasaAhora = `La evidencia inbound esta integrada, pero estas mirando "${layerLabel}" y esa capa muestra ${formatInteger(visibleNodeCount)} de ${formatInteger(followerCountInGraph)} followers cargados.`
    queLeerAhora =
      'Cambia a "Me siguen" o "Toda la red" para confirmar que no faltan nodos: la diferencia actual parece de proyeccion visual.'
  } else if (
    !coverageLooksComplete &&
    (input.uiState.rootLoad.status === 'loading' ||
      input.uiState.rootLoad.status === 'partial')
  ) {
    tone = 'warn'
    resumen = 'Cobertura todavia parcial'
    quePasaAhora =
      'La carga root sigue abierta o quedo en estado parcial. Lo visible todavia no representa todo el alcance posible.'
    queLeerAhora =
      'Abre Carga Root para ver en que etapa sigue la integracion.'
  } else if (activeLayerFiltersFollowers) {
    tone = 'warn'
    resumen = 'La capa actual puede ocultar followers'
    quePasaAhora = `Estas mirando "${layerLabel}", una vista que puede filtrar followers ya cargados.`
    queLeerAhora =
      'Abre Cobertura o cambia a "Me siguen" para comparar followers integrados contra lo visible.'
  }

  return {
    tone,
    titulo: 'Cobertura',
    resumen,
    estado:
      expectedFollowers !== null
        ? `${formatInteger(followerCountInGraph)} de ${expectedApproximate ? '~' : ''}${formatInteger(expectedFollowers)}`
        : `${formatInteger(followerCountInGraph)} followers en grafo`,
    queSignifica:
      'Explica si faltan nodos antes del fetch, durante la integracion o solo en la vista actual.',
    quePasaAhora,
    queLeerAhora,
    cadena: [
      {
        label: 'Esperado inbound',
        value:
          expectedFollowers === null
            ? 'sin total confirmado'
            : `${expectedApproximate ? '~' : ''}${formatInteger(expectedFollowers)}`,
        tone:
          expectedFollowers !== null && followerCountInGraph < expectedFollowers
            ? 'warn'
            : 'ok',
      },
      {
        label: 'Eventos candidatos',
        value: formatInteger(inboundCandidateEvents),
        tone: inboundCandidateEvents === 0 ? 'warn' : 'ok',
      },
      {
        label: 'Followers en grafo',
        value: formatInteger(followerCountInGraph),
        tone:
          expectedFollowers !== null &&
          followerCountInGraph < Math.max(5, expectedFollowers * 0.35)
            ? 'bad'
            : 'ok',
      },
      {
        label: 'Nodos en pantalla',
        value: formatInteger(visibleNodeCount),
        tone: activeLayerIsHidingLoadedFollowers ? 'warn' : 'ok',
      },
      {
        label: 'Capa actual',
        value: layerLabel,
        tone: activeLayerIsHidingLoadedFollowers ? 'warn' : 'neutral',
      },
      {
        label: 'Cap de nodos',
        value: `${formatInteger(input.graphSummary.nodeCount)} / ${formatInteger(input.graphSummary.maxNodes)}`,
        tone: input.graphSummary.capReached ? 'bad' : 'ok',
      },
    ],
    relays,
    notas: [
      input.graphSummary.capReached
        ? 'El cap de nodos ya esta alcanzado y puede explicar recorte local.'
        : 'El cap de nodos no aparece como cuello principal.',
      coverageLooksComplete && input.uiState.rootLoad.status === 'partial'
        ? 'La carga root sigue parcial, pero la cobertura inbound medida ya coincide con lo esperado.'
        : input.uiState.rootLoad.message?.trim() || 'Sin mensaje adicional de carga root.',
    ],
  }
}

const buildProfilesSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorProfilesSection => {
  const visiblePubkeys =
    input.visibleProfileWarmup?.viewportPubkeyCount !== undefined
      ? input.visibleNodePubkeys
      : input.scene.render.nodes.map((node) => node.pubkey)
  const fallbackCounts = countVisibleProfileStates(
    visiblePubkeys,
    input.sceneState.nodesByPubkey,
  )
  const viewportCounts =
    input.visibleProfileWarmup?.viewportProfileStates ?? fallbackCounts
  const visibleCount =
    input.visibleProfileWarmup?.viewportPubkeyCount ?? visiblePubkeys.length
  const readyUsable = viewportCounts.readyUsable
  const idleCount = viewportCounts.idle
  const incompleteCount =
    visibleCount - readyUsable - viewportCounts.unknown

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Perfiles visibles estables'
  let quePasaAhora =
    'La mayoria de los nodos visibles ya tienen perfil utilizable o el backlog actual es manejable.'
  let queLeerAhora =
    'Abre Perfiles si ves pubkeys crudas o si el detalle de un nodo resuelve mejor que la vista general.'

  if (visibleCount > 0 && readyUsable < Math.max(4, Math.floor(visibleCount * 0.35))) {
    tone = 'bad'
    resumen = 'Muchos nodos siguen solo con pubkey'
    quePasaAhora =
      idleCount > 0
        ? 'Hay muchos nodos visibles que existen en el grafo, pero siguen en idle o sin perfil utilizable.'
        : 'El runtime tiene nodos visibles sin perfil utilizable suficiente para mostrarlos bien.'
    queLeerAhora =
      'Abre Perfiles para revisar warmup visible, cooldown e inflight. Si al abrir detalle se arreglan, el cuello esta en hidratacion general.'
  } else if (incompleteCount > 0) {
    tone = 'warn'
    resumen = 'Todavia hay perfiles pendientes'
    quePasaAhora =
      'La hidratacion visible sigue corriendo y todavia quedan nodos en loading, empty o missing.'
    queLeerAhora =
      'Abre Perfiles para ver si el backlog viene de cooldown, batch limit o faltantes reales.'
  }

  return {
    tone,
    titulo: 'Perfiles',
    resumen,
    estado: `${formatInteger(readyUsable)} listos / ${formatInteger(visibleCount)} visibles`,
    queSignifica:
      'Explica por que un nodo puede existir en el grafo, pero seguir mostrando solo pubkey o un perfil vacio.',
    quePasaAhora,
    queLeerAhora,
    metricas: [
      { label: 'Ready usable', value: formatInteger(viewportCounts.readyUsable), tone: 'ok' },
      { label: 'Idle', value: formatInteger(viewportCounts.idle), tone: viewportCounts.idle > 0 ? 'warn' : 'ok' },
      { label: 'Loading', value: formatInteger(viewportCounts.loading), tone: viewportCounts.loading > 0 ? 'warn' : 'ok' },
      { label: 'Ready empty', value: formatInteger(viewportCounts.readyEmpty), tone: viewportCounts.readyEmpty > 0 ? 'warn' : 'neutral' },
      { label: 'Missing', value: formatInteger(viewportCounts.missing), tone: viewportCounts.missing > 0 ? 'warn' : 'neutral' },
      {
        label: 'Elegibles para warmup',
        value: formatInteger(input.visibleProfileWarmup?.eligibleCount ?? 0),
        tone:
          (input.visibleProfileWarmup?.eligibleCount ?? 0) > 0 ? 'warn' : 'ok',
      },
      {
        label: 'Salteados por cooldown',
        value: formatInteger(input.visibleProfileWarmup?.skipped.cooldown ?? 0),
        tone:
          (input.visibleProfileWarmup?.skipped.cooldown ?? 0) > 0
            ? 'warn'
            : 'neutral',
      },
      {
        label: 'En inflight',
        value: formatInteger(input.visibleProfileWarmup?.inflightCount ?? 0),
        tone:
          (input.visibleProfileWarmup?.inflightCount ?? 0) > 0
            ? 'warn'
            : 'neutral',
      },
    ],
    notas: [
      input.visibleProfileWarmup
        ? `Batch visible actual: ${formatInteger(input.visibleProfileWarmup.pubkeys.length)} nodos seleccionados.`
        : 'Todavia no hay snapshot de warmup visible.',
      'Si abrir un nodo resuelve mas rapido que la vista general, el problema suele estar en la hidratacion visible y no en la existencia del nodo.',
    ],
  }
}

const collectAvatarSamples = (
  snapshot: AvatarRuntimeStateDebugSnapshot | null,
) => {
  const nodes = snapshot?.overlay?.nodes ?? []
  const problematicNodes = nodes
    .map((node) => {
      if (!node.hasPictureUrl) {
        return null
      }
      const reason = selectProblematicAvatarReason(node)

      return reason ? { node, reason } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return problematicNodes.slice(0, 6).map(({ node, reason }) => ({
    nodo: node.label?.trim() || compactPubkey(node.pubkey),
    causa: translateAvatarReason(reason),
  }))
}

const buildAvatarSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorAvatarsSection => {
  const snapshot = input.avatarRuntimeSnapshot
  const cache = snapshot?.cache
  const loader = snapshot?.loader
  const overlay = snapshot?.overlay
  const failedCount = cache?.byState.failed ?? 0
  const blockedCount = loader?.blockedCount ?? 0
  const withPictureMonograms = overlay?.counts.withPictureMonogramDraws ?? 0
  const visibleFailedNodes =
    overlay?.nodes.filter(
      (node) => node.hasPictureUrl && node.cacheState === 'failed',
    ) ?? []
  const visibleFailedCount = visibleFailedNodes.length
  const visibleBlockedCount =
    overlay?.nodes.filter((node) => node.hasPictureUrl && node.blocked).length ?? 0
  const visibleAffectedNodes =
    overlay?.nodes.filter(isVisibleAvatarNodeAffected) ?? []
  const visibleAffectedCount = visibleAffectedNodes.length
  const visibleExternalFailureCount = visibleAffectedNodes.filter(
    visibleAvatarFailureLooksExternal,
  ).length
  const visiblePipelineAffectedCount =
    visibleAffectedCount - visibleExternalFailureCount
  const visibleExternalFailedCount = visibleFailedNodes.filter(
    visibleAvatarFailureLooksExternal,
  ).length
  const visiblePipelineFailedCount =
    visibleFailedCount - visibleExternalFailedCount
  const cacheEntryCount =
    (cache?.byState.ready ?? 0) +
    (cache?.byState.loading ?? 0) +
    (cache?.byState.failed ?? 0)
  const globalFailureIsHigh =
    failedCount > Math.max(8, Math.floor(cacheEntryCount * 0.08))

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Avatares estables'
  let quePasaAhora =
    'La cache, el loader y el draw actual no muestran una cantidad importante de fallas visibles.'
  let queLeerAhora =
    'Abre Avatares si ves monogramas inesperados o fotos que nunca terminan de aparecer.'

  if (!snapshot) {
    tone = 'neutral'
    resumen = 'Sin snapshot de avatares'
    quePasaAhora =
      'El host de Sigma todavia no expuso un snapshot de runtime para avatares.'
    queLeerAhora =
      'Espera a que el grafo termine de montar y vuelve a abrir Avatares.'
  } else if (
    visiblePipelineAffectedCount >= 5 ||
    visibleBlockedCount >= 5 ||
    withPictureMonograms >= 5
  ) {
    tone = 'bad'
    resumen = 'Hay fallas visibles de avatares'
    quePasaAhora =
      'Hay varias cuentas visibles con foto disponible afectadas por bloqueo, cache fallida interna o degradacion a monograma.'
    queLeerAhora =
      'Abre Avatares y revisa si el loader, cache o renderer estan degradando fotos que deberian dibujarse.'
  } else if (visibleAffectedCount >= 5) {
    tone = 'warn'
    resumen = 'Fotos externas fallidas'
    quePasaAhora =
      'Las fotos visibles fallidas apuntan a URLs externas rotas, bloqueadas o inseguras. El loader y el renderer no aparecen como cuello principal.'
    queLeerAhora =
      'Abre Avatares para ver que cuentas tienen 404, 403, host caido o URL bloqueada por seguridad.'
  } else if (visibleAffectedCount > 0) {
    tone = 'warn'
    resumen = 'Algunas fotos visibles necesitan atencion'
    quePasaAhora =
      'Hay pocos casos visibles afectados. Es util revisarlos, pero no parece un cuello principal del runtime.'
    queLeerAhora =
      'Abre Avatares y revisa los casos de muestra antes de asumir un fallo general.'
  } else if (globalFailureIsHigh || blockedCount > 0) {
    tone = 'warn'
    resumen = 'Hay fallas globales de avatares'
    quePasaAhora =
      'La cache o el loader reportan fallas acumuladas, pero no aparecen afectando nodos visibles ahora.'
    queLeerAhora =
      'Abre Avatares si queres ver si son hosts rotos, 403, 404 o fallas transitorias.'
  } else if (failedCount > 0) {
    tone = 'warn'
    resumen = 'Fallas aisladas fuera del foco visible'
    quePasaAhora =
      'Hay algunas fallas acumuladas en cache, pero las fotos visibles estan dibujando bien.'
    queLeerAhora =
      'No lo trates como problema principal salvo que aparezcan casos visibles en la tabla.'
  } else if (withPictureMonograms > 0) {
    tone = 'warn'
    resumen = 'Algunas cuentas con foto terminan en monograma'
    quePasaAhora =
      'Hay nodos con picture disponible que igual degradan a monograma por movimiento, presupuesto o decision de draw.'
    queLeerAhora =
      'Abre Avatares para ver si la causa es movimiento, zoom, tamano o fallback de draw.'
  }

  const reasons = new Map<string, number>()
  pushReasonCounts(
    reasons,
    Object.fromEntries(
      Object.entries((cache?.entries ?? []).reduce<Record<string, number>>((acc, entry) => {
        if (entry.state === 'failed') {
          const key = entry.reason ?? 'cache_failed'
          acc[key] = (acc[key] ?? 0) + 1
        }
        return acc
      }, {})),
    ),
    translateAvatarReason,
  )
  pushReasonCounts(
    reasons,
    (loader?.blocked ?? []).reduce<Record<string, number>>((acc, entry) => {
      const key = entry.reason ?? 'blocked'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
    translateAvatarReason,
  )
  pushReasonCounts(reasons, overlay?.byDrawFallbackReason, translateAvatarReason)
  pushReasonCounts(reasons, overlay?.byDisableReason, translateAvatarReason)
  pushReasonCounts(reasons, overlay?.byLoadSkipReason, translateAvatarReason)

  return {
    tone,
    titulo: 'Avatares',
    resumen,
    estado: `${formatInteger(visibleAffectedCount)} visibles afectadas / ${formatInteger(failedCount)} fallas cache`,
    queSignifica:
      'Explica si una foto falta porque no existe, porque fallo el fetch o porque el renderer la degrado a monograma.',
    quePasaAhora,
    queLeerAhora,
    metricas: [
      { label: 'Fotos dibujadas', value: formatInteger(overlay?.counts.drawnImages ?? 0), tone: 'ok' },
      { label: 'Monogramas con foto', value: formatInteger(withPictureMonograms), tone: withPictureMonograms > 0 ? 'warn' : 'ok' },
      { label: 'Cache ready', value: formatInteger(cache?.byState.ready ?? 0), tone: 'ok' },
      { label: 'Cache failed', value: formatInteger(failedCount), tone: visiblePipelineFailedCount > 0 ? 'bad' : failedCount > 0 ? 'warn' : 'ok' },
      { label: 'Loader blocked', value: formatInteger(blockedCount), tone: visibleBlockedCount > 0 ? 'bad' : blockedCount > 0 ? 'warn' : 'ok' },
      { label: 'Visibles afectadas', value: formatInteger(visibleAffectedCount), tone: visiblePipelineAffectedCount >= 5 ? 'bad' : visibleAffectedCount > 0 ? 'warn' : 'ok' },
      {
        label: 'FPS EMA',
        value: formatFpsWithFrameMs(input.avatarPerfSnapshot?.emaFrameMs),
        tone:
          input.avatarPerfSnapshot && input.avatarPerfSnapshot.emaFrameMs > 22
            ? 'warn'
            : 'ok',
      },
    ],
    razones: rankReasons(reasons),
    casos: collectAvatarSamples(snapshot),
  }
}

const buildZapSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorZapsSection => {
  const { zapSummary } = input
  const pausedByVisibleLimit =
    input.liveZapFeedback?.toLowerCase().includes('supera el limite') ?? false

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Zaps disponibles'
  let quePasaAhora =
    'La capa de zaps tiene edges listos o no muestra un bloqueo evidente del feed live.'
  let queLeerAhora =
    'Abre Zaps si esperabas animacion live y no la ves, o si el edge count no coincide con lo esperado.'

  if (!input.showZaps) {
    tone = 'warn'
    resumen = 'Los zaps estan ocultos'
    quePasaAhora =
      'La UI tiene apagada la visualizacion de zaps. El runtime puede tener datos, pero no se estan dibujando.'
    queLeerAhora = 'Activa zaps desde el rail o desde Ajustes.'
  } else if (pausedByVisibleLimit) {
    tone = 'warn'
    resumen = 'Feed live pausado'
    quePasaAhora =
      input.liveZapFeedback ??
      'El feed live de zaps se pauso porque hay demasiados nodos visibles.'
    queLeerAhora =
      'Reduce la vista visible si queres zaps live. No es un fallo de decode: es un limite operativo para proteger performance.'
  } else if (zapSummary.skippedReceipts > 0) {
    tone = 'warn'
    resumen = 'Hay recibos de zap omitidos'
    quePasaAhora =
      'Llegaron recibos, pero una parte quedo fuera durante el decode o la persistencia.'
    queLeerAhora =
      'Abre Zaps para comparar recibos omitidos contra edges finales.'
  } else if (
    zapSummary.status === 'loading' ||
    zapSummary.status === 'unavailable' ||
    zapSummary.edgeCount === 0
  ) {
    tone = 'warn'
    resumen = 'Zaps sin evidencia util'
    quePasaAhora =
      zapSummary.message?.trim() ||
      'La capa de zaps no encontro evidencia utilizable todavia.'
    queLeerAhora =
      'Abre Zaps y revisa si falta suscripcion live, decode o si simplemente no hay actividad en los nodos objetivo.'
  }

  return {
    tone,
    titulo: 'Zaps',
    resumen,
    estado: `${formatInteger(zapSummary.edgeCount)} edges`,
    queSignifica:
      'Explica si los zaps fallan en suscripcion, decode, persistencia o solo en la capa visual.',
    quePasaAhora,
    queLeerAhora,
    cadena: [
      {
        label: 'Visualizacion',
        value: input.showZaps ? 'Activa' : 'Oculta',
        tone: input.showZaps ? 'ok' : 'warn',
      },
      {
        label: 'Estado live',
        value: pausedByVisibleLimit
          ? 'Pausado por limite visible'
          : input.liveZapFeedback?.trim()
            ? input.liveZapFeedback
            : 'Sin bloqueo visible',
        tone: pausedByVisibleLimit ? 'warn' : 'ok',
      },
      {
        label: 'Estado de capa',
        value: zapSummary.status,
        tone:
          zapSummary.status === 'enabled'
            ? 'ok'
            : zapSummary.status === 'loading'
              ? 'warn'
              : 'bad',
      },
      {
        label: 'Targets actuales',
        value: formatInteger(zapSummary.targetCount),
        tone: zapSummary.targetCount === 0 ? 'warn' : 'ok',
      },
      {
        label: 'Recibos omitidos',
        value: formatInteger(zapSummary.skippedReceipts),
        tone: zapSummary.skippedReceipts > 0 ? 'warn' : 'ok',
      },
      {
        label: 'Origen',
        value:
          zapSummary.loadedFrom === 'none'
            ? 'Sin datos'
            : zapSummary.loadedFrom === 'cache'
              ? 'Cache'
              : 'Live',
        tone: zapSummary.loadedFrom === 'live' ? 'ok' : 'neutral',
      },
    ],
    notas: [
      zapSummary.message?.trim() || 'Sin mensaje adicional de la capa de zaps.',
      input.liveZapFeedback?.trim() || 'Sin feedback extra del feed live.',
    ],
  }
}

const intensityFromTone = (
  tone: RuntimeInspectorTone,
): RuntimeInspectorResourceMode['intensidad'] => {
  if (tone === 'bad') {
    return 'alta'
  }
  if (tone === 'warn') {
    return 'media'
  }
  return 'baja'
}

const buildResourceTop = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorResourceMode[] => {
  const visibleNodeCount =
    input.scene.render.diagnostics.nodeCount || input.scene.render.nodes.length
  const visibleEdgeCount =
    input.scene.render.diagnostics.visibleEdgeCount ||
    input.scene.render.visibleEdges.length
  const physicsNodeCount =
    input.scene.physics.diagnostics.nodeCount || input.scene.physics.nodes.length
  const physicsEdgeCount =
    input.scene.physics.diagnostics.edgeCount || input.scene.physics.edges.length
  const avatarOverlay = input.avatarRuntimeSnapshot?.overlay ?? null
  const avatarBudget = avatarOverlay?.resolvedBudget ?? null
  const avatarCounts = avatarOverlay?.counts ?? null
  const cacheBytes = input.avatarRuntimeSnapshot?.cache?.totalBytes ?? 0
  const overlapCount = input.physicsDiagnostics?.approximateOverlapCount ?? 0
  const visibleWarmup = input.visibleProfileWarmup
  const rootProgress = input.uiState.rootLoad.visibleLinkProgress

  const graphLayerScore =
    visibleNodeCount * 2 +
    visibleEdgeCount * 1.5 +
    (input.sceneState.activeLayer === 'graph' ? input.graphSummary.nodeCount : 0)
  const graphLayerTone: RuntimeInspectorTone =
    visibleNodeCount > 1600 || visibleEdgeCount > 3600
      ? 'bad'
      : visibleNodeCount > 700 || visibleEdgeCount > 1400
        ? 'warn'
        : 'ok'

  const physicsActive =
    input.physicsEnabled &&
    (input.physicsDiagnostics?.running ?? input.avatarRuntimeSnapshot?.physicsRunning ?? true)
  const physicsScore = input.physicsEnabled
    ? physicsNodeCount * 1.3 +
      physicsEdgeCount * 2 +
      overlapCount * 20 +
      (physicsActive ? 650 : 160)
    : 0
  const physicsTone: RuntimeInspectorTone = !input.physicsEnabled
    ? 'neutral'
    : physicsEdgeCount > 2200 || overlapCount > 120
      ? 'bad'
      : physicsEdgeCount > 800 || overlapCount > 0 || physicsActive
        ? 'warn'
        : 'ok'

  const drawnImages = avatarCounts?.drawnImages ?? 0
  const loadCandidates = avatarCounts?.loadCandidates ?? 0
  const pendingCandidates = avatarCounts?.pendingCandidates ?? 0
  const avatarBucket = avatarBudget?.maxBucket ?? input.avatarPerfSnapshot?.budget.maxBucket ?? 0
  const imageQualityWeight =
    input.imageQualityMode === 'full-hd'
      ? 650
      : input.imageQualityMode === 'quality'
        ? 420
        : input.imageQualityMode === 'adaptive'
          ? 180
          : 70
  const avatarScore =
    drawnImages * 18 +
    loadCandidates * 7 +
    pendingCandidates * 10 +
    avatarBucket * 2 +
    cacheBytes / 32_768 +
    (avatarBudget?.showAllVisibleImages ? 360 : 0) +
    imageQualityWeight
  const avatarTone: RuntimeInspectorTone =
    drawnImages > 90 || avatarBucket >= 512
      ? 'bad'
      : drawnImages > 45 || loadCandidates > 120 || pendingCandidates > 40
        ? 'warn'
        : avatarScore > 0
          ? 'ok'
          : 'neutral'

  const zapsActive =
    input.showZaps &&
    (input.zapSummary.status === 'enabled' || input.zapSummary.status === 'loading')
  const zapsScore = zapsActive
    ? input.zapSummary.targetCount * 1.2 +
      input.zapSummary.edgeCount * 2 +
      input.zapSummary.skippedReceipts * 3 +
      (input.zapSummary.loadedFrom === 'live' ? 260 : 90)
    : 0
  const zapsTone: RuntimeInspectorTone = !zapsActive
    ? 'neutral'
    : input.zapSummary.targetCount > 256 || input.zapSummary.edgeCount > 1800
      ? 'bad'
      : input.zapSummary.targetCount > 96 || input.zapSummary.edgeCount > 500
        ? 'warn'
        : 'ok'

  const warmupLoading = visibleWarmup?.profileStates.loading ?? 0
  const warmupIdle = visibleWarmup?.profileStates.idle ?? 0
  const warmupEligible = visibleWarmup?.eligibleCount ?? 0
  const profilesScore = visibleWarmup
    ? warmupEligible * 4 +
      visibleWarmup.inflightCount * 24 +
      warmupLoading * 10 +
      warmupIdle * 2 +
      visibleWarmup.pubkeys.length * 16
    : 0
  const profilesTone: RuntimeInspectorTone = !visibleWarmup
    ? 'neutral'
    : visibleWarmup.inflightCount > 12 || warmupLoading > 180
      ? 'bad'
      : visibleWarmup.inflightCount > 0 || warmupEligible > 80
        ? 'warn'
        : 'ok'

  const rootLoadedCount =
    (rootProgress?.following.loadedCount ?? 0) +
    (rootProgress?.followers.loadedCount ?? 0)
  const rootLoadActive =
    input.uiState.rootLoad.status === 'loading' ||
    input.uiState.rootLoad.status === 'partial'
  const rootLoadScore = rootLoadActive
    ? rootLoadedCount * 0.7 +
      (rootProgress?.contactListEventCount ?? 0) * 6 +
      (rootProgress?.inboundCandidateEventCount ?? 0) * 0.4 +
      220
    : 0
  const rootLoadTone: RuntimeInspectorTone = !rootLoadActive
    ? 'neutral'
    : rootLoadedCount > 2500 || (rootProgress?.inboundCandidateEventCount ?? 0) > 2500
      ? 'bad'
      : 'warn'

  const rows = [
    {
      id: 'graph-layer' as const,
      score: graphLayerScore,
      titulo: `Capa ${translateLayer(input.sceneState.activeLayer)}`,
      valor: `${formatInteger(visibleNodeCount)} nodos / ${formatInteger(visibleEdgeCount)} aristas`,
      detalle:
        input.sceneState.activeLayer === 'graph'
          ? 'Renderiza la red completa visible; suele ser la capa mas pesada.'
          : 'Renderiza una proyeccion filtrada; el costo sube con nodos y aristas visibles.',
      tone: graphLayerTone,
    },
    {
      id: 'physics' as const,
      score: physicsScore,
      titulo: 'Fisica del layout',
      valor: input.physicsEnabled
        ? `${formatInteger(physicsNodeCount)} nodos / ${formatInteger(physicsEdgeCount)} aristas`
        : 'pausada',
      detalle: input.physicsEnabled
        ? `Estado ${physicsActive ? 'corriendo' : 'habilitado'}; overlap aprox. ${formatInteger(overlapCount)}.`
        : 'Sin consumo activo mientras esta pausada.',
      tone: physicsTone,
    },
    {
      id: 'avatars' as const,
      score: avatarScore,
      titulo: 'Fotos y avatares',
      valor: `${formatInteger(drawnImages)} fotos/frame`,
      detalle: `Modo ${translateImageQualityMode(input.imageQualityMode)}, bucket ${avatarBucket || 'sin dato'} px, cache ${formatBytes(cacheBytes)}.`,
      tone: avatarTone,
    },
    {
      id: 'zaps' as const,
      score: zapsScore,
      titulo: 'Zaps live',
      valor: zapsActive
        ? `${formatInteger(input.zapSummary.targetCount)} targets`
        : 'inactivo',
      detalle: zapsActive
        ? `${formatInteger(input.zapSummary.edgeCount)} aristas de zap, origen ${input.zapSummary.loadedFrom}.`
        : 'No esta agregando subscripciones ni aristas visuales ahora.',
      tone: zapsTone,
    },
    {
      id: 'profiles' as const,
      score: profilesScore,
      titulo: 'Warmup de perfiles',
      valor: visibleWarmup
        ? `${formatInteger(visibleWarmup.inflightCount)} inflight / ${formatInteger(warmupEligible)} elegibles`
        : 'sin muestra',
      detalle: visibleWarmup
        ? `${formatInteger(warmupLoading)} cargando, ${formatInteger(visibleWarmup.pubkeys.length)} seleccionados para warmup.`
        : 'El inspector aun no recibio snapshot de perfiles visibles.',
      tone: profilesTone,
    },
    {
      id: 'root-load' as const,
      score: rootLoadScore,
      titulo: 'Carga root',
      valor: rootLoadActive
        ? `${formatInteger(rootLoadedCount)} contactos`
        : input.uiState.rootLoad.status,
      detalle: rootLoadActive
        ? 'Discovery y merge todavia estan alimentando el grafo.'
        : 'No hay carga root activa en este snapshot.',
      tone: rootLoadTone,
    },
  ]

  return rows
    .sort((left, right) => right.score - left.score || left.titulo.localeCompare(right.titulo))
    .slice(0, 5)
    .map((row, index) => ({
      id: row.id,
      titulo: row.titulo,
      valor: row.valor,
      detalle: row.detalle,
      rank: index + 1,
      intensidad: intensityFromTone(row.tone),
      tone: row.tone,
    }))
}

const buildPerformanceSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorPerformanceSection => {
  const frameMs = input.avatarPerfSnapshot?.emaFrameMs ?? null
  const avatarDraws = input.avatarRuntimeSnapshot?.overlay?.counts.drawnImages ?? 0
  const overlapCount = input.physicsDiagnostics?.approximateOverlapCount ?? 0
  const suspects: string[] = []

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Rendimiento estable'
  let quePasaAhora =
    'No aparece un cuello dominante en el resumen actual de frame, scene churn y avatar overlay.'
  let queLeerAhora =
    'Abre Rendimiento si la UI se siente lenta aunque el resumen no marque una causa obvia.'

  if (frameMs !== null && frameMs > 24) {
    tone = 'bad'
    resumen = 'FPS bajo'
    suspects.push('FPS bajo')
    if (avatarDraws > 60) {
      suspects.push('Avatar overlay cargado')
    }
    if (input.sceneUpdatesPerMinute > input.uiUpdatesPerMinute + 10) {
      suspects.push('La escena invalida seguido')
    }
    if (avatarDraws > 60) {
      resumen = 'Avatar overlay cargado'
      quePasaAhora =
        'El frame promedio esta alto y el overlay de avatares esta dibujando mucho por frame.'
    } else if (input.sceneUpdatesPerMinute > input.uiUpdatesPerMinute + 10) {
      resumen = 'FPS bajo por churn de escena'
      quePasaAhora =
        'El frame promedio esta alto y la escena invalida mucho mas que la UI.'
    } else if (input.physicsEnabled && overlapCount > 0) {
      resumen = 'FPS bajo con fisica activa'
      quePasaAhora =
        'El frame promedio esta alto mientras la fisica sigue activa y reporta densidad visible.'
    } else {
      quePasaAhora =
        'El frame promedio esta alto, pero el snapshot no muestra churn de UI, churn de escena ni overlay de avatares como causa unica.'
    }
    queLeerAhora =
      'Abre Rendimiento y Avatares para separar si el cuello esta en draw, escena o fisica.'
  } else if (input.uiUpdatesPerMinute > Math.max(16, input.sceneUpdatesPerMinute * 1.3)) {
    tone = 'warn'
    resumen = 'Churn de UI elevado'
    suspects.push('La UI cambia mas de lo deseable')
    quePasaAhora =
      'La UI cambia seguido frente al ritmo de invalidacion de escena. Puede haber churn de estado o progreso.'
    queLeerAhora =
      'Abre Rendimiento y Carga Root para ver si el churn viene del progreso de carga.'
  } else if (input.physicsEnabled && overlapCount > 0) {
    tone = 'warn'
    resumen = 'Fisica activa con densidad visible'
    suspects.push('Fisica activa con densidad visible')
    quePasaAhora =
      'La fisica sigue activa y reporta densidad suficiente como para seguir moviendo el layout.'
    queLeerAhora = 'Abre Rendimiento para revisar fisica, overlap y cadencia de escena.'
  }

  if (suspects.length === 0) {
    suspects.push('Sin sospechoso dominante')
  }

  return {
    tone,
    titulo: 'Rendimiento',
    resumen,
    estado:
      frameMs === null ? 'sin FPS EMA' : `${formatFpsWithFrameMs(frameMs)} de render Sigma`,
    queSignifica:
      'Resume si la lentitud parece venir de redraw, churn de UI o actividad de fisica.',
    quePasaAhora,
    queLeerAhora,
    metricas: [
      {
        label: 'FPS EMA',
        value: formatFpsWithFrameMs(frameMs),
        tone: frameMs !== null && frameMs > 24 ? 'bad' : frameMs !== null && frameMs > 18 ? 'warn' : 'ok',
      },
      {
        label: 'Invalidaciones de escena',
        value: `${formatInteger(input.sceneUpdatesPerMinute)}/min`,
        tone: input.sceneUpdatesPerMinute > 30 ? 'warn' : 'ok',
      },
      {
        label: 'Invalidaciones de UI',
        value: `${formatInteger(input.uiUpdatesPerMinute)}/min`,
        tone: input.uiUpdatesPerMinute > 30 ? 'warn' : 'ok',
      },
      {
        label: 'Avatar draws/frame',
        value: formatInteger(avatarDraws),
        tone: avatarDraws > 60 ? 'warn' : 'ok',
      },
      {
        label: 'Fisica',
        value: input.physicsEnabled ? 'Activa' : 'Pausada',
        tone: input.physicsEnabled ? 'warn' : 'neutral',
      },
      {
        label: 'Overlap aprox.',
        value: formatInteger(overlapCount),
        tone: overlapCount > 0 ? 'warn' : 'ok',
      },
    ],
    sospechosos: suspects,
  }
}

const buildRelaysSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorRelaysSection => {
  const endpoints = input.uiState.relayState.urls.map((relayUrl) => ({
    relay: compactRelay(relayUrl),
    endpoint: input.uiState.relayState.endpoints[relayUrl],
  }))
  const connectedCount = endpoints.filter(
    ({ endpoint }) =>
      endpoint?.status === 'connected' || endpoint?.status === 'partial',
  ).length
  const degradedCount = endpoints.filter(
    ({ endpoint }) => endpoint?.status === 'degraded',
  ).length
  const offlineCount = endpoints.filter(
    ({ endpoint }) => endpoint?.status === 'offline',
  ).length
  const totalCount = endpoints.length

  let tone: RuntimeInspectorTone = 'ok'
  let resumen = 'Relays saludables'
  let quePasaAhora =
    'La mayoria de los relays actuales responde sin degradacion fuerte.'
  let queLeerAhora =
    'Abre Relays si la cobertura no coincide con lo esperado o si ves mensajes de stale.'

  if (totalCount > 0 && connectedCount === 0) {
    tone = 'bad'
    resumen = 'Sin relays utiles'
    quePasaAhora =
      'No hay relays conectados o parciales en el set actual. La cobertura va a ser pobre o nula.'
    queLeerAhora = 'Abre Relays y revisa notices, estado y override activo.'
  } else if (
    input.uiState.relayState.isGraphStale ||
    degradedCount > 0 ||
    offlineCount > 0
  ) {
    tone = 'warn'
    resumen = 'Relays degradados o stale'
    quePasaAhora =
      input.uiState.relayState.isGraphStale
        ? 'El grafo esta marcado como stale por override o por un set de relays incompleto.'
        : 'Hay relays degradados u offline que pueden recortar cobertura y zaps.'
    queLeerAhora =
      'Abre Relays para ver cual esta degradado y si conviene revertir el override.'
  }

  return {
    tone,
    titulo: 'Relays',
    resumen,
    estado: `${formatInteger(connectedCount)} de ${formatInteger(totalCount)} utiles`,
    queSignifica:
      'Resume el estado del set de relays que alimenta discovery, cobertura y zaps.',
    quePasaAhora,
    queLeerAhora,
    metricas: [
      { label: 'Conectados o parciales', value: formatInteger(connectedCount), tone: connectedCount > 0 ? 'ok' : 'bad' },
      { label: 'Degradados', value: formatInteger(degradedCount), tone: degradedCount > 0 ? 'warn' : 'ok' },
      { label: 'Offline', value: formatInteger(offlineCount), tone: offlineCount > 0 ? 'bad' : 'ok' },
      { label: 'Override', value: input.uiState.relayState.overrideStatus, tone: input.uiState.relayState.overrideStatus === 'idle' ? 'neutral' : 'warn' },
      { label: 'Grafo stale', value: input.uiState.relayState.isGraphStale ? 'Si' : 'No', tone: input.uiState.relayState.isGraphStale ? 'warn' : 'ok' },
    ],
    filas: endpoints.map(({ relay, endpoint }) => ({
      relay,
      estado: translateRelayStatus(endpoint?.status ?? 'unknown'),
      detalle: formatRelayEndpointDetail(endpoint),
    })),
  }
}

const buildLoadSection = (
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorLoadSection => {
  const progress = input.uiState.rootLoad.visibleLinkProgress
  const tone: RuntimeInspectorTone =
    input.uiState.rootLoad.status === 'error'
      ? 'bad'
      : input.uiState.rootLoad.status === 'partial' ||
          input.uiState.rootLoad.status === 'loading'
        ? 'warn'
        : input.uiState.rootLoad.status === 'ready'
          ? 'ok'
          : 'neutral'

  return {
    tone,
    titulo: 'Carga Root',
    resumen:
      input.uiState.rootLoad.status === 'loading'
        ? 'Carga en progreso'
        : input.uiState.rootLoad.status === 'partial'
          ? 'Carga parcial'
          : input.uiState.rootLoad.status === 'ready'
            ? 'Carga completa'
            : input.uiState.rootLoad.status === 'error'
              ? 'Carga con error'
              : 'Carga sin actividad',
    estado: input.uiState.rootLoad.status,
    queSignifica:
      'Muestra en que punto esta la carga root y si la vista actual todavia depende de cache, live o un estado parcial.',
    quePasaAhora:
      input.uiState.rootLoad.message?.trim() ||
      'Sin mensaje adicional de la carga root.',
    queLeerAhora:
      input.uiState.rootLoad.status === 'partial' ||
      input.uiState.rootLoad.status === 'loading'
        ? 'Abre Carga Root y Cobertura para ver si falta discovery, paginacion o merge.'
        : 'Abre Carga Root solo si el comportamiento visible contradice este estado.',
    metricas: [
      { label: 'Estado', value: input.uiState.rootLoad.status, tone },
      { label: 'Origen', value: input.uiState.rootLoad.loadedFrom, tone: input.uiState.rootLoad.loadedFrom === 'live' ? 'ok' : 'neutral' },
      { label: 'Following', value: progress ? formatInteger(progress.following.loadedCount) : 'sin dato', tone: 'neutral' },
      { label: 'Followers', value: progress ? formatInteger(progress.followers.loadedCount) : 'sin dato', tone: 'neutral' },
      { label: 'Eventos kind:3', value: progress ? formatInteger(progress.contactListEventCount) : 'sin dato', tone: 'neutral' },
      { label: 'Evidencia inbound', value: progress ? formatInteger(progress.inboundCandidateEventCount) : 'sin dato', tone: 'neutral' },
    ],
  }
}

const buildSummary = (sections: {
  coverage: RuntimeInspectorCoverageSection
  profiles: RuntimeInspectorProfilesSection
  avatars: RuntimeInspectorAvatarsSection
  zaps: RuntimeInspectorZapsSection
  performance: RuntimeInspectorPerformanceSection
  relays: RuntimeInspectorRelaysSection
}): RuntimeInspectorSummaryItem[] => [
  {
    id: 'coverage',
    title: 'Cobertura',
    tone: sections.coverage.tone,
    estado: formatToneLabel(sections.coverage.tone),
    valor: sections.coverage.estado,
    detalle: sections.coverage.resumen,
  },
  {
    id: 'profiles',
    title: 'Perfiles',
    tone: sections.profiles.tone,
    estado: formatToneLabel(sections.profiles.tone),
    valor: sections.profiles.estado,
    detalle: sections.profiles.resumen,
  },
  {
    id: 'avatars',
    title: 'Avatares',
    tone: sections.avatars.tone,
    estado: formatToneLabel(sections.avatars.tone),
    valor: sections.avatars.estado,
    detalle: sections.avatars.resumen,
  },
  {
    id: 'zaps',
    title: 'Zaps',
    tone: sections.zaps.tone,
    estado: formatToneLabel(sections.zaps.tone),
    valor: sections.zaps.estado,
    detalle: sections.zaps.resumen,
  },
  {
    id: 'performance',
    title: 'Rendimiento',
    tone: sections.performance.tone,
    estado: formatToneLabel(sections.performance.tone),
    valor: sections.performance.estado,
    detalle: sections.performance.resumen,
  },
  {
    id: 'relays',
    title: 'Relays',
    tone: sections.relays.tone,
    estado: formatToneLabel(sections.relays.tone),
    valor: sections.relays.estado,
    detalle: sections.relays.resumen,
  },
]

const buildPrimaryIssue = (
  summary: RuntimeInspectorSummaryItem[],
  sections: {
    coverage: RuntimeInspectorCoverageSection
    profiles: RuntimeInspectorProfilesSection
    avatars: RuntimeInspectorAvatarsSection
    zaps: RuntimeInspectorZapsSection
    performance: RuntimeInspectorPerformanceSection
    relays: RuntimeInspectorRelaysSection
    load: RuntimeInspectorLoadSection
  },
): RuntimeInspectorPrimaryIssue => {
  const sectionMap = {
    coverage: sections.coverage,
    profiles: sections.profiles,
    avatars: sections.avatars,
    zaps: sections.zaps,
    performance: sections.performance,
    relays: sections.relays,
  }
  const ordered = [...summary].sort((left, right) => {
    const toneDiff =
      primaryToneRank(right.id, sectionMap[right.id]) -
      primaryToneRank(left.id, sectionMap[left.id])
    if (toneDiff !== 0) {
      return toneDiff
    }
    return PRIORITY.indexOf(left.id) - PRIORITY.indexOf(right.id)
  })
  const top = ordered[0]
  const topSection = top ? sectionMap[top.id] : null
  const topRank =
    top && topSection ? primaryToneRank(top.id, topSection) : toneRank('neutral')

  if (
    !top ||
    !topSection ||
    topRank < toneRank('warn')
  ) {
    return {
      titulo: 'Sin alerta dominante',
      causaProbable:
        'El resumen actual no marca un cuello principal. Usa Rendimiento o Cobertura segun el sintoma.',
      confianza: 'baja',
      abrirAhora: 'performance',
      tone: 'neutral',
    }
  }
  const section = topSection

  return {
    titulo: section.resumen,
    causaProbable: section.quePasaAhora,
    confianza:
      top.id === 'performance'
        ? 'media'
        : top.id === 'relays'
          ? 'media'
          : 'alta',
    abrirAhora: top.id,
    tone: section.tone,
  }
}

export function buildRuntimeInspectorSnapshot(
  input: RuntimeInspectorBuildInput,
): RuntimeInspectorSnapshot {
  const coverage = buildCoverageSection(input)
  const profiles = buildProfilesSection(input)
  const avatars = buildAvatarSection(input)
  const zaps = buildZapSection(input)
  const performance = buildPerformanceSection(input)
  const relays = buildRelaysSection(input)
  const load = buildLoadSection(input)
  const resourceTop = buildResourceTop(input)
  const summary = buildSummary({
    coverage,
    profiles,
    avatars,
    zaps,
    performance,
    relays,
  })
  const primary = buildPrimaryIssue(summary, {
    coverage,
    profiles,
    avatars,
    zaps,
    performance,
    relays,
    load,
  })

  return {
    generadoA:
      input.generatedAtMs === null
        ? 'sin dato'
        : new Date(input.generatedAtMs).toLocaleTimeString('es-AR'),
    primary,
    summary,
    coverage,
    profiles,
    avatars,
    zaps,
    performance,
    relays,
    load,
    resourceTop,
  }
}
