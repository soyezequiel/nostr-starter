import type { GraphLink, GraphNode, RelayHealth } from '@/features/graph/app/store/types'

const feedHash = (hash: number, value: string) => {
  let nextHash = hash

  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index)
    nextHash = Math.imul(nextHash, 16777619)
  }

  return nextHash >>> 0
}

export const summarizeRelayHealth = (
  relayHealth: Record<string, Pick<RelayHealth, 'status'>>,
) => {
  let healthyRelayCount = 0
  let degradedRelayCount = 0
  let offlineRelayCount = 0

  for (const snapshot of Object.values(relayHealth)) {
    switch (snapshot.status) {
      case 'connected':
        healthyRelayCount += 1
        break
      case 'partial':
      case 'degraded':
        degradedRelayCount += 1
        break
      case 'offline':
        offlineRelayCount += 1
        break
      default:
        degradedRelayCount += 1
        break
    }
  }

  return {
    totalRelayCount: Object.keys(relayHealth).length,
    healthyRelayCount,
    degradedRelayCount,
    offlineRelayCount,
  }
}

export const createDiscoveredGraphAnalysisKey = (input: {
  nodes: Record<string, GraphNode>
  links: readonly GraphLink[]
  rootNodePubkey: string | null
  capReached: boolean
  isGraphStale: boolean
  relayHealth: Record<string, Pick<RelayHealth, 'status'>>
}) => {
  let hash = 2166136261
  hash = feedHash(hash, input.rootNodePubkey ?? 'no-root')
  hash = feedHash(hash, input.capReached ? 'cap:1' : 'cap:0')
  hash = feedHash(hash, input.isGraphStale ? 'stale:1' : 'stale:0')

  const relaySummary = summarizeRelayHealth(input.relayHealth)
  hash = feedHash(
    hash,
    `${relaySummary.totalRelayCount}:${relaySummary.healthyRelayCount}:${relaySummary.degradedRelayCount}:${relaySummary.offlineRelayCount}`,
  )

  const sortedPubkeys = Object.keys(input.nodes).sort()
  for (const pubkey of sortedPubkeys) {
    hash = feedHash(hash, pubkey)
  }

  const sortedFollowEdges = input.links
    .filter((link) => link.relation === 'follow')
    .map((link) => `${link.source}->${link.target}`)
    .sort()
  for (const edge of sortedFollowEdges) {
    hash = feedHash(hash, edge)
  }

  return `analysis:${sortedPubkeys.length}n:${sortedFollowEdges.length}e:${hash.toString(36)}`
}
