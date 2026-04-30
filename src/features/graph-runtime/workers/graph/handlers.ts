import type {
  GraphLink,
  GraphNodeSource,
} from '@/features/graph-runtime/app/store/types'
import { analyzeDiscoveredGraph } from '@/features/graph-runtime/workers/graph/analyzeDiscoveredGraph'
import type {
  AnalyzeDiscoveredGraphNodeInput,
  AnalyzeDiscoveredGraphRequest,
  CalcDegreesRequest,
  CalcDegreesResult,
  FindPathRequest,
  FindPathResult,
  GraphLinkInput,
  GraphWorkerActionMap,
} from '@/features/graph-runtime/workers/graph/contracts'
import { WorkerProtocolError } from '@/features/graph-runtime/workers/shared/protocol'
import type { WorkerHandlerRegistry } from '@/features/graph-runtime/workers/shared/runtime'
import {
  expectArray,
  expectFiniteNumber,
  expectRecord,
  expectString,
  normalizePubkey,
} from '@/features/graph-runtime/workers/shared/validation'

type NormalizedAdjacency = Record<string, string[]>

function validateAdjacency(input: unknown, path: string): Record<string, string[]> {
  const adjacency = expectRecord(input, path)

  return Object.fromEntries(
    Object.entries(adjacency).map(([pubkey, neighbors]) => {
      if (!Array.isArray(neighbors) || neighbors.some((neighbor) => typeof neighbor !== 'string')) {
        throw new WorkerProtocolError(
          'INVALID_PAYLOAD',
          `${path}.${pubkey} must be an array of pubkeys.`,
          { path: `${path}.${pubkey}` },
        )
      }

      return [
        normalizePubkey(pubkey, `${path}.${pubkey}`),
        neighbors.map((neighbor, index) =>
          normalizePubkey(neighbor, `${path}.${pubkey}[${index}]`),
        ),
      ]
    }),
  )
}

function validateFindPathRequest(payload: unknown): FindPathRequest {
  const request = expectRecord(payload, 'payload')
  const rawAlgorithm = request.algorithm

  if (
    typeof rawAlgorithm !== 'undefined' &&
    rawAlgorithm !== 'bfs' &&
    rawAlgorithm !== 'dijkstra'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      'payload.algorithm must be bfs or dijkstra when provided.',
    )
  }

  return {
    sourcePubkey: normalizePubkey(request.sourcePubkey, 'payload.sourcePubkey'),
    targetPubkey: normalizePubkey(request.targetPubkey, 'payload.targetPubkey'),
    adjacency: validateAdjacency(request.adjacency, 'payload.adjacency'),
    algorithm: rawAlgorithm,
  }
}

function validateGraphLink(input: unknown, index: number): GraphLinkInput {
  const link = expectRecord(input, `payload.links[${index}]`)

  return {
    sourcePubkey: normalizePubkey(link.sourcePubkey, `payload.links[${index}].sourcePubkey`),
    targetPubkey: normalizePubkey(link.targetPubkey, `payload.links[${index}].targetPubkey`),
  }
}

function validateGraphAnalysisNode(
  input: unknown,
  index: number,
): AnalyzeDiscoveredGraphNodeInput {
  const node = expectRecord(input, `payload.nodes[${index}]`)

  return {
    pubkey: normalizePubkey(node.pubkey, `payload.nodes[${index}].pubkey`),
    source: validateGraphNodeSource(node.source, `payload.nodes[${index}].source`),
  }
}

function validateRelayHealthStatus(
  value: unknown,
  path: string,
): 'unknown' | 'connected' | 'partial' | 'degraded' | 'offline' {
  if (
    value !== 'unknown' &&
    value !== 'connected' &&
    value !== 'partial' &&
    value !== 'degraded' &&
    value !== 'offline'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be a supported relay health status.`,
      { path },
    )
  }

  return value
}

function validateAnalyzeDiscoveredGraphRequest(
  payload: unknown,
): AnalyzeDiscoveredGraphRequest {
  const request = expectRecord(payload, 'payload')
  const relayHealth = expectRecord(request.relayHealth, 'payload.relayHealth')

  return {
    jobKind:
      request.jobKind === 'ANALYZE_DISCOVERED_GRAPH'
        ? 'ANALYZE_DISCOVERED_GRAPH'
        : 'ANALYZE_DISCOVERED_GRAPH',
    jobKey: expectString(request.jobKey, 'payload.jobKey'),
    analysisKey: expectString(request.analysisKey, 'payload.analysisKey'),
    nodes: expectArray(request.nodes, 'payload.nodes').map((node, index) =>
      validateGraphAnalysisNode(node, index),
    ),
    links: expectArray(request.links, 'payload.links').map((link, index) =>
      validateGraphLinkForRender(link, `payload.links[${index}]`),
    ),
    rootNodePubkey:
      request.rootNodePubkey === null
        ? null
        : normalizePubkey(request.rootNodePubkey, 'payload.rootNodePubkey'),
    capReached: request.capReached === true,
    isGraphStale: request.isGraphStale === true,
    relayHealth: Object.fromEntries(
      Object.entries(relayHealth).map(([relayUrl, health]) => {
        const snapshot = expectRecord(health, `payload.relayHealth.${relayUrl}`)
        return [
          relayUrl,
          {
            status: validateRelayHealthStatus(
              snapshot.status,
              `payload.relayHealth.${relayUrl}.status`,
            ),
          },
        ]
      }),
    ),
  }
}

function validateCalcDegreesRequest(payload: unknown): CalcDegreesRequest {
  const request = expectRecord(payload, 'payload')
  const adjacency = request.adjacency
  const links = request.links

  if (typeof adjacency === 'undefined' && typeof links === 'undefined') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      'payload must contain adjacency or links.',
    )
  }

  return {
    adjacency: typeof adjacency === 'undefined' ? undefined : validateAdjacency(adjacency, 'payload.adjacency'),
    links:
      typeof links === 'undefined'
        ? undefined
        : expectArray(links, 'payload.links').map((link, index) => validateGraphLink(link, index)),
  }
}

function validateGraphNodeSource(
  value: unknown,
  path: string,
): GraphNodeSource {
  if (
    value !== 'root' &&
    value !== 'follow' &&
    value !== 'inbound' &&
    value !== 'zap' &&
    value !== 'activity'
  ) {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path} must be one of root, follow, inbound, zap or activity.`,
      { path },
    )
  }

  return value
}

function validateGraphLinkForRender(input: unknown, path: string): GraphLink {
  const link = expectRecord(input, path)
  const relation = link.relation

  if (relation !== 'follow' && relation !== 'inbound' && relation !== 'zap') {
    throw new WorkerProtocolError(
      'INVALID_PAYLOAD',
      `${path}.relation must be follow, inbound or zap.`,
      { path: `${path}.relation` },
    )
  }

  return {
    source: expectString(link.source, `${path}.source`),
    target: expectString(link.target, `${path}.target`),
    relation,
    ...(typeof link.weight === 'undefined'
      ? {}
      : { weight: expectFiniteNumber(link.weight, `${path}.weight`) }),
  }
}

function buildNormalizedAdjacency(adjacencyInput: Record<string, string[]>): NormalizedAdjacency {
  const adjacency = Object.fromEntries(
    Object.entries(adjacencyInput).map(([pubkey, neighbors]) => [
      pubkey,
      [...new Set(neighbors)].sort(),
    ]),
  )

  Object.values(adjacency).forEach((neighbors) => {
    neighbors.forEach((neighbor) => {
      adjacency[neighbor] ??= []
    })
  })

  return Object.fromEntries(
    Object.entries(adjacency).sort(([leftPubkey], [rightPubkey]) => leftPubkey.localeCompare(rightPubkey)),
  )
}

function adjacencyFromLinks(links: GraphLinkInput[]): NormalizedAdjacency {
  const adjacency: NormalizedAdjacency = {}

  links.forEach((link) => {
    adjacency[link.sourcePubkey] ??= []
    adjacency[link.targetPubkey] ??= []
    adjacency[link.sourcePubkey].push(link.targetPubkey)
  })

  return buildNormalizedAdjacency(adjacency)
}

export function findShortestPath(request: FindPathRequest): FindPathResult {
  const normalizedAdjacency = buildNormalizedAdjacency(request.adjacency)
  const sourcePubkey = request.sourcePubkey
  const targetPubkey = request.targetPubkey
  const algorithm = request.algorithm ?? 'bfs'

  if (!(sourcePubkey in normalizedAdjacency)) {
    throw new WorkerProtocolError(
      'GRAPH_NODE_NOT_FOUND',
      'The source pubkey is not present in the discovered graph.',
      { pubkey: sourcePubkey, role: 'source' },
    )
  }

  if (!(targetPubkey in normalizedAdjacency)) {
    throw new WorkerProtocolError(
      'GRAPH_NODE_NOT_FOUND',
      'The target pubkey is not present in the discovered graph.',
      { pubkey: targetPubkey, role: 'target' },
    )
  }

  const buildPath = (previous: Map<string, string | null>, cursor: string) => {
    const path: string[] = []
    let current: string | null = cursor

    while (current) {
      path.unshift(current)
      current = previous.get(current) ?? null
    }

    return path
  }

  if (algorithm === 'dijkstra') {
    const distances = new Map<string, number>()
    const previous = new Map<string, string | null>()
    const pending = new Set(Object.keys(normalizedAdjacency))
    let visitedCount = 0

    pending.forEach((pubkey) => {
      distances.set(pubkey, pubkey === sourcePubkey ? 0 : Number.POSITIVE_INFINITY)
    })
    previous.set(sourcePubkey, null)

    while (pending.size > 0) {
      let currentPubkey: string | null = null
      let currentDistance = Number.POSITIVE_INFINITY

      pending.forEach((pubkey) => {
        const candidateDistance = distances.get(pubkey) ?? Number.POSITIVE_INFINITY
        if (candidateDistance < currentDistance) {
          currentDistance = candidateDistance
          currentPubkey = pubkey
        }
      })

      if (currentPubkey === null || !Number.isFinite(currentDistance)) {
        break
      }

      pending.delete(currentPubkey)
      visitedCount += 1

      if (currentPubkey === targetPubkey) {
        return {
          path: buildPath(previous, currentPubkey),
          visitedCount,
          algorithm,
        }
      }

      normalizedAdjacency[currentPubkey].forEach((neighbor) => {
        if (!pending.has(neighbor)) {
          return
        }

        const nextDistance = currentDistance + 1
        if (nextDistance < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
          distances.set(neighbor, nextDistance)
          previous.set(neighbor, currentPubkey)
        }
      })
    }

    return {
      path: null,
      visitedCount,
      algorithm,
    }
  }

  const queue: string[] = [sourcePubkey]
  const previous = new Map<string, string | null>([[sourcePubkey, null]])
  let visitedCount = 0

  while (queue.length > 0) {
    const currentPubkey = queue.shift()
    if (!currentPubkey) {
      break
    }

    visitedCount += 1

    if (currentPubkey === targetPubkey) {
      return {
        path: buildPath(previous, currentPubkey),
        visitedCount,
        algorithm,
      }
    }

    normalizedAdjacency[currentPubkey].forEach((neighbor) => {
      if (!previous.has(neighbor)) {
        previous.set(neighbor, currentPubkey)
        queue.push(neighbor)
      }
    })
  }

  return {
    path: null,
    visitedCount,
    algorithm,
  }
}

export function calculateDegrees(request: CalcDegreesRequest): CalcDegreesResult {
  const normalizedAdjacency =
    request.adjacency ? buildNormalizedAdjacency(request.adjacency) : adjacencyFromLinks(request.links ?? [])
  const inboundCounts = new Map<string, number>()

  Object.entries(normalizedAdjacency).forEach(([pubkey, neighbors]) => {
    inboundCounts.set(pubkey, inboundCounts.get(pubkey) ?? 0)
    neighbors.forEach((neighbor) => {
      inboundCounts.set(neighbor, (inboundCounts.get(neighbor) ?? 0) + 1)
    })
  })

  const degrees = Object.fromEntries(
    Object.keys(normalizedAdjacency)
      .sort()
      .map((pubkey) => {
        const outbound = normalizedAdjacency[pubkey].length
        const inbound = inboundCounts.get(pubkey) ?? 0

        return [
          pubkey,
          {
            inbound,
            outbound,
            total: inbound + outbound,
          },
        ]
      }),
  )

  return { degrees }
}

export function createGraphWorkerRegistry(): WorkerHandlerRegistry<GraphWorkerActionMap> {
  return {
    ANALYZE_DISCOVERED_GRAPH: {
      validate: validateAnalyzeDiscoveredGraphRequest,
      handle: analyzeDiscoveredGraph,
    },
    FIND_PATH: {
      validate: validateFindPathRequest,
      handle: findShortestPath,
    },
    CALC_DEGREES: {
      validate: validateCalcDegreesRequest,
      handle: calculateDegrees,
    },
  }
}
