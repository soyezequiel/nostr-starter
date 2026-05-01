import type { GraphNode, KeywordMatch } from '@/features/graph-runtime/app/store'
import { logTerminalDetail } from '@/features/graph-runtime/debug/humanTerminalLog'
import type { NoteExtractRecord } from '@/features/graph-runtime/db/entities'
import {
  COVERAGE_RECOVERY_MESSAGE,
  KEYWORD_EXTRACT_MAX_LENGTH,
  ZAP_LAYER_LOADING_MESSAGE,
} from '@/features/graph-runtime/kernel/modules/constants'
import type { MergedRelayEventEnvelope } from '@/features/graph-runtime/kernel/modules/helpers'

export function normalizeNoteExtractText(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) {
    return null
  }
  return normalized.slice(0, KEYWORD_EXTRACT_MAX_LENGTH)
}

export function buildNoteExtractRecordsByPubkey(
  events: readonly MergedRelayEventEnvelope[],
  requestedPubkeys: readonly string[],
  maxNotesPerPubkey: number,
): Map<string, NoteExtractRecord[]> {
  const recordsByPubkey = new Map<string, NoteExtractRecord[]>(
    requestedPubkeys.map((pubkey) => [pubkey, []]),
  )
  const requestedSet = new Set(requestedPubkeys)
  const sortedEvents = events
    .filter(
      (envelope) =>
        envelope.event.kind === 1 && requestedSet.has(envelope.event.pubkey),
    )
    .slice()
    .sort((left, right) => {
      if (left.event.pubkey !== right.event.pubkey) {
        return left.event.pubkey.localeCompare(right.event.pubkey)
      }
      if (left.event.created_at !== right.event.created_at) {
        return right.event.created_at - left.event.created_at
      }
      return left.event.id.localeCompare(right.event.id)
    })

  for (const envelope of sortedEvents) {
    const currentRecords = recordsByPubkey.get(envelope.event.pubkey) ?? []
    if (currentRecords.length >= maxNotesPerPubkey) {
      continue
    }

    const text = normalizeNoteExtractText(envelope.event.content)
    if (!text) {
      continue
    }

    recordsByPubkey.set(envelope.event.pubkey, [
      ...currentRecords,
      {
        noteId: envelope.event.id,
        pubkey: envelope.event.pubkey,
        createdAt: envelope.event.created_at,
        fetchedAt: envelope.receivedAtMs,
        text,
      },
    ])
  }

  return recordsByPubkey
}

export function flattenNoteExtractRecords(
  recordsByPubkey: Map<string, NoteExtractRecord[]>,
): NoteExtractRecord[] {
  return Array.from(recordsByPubkey.values())
    .flat()
    .sort((left, right) => {
      if (left.pubkey !== right.pubkey) {
        return left.pubkey.localeCompare(right.pubkey)
      }
      if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt
      }
      return left.noteId.localeCompare(right.noteId)
    })
}

export function summarizeKeywordCorpus(
  extracts: readonly NoteExtractRecord[],
): {
  corpusNodeCount: number
  extractCount: number
} {
  return {
    corpusNodeCount: new Set(extracts.map((extract) => extract.pubkey)).size,
    extractCount: extracts.length,
  }
}

export function logKeywordMatchesToConsole(
  keyword: string,
  nodeHits: Record<string, number>,
  matchesByPubkey: Record<string, KeywordMatch[]>,
  nodes: Record<string, GraphNode>,
): void {
  const matchedUsers = Object.entries(matchesByPubkey)
    .map(([pubkey, matches]) => ({
      pubkey,
      label:
        nodes[pubkey]?.label?.trim() ||
        nodes[pubkey]?.nip05?.trim() ||
        pubkey.slice(0, 12),
      hitScore: nodeHits[pubkey] ?? 0,
      excerptCount: matches.length,
      topTokens: Array.from(
        new Set(matches.flatMap((match) => match.matchedTokens)),
      ).join(', '),
    }))
    .sort((left, right) => {
      if (left.hitScore !== right.hitScore) {
        return right.hitScore - left.hitScore
      }
      return left.pubkey.localeCompare(right.pubkey)
    })

  logTerminalDetail('Keywords', 'Busqueda completada', {
    keyword,
    usuarios: matchedUsers.length,
    top: matchedUsers
      .slice(0, 5)
      .map((user) => `${user.label}:${user.hitScore}`),
  })
}

export function buildZapLayerMessage({
  status,
  edgeCount,
  skippedReceipts,
  loadedFrom,
}: {
  status: 'loading' | 'enabled' | 'unavailable'
  edgeCount: number
  skippedReceipts: number
  loadedFrom: 'cache' | 'live'
}): string {
  if (status === 'loading') {
    return ZAP_LAYER_LOADING_MESSAGE
  }

  const skippedLabel =
    skippedReceipts > 0
      ? ` ${skippedReceipts} recibos omitidos por decode.`
      : ''

  if (status === 'unavailable' || edgeCount === 0) {
    return `No hay recibos de zap utilizables para los nodos visibles.${skippedLabel}`
  }

  return `${edgeCount} edges de zap listos desde ${loadedFrom}.${skippedLabel}`
}

export function buildDiscoveredGraphAnalysisMessage(result: {
  mode: 'full' | 'heuristic'
  confidence: 'low' | 'medium' | 'high'
  communityCount: number
  analyzedNodeCount: number
  relayHealth: {
    healthyRelayCount: number
    degradedRelayCount: number
    offlineRelayCount: number
  }
  flags: readonly string[]
}) {
  const relaySummary = `${result.relayHealth.healthyRelayCount} sanos / ${result.relayHealth.degradedRelayCount + result.relayHealth.offlineRelayCount} degradados`
  if (result.mode === 'heuristic') {
    return `Agrupacion tentativa para ${result.analyzedNodeCount} nodos del vecindario descubierto. ${relaySummary}.`
  }
  if (result.confidence !== 'high' || result.flags.length > 0) {
    return `Grupos detectados para ${result.analyzedNodeCount} nodos con confianza ${result.confidence}. ${relaySummary}.`
  }
  return `${result.communityCount} grupos detectados en ${result.analyzedNodeCount} nodos del vecindario descubierto. ${relaySummary}.`
}

export function buildDiscoveredMessage(
  discoveredFollowCount: number,
  hasPartialSignals: boolean,
  loadedFromCache: boolean = false,
  acceptedNodesCount?: number,
): string {
  if (discoveredFollowCount === 0) {
    return `Sin follows descubiertos. ${COVERAGE_RECOVERY_MESSAGE}`
  }

  const nodesInfo =
    acceptedNodesCount !== undefined
      ? ` (${acceptedNodesCount} nodos nuevos en el grafo)`
      : ''
  const prefix = loadedFromCache
    ? `${discoveredFollowCount} follows descubiertos desde cache local${nodesInfo}`
    : `${discoveredFollowCount} follows descubiertos${nodesInfo}`

  return hasPartialSignals ? `${prefix} con degradacion parcial.` : `${prefix}.`
}

export function buildContactListPartialMessage(options: {
  discoveredFollowCount: number
  diagnostics: readonly { code: string }[]
  rejectedPubkeyCount: number
  maxGraphNodes?: number
  loadedFromCache?: boolean
  acceptedNodesCount?: number
}): string | null {
  const {
    discoveredFollowCount,
    diagnostics,
    rejectedPubkeyCount,
    maxGraphNodes,
    loadedFromCache = false,
    acceptedNodesCount,
  } = options

  if (discoveredFollowCount === 0) {
    return null
  }

  const nodesInfo =
    acceptedNodesCount !== undefined
      ? ` (${acceptedNodesCount} nodos nuevos en el grafo)`
      : ''
  const prefix = loadedFromCache
    ? `${discoveredFollowCount} follows descubiertos desde cache local${nodesInfo}`
    : `${discoveredFollowCount} follows descubiertos${nodesInfo}`
  const hitFollowTagCap = diagnostics.some(
    (diagnostic) => diagnostic.code === 'FOLLOW_TAG_CAP_REACHED',
  )

  if (hitFollowTagCap && rejectedPubkeyCount > 0) {
    return `${prefix} con recorte local: la contact list supero el budget de parseo y ${rejectedPubkeyCount} pubkeys no entraron por el cap de ${maxGraphNodes ?? 'grafo'} nodos.`
  }
  if (hitFollowTagCap) {
    return `${prefix} con recorte local: la contact list supero el budget de parseo de follows del cliente.`
  }
  if (rejectedPubkeyCount > 0) {
    return `${prefix}, pero ${rejectedPubkeyCount} no entraron por el cap de ${maxGraphNodes ?? 'grafo'} nodos.`
  }
  return `${prefix} con degradacion parcial.`
}

export function buildExpandedStructureMessage(options: {
  pubkey: string
  discoveredFollowCount: number
  discoveredFollowerCount: number
  hasPartialSignals: boolean
  authoredDiagnostics: readonly { code: string }[]
  rejectedPubkeyCount: number
  maxGraphNodes: number
  authoredLoadedFromCache?: boolean
  acceptedNodesCount: number
}): string {
  const authoredMessage =
    options.discoveredFollowCount > 0
      ? options.hasPartialSignals || options.authoredLoadedFromCache
        ? buildContactListPartialMessage({
            discoveredFollowCount: options.discoveredFollowCount,
            diagnostics: options.authoredDiagnostics,
            rejectedPubkeyCount: options.rejectedPubkeyCount,
            maxGraphNodes: options.maxGraphNodes,
            loadedFromCache: options.authoredLoadedFromCache,
            acceptedNodesCount: options.acceptedNodesCount,
          }) ??
          buildDiscoveredMessage(
            options.discoveredFollowCount,
            true,
            options.authoredLoadedFromCache,
            options.acceptedNodesCount,
          )
        : buildDiscoveredMessage(
            options.discoveredFollowCount,
            false,
            false,
            options.acceptedNodesCount,
          )
      : options.hasPartialSignals
        ? `Sin lista de follows completa para ${options.pubkey.slice(0, 8)}... ${COVERAGE_RECOVERY_MESSAGE}`
        : `Sin lista de follows descubierta para ${options.pubkey.slice(0, 8)}...`

  if (options.discoveredFollowerCount === 0) {
    return authoredMessage
  }

  return `${authoredMessage} ${options.discoveredFollowerCount} followers inbound reales descubiertos.`
}
