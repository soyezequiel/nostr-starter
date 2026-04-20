import type { Filter } from 'nostr-tools'

import type { GraphNode } from '@/features/graph-runtime/app/store'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import {
  collectRelayEvents,
  selectLatestReplaceableEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph-runtime/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import {
  normalizeRelayUrl,
  type RelayCountResult,
  type RelayEventEnvelope,
} from '@/features/graph-runtime/nostr'

export const ROOT_RELAY_LIST_KIND = 10002
const INBOUND_COUNT_TIMEOUT_MS = 900

export function createFollowerDiscoveryModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
  },
) {
  async function refreshRelayList(
    adapter: RelayAdapterInstance,
    rootPubkey: string,
    isStale: () => boolean,
  ): Promise<void> {
    try {
      const relayListResult = await collectRelayEvents(adapter, [
        {
          authors: [rootPubkey],
          kinds: [ROOT_RELAY_LIST_KIND],
        } satisfies Filter,
      ], {
        priority: 'background',
      })

      if (isStale()) {
        return
      }

      const latestRelayListEvent = selectLatestReplaceableEvent(
        relayListResult.events,
      )
      if (!latestRelayListEvent) {
        return
      }

      await persistRelayListEvent(latestRelayListEvent)
    } catch (error) {
      console.warn('Root relay-list refresh failed:', error)
    }
  }

  async function probeInboundFollowerCounts(
    adapter: RelayAdapterInstance,
    rootPubkey: string,
    isStale: () => boolean,
  ): Promise<RelayCountResult[]> {
    try {
      const countResults = await adapter.count([
        {
          kinds: [3],
          '#p': [rootPubkey],
        } satisfies Filter & { '#p': string[] },
      ], {
        timeoutMs: INBOUND_COUNT_TIMEOUT_MS,
        idPrefix: `inbound:${rootPubkey.slice(0, 8)}`,
      })

      if (isStale()) {
        return []
      }

      return countResults
    } catch (error) {
      console.warn('Inbound follower COUNT probe failed:', error)
      return []
    }
  }

  async function persistInboundFollowerSnapshot(
    rootPubkey: string,
    followerPubkeys: readonly string[],
    sourceEnvelopes: readonly RelayEventEnvelope[],
    relayUrls: readonly string[],
    completeness: 'partial' | 'final',
  ): Promise<void> {
    try {
      await ctx.repositories.inboundFollowerSnapshots.upsert({
        rootPubkey,
        followerPubkeys: [...followerPubkeys],
        relayUrls: [
          ...relayUrls,
          ...sourceEnvelopes.map((envelope) => envelope.relayUrl),
        ],
        eventIds: sourceEnvelopes.map((envelope) => envelope.event.id),
        fetchedAt: ctx.now(),
        finalizedAt: ctx.now(),
        completeness,
      })
    } catch (error) {
      console.warn('Inbound follower snapshot persistence failed:', error)
    }
  }

  async function persistRelayListEvent(envelope: RelayEventEnvelope): Promise<void> {
    if (envelope.event.kind !== ROOT_RELAY_LIST_KIND) {
      return
    }

    const parsedRelayList = parseRelayListEvent(envelope)
    if (parsedRelayList.relays.length === 0) {
      return
    }

    try {
      await ctx.repositories.relayLists.upsert({
        pubkey: envelope.event.pubkey,
        eventId: envelope.event.id,
        createdAt: envelope.event.created_at,
        fetchedAt: envelope.receivedAtMs,
        readRelays: parsedRelayList.readRelays,
        writeRelays: parsedRelayList.writeRelays,
        relays: parsedRelayList.relays,
      })
    } catch (error) {
      console.warn('Relay-list persistence failed:', error)
    }
  }

  function hydrateInboundFollowerProfiles(
    pubkeys: readonly string[],
    relayUrls: readonly string[],
    isStale: () => boolean,
  ): void {
    if (pubkeys.length === 0) {
      return
    }

    void collaborators.profileHydration
      .hydrateNodeProfiles([...pubkeys], [...relayUrls], isStale, {
        persistProfileEvent: collaborators.persistence.persistProfileEvent,
      })
      .catch((error) => {
        console.warn('Progressive inbound profile hydration failed:', error)
      })
  }

  function mergeProgressiveInboundFollowers(
    rootPubkey: string,
    inboundFollowerPubkeys: readonly string[],
    isStale: () => boolean,
  ): string[] {
    const debugEnabled =
      typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_GRAPH_V2_DEBUG === '1'
    const traceConfig = getAccountTraceConfig()
    const traceThisRoot = isAccountTraceRoot(rootPubkey)

    if (isStale()) {
      if (debugEnabled) {
        console.info(
          '[graph-v2:debug] mergeProgressiveInboundFollowers: stale',
          { rootPubkey, incomingCount: inboundFollowerPubkeys.length },
        )
      }
      if (traceThisRoot && traceConfig) {
        traceAccountFlow('mergeProgressiveInboundFollowers.stale', {
          incomingCount: inboundFollowerPubkeys.length,
          incomingHasTraceTarget: inboundFollowerPubkeys.includes(
            traceConfig.targetPubkey,
          ),
        })
      }
      return []
    }

    const state = ctx.store.getState()
    if (state.rootNodePubkey !== rootPubkey || !state.nodes[rootPubkey]) {
      if (debugEnabled) {
        console.info(
          '[graph-v2:debug] mergeProgressiveInboundFollowers: root mismatch',
          {
            rootPubkey,
            stateRootNodePubkey: state.rootNodePubkey,
            hasRootNode: Boolean(state.nodes[rootPubkey]),
          },
        )
      }
      if (traceThisRoot && traceConfig) {
        traceAccountFlow('mergeProgressiveInboundFollowers.rootMismatch', {
          stateRootNodePubkey: state.rootNodePubkey,
          hasRootNode: Boolean(state.nodes[rootPubkey]),
          incomingHasTraceTarget: inboundFollowerPubkeys.includes(
            traceConfig.targetPubkey,
          ),
        })
      }
      return []
    }

    const discoveredAt = ctx.now()
    const inboundNewNodes: GraphNode[] = Array.from(
      new Set(
        inboundFollowerPubkeys.filter((pubkey) => pubkey && pubkey !== rootPubkey),
      ),
    )
      .filter((pubkey) => !state.nodes[pubkey])
      .map((pubkey) => ({
        pubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading' as const,
        source: 'inbound' as const,
      }))

    const nodeResult =
      inboundNewNodes.length > 0
        ? state.upsertNodes(inboundNewNodes)
        : { acceptedPubkeys: [], rejectedPubkeys: [] }
    const freshState = ctx.store.getState()
    const acceptedFollowerPubkeys = Array.from(
      new Set(
        inboundFollowerPubkeys.filter(
          (pubkey) => pubkey !== rootPubkey && freshState.nodes[pubkey],
        ),
      ),
    )

    if (debugEnabled) {
      console.info(
        '[graph-v2:debug] mergeProgressiveInboundFollowers: upsert summary',
        {
          rootPubkey,
          incomingCount: inboundFollowerPubkeys.length,
          incomingPubkeys: inboundFollowerPubkeys,
          newNodeCount: inboundNewNodes.length,
          nodeAcceptedCount: nodeResult.acceptedPubkeys.length,
          nodeRejectedCount: nodeResult.rejectedPubkeys.length,
          nodeRejectedPubkeys: nodeResult.rejectedPubkeys,
          acceptedFollowerCount: acceptedFollowerPubkeys.length,
          capReached: freshState.graphCaps.capReached,
          maxNodes: freshState.graphCaps.maxNodes,
          nodeCount: Object.keys(freshState.nodes).length,
        },
      )
    }
    if (traceThisRoot && traceConfig) {
      traceAccountFlow('mergeProgressiveInboundFollowers.upsertSummary', {
        incomingCount: inboundFollowerPubkeys.length,
        incomingHasTraceTarget: inboundFollowerPubkeys.includes(
          traceConfig.targetPubkey,
        ),
        traceTargetAlreadyHadNode: Boolean(state.nodes[traceConfig.targetPubkey]),
        traceTargetHasNodeAfterUpsert: Boolean(
          freshState.nodes[traceConfig.targetPubkey],
        ),
        traceTargetAcceptedAsFollower: acceptedFollowerPubkeys.includes(
          traceConfig.targetPubkey,
        ),
        nodeRejectedPubkeys: nodeResult.rejectedPubkeys,
        capReached: freshState.graphCaps.capReached,
        nodeCount: Object.keys(freshState.nodes).length,
      })
    }

    if (acceptedFollowerPubkeys.length === 0) {
      return []
    }

    const existingInboundFollowers = new Set(
      freshState.inboundAdjacency[rootPubkey] ?? [],
    )
    const followersNeedingLinks = acceptedFollowerPubkeys.filter(
      (pubkey) => !existingInboundFollowers.has(pubkey),
    )
    const traceTargetNeededLink = traceConfig
      ? followersNeedingLinks.includes(traceConfig.targetPubkey)
      : false

    if (debugEnabled) {
      console.info(
        '[graph-v2:debug] mergeProgressiveInboundFollowers: links',
        {
          rootPubkey,
          existingInboundFollowerCount: existingInboundFollowers.size,
          followersNeedingLinksCount: followersNeedingLinks.length,
          followersNeedingLinks,
        },
      )
    }
    if (traceThisRoot && traceConfig) {
      traceAccountFlow('mergeProgressiveInboundFollowers.beforeLinks', {
        existingInboundFollowerCount: existingInboundFollowers.size,
        traceTargetHadInboundLinkBefore: existingInboundFollowers.has(
          traceConfig.targetPubkey,
        ),
        traceTargetNeededLink,
        followersNeedingLinksCount: followersNeedingLinks.length,
      })
    }

    freshState.upsertInboundLinks(
      followersNeedingLinks.map((pubkey) => ({
        source: pubkey,
        target: rootPubkey,
        relation: 'inbound' as const,
      })),
    )
    if (traceThisRoot && traceConfig) {
      const afterState = ctx.store.getState()
      traceAccountFlow('mergeProgressiveInboundFollowers.afterLinks', {
        traceTargetHasInboundLinkAfter: Boolean(
          afterState.inboundAdjacency[rootPubkey]?.includes(traceConfig.targetPubkey),
        ),
        inboundGraphRevision: afterState.inboundGraphRevision,
        inboundLinkCount: afterState.inboundLinks.length,
      })
    }

    if (
      nodeResult.acceptedPubkeys.length > 0 ||
      followersNeedingLinks.length > 0
    ) {
      collaborators.analysis.schedule()
    }

    return acceptedFollowerPubkeys
  }

  return {
    hydrateInboundFollowerProfiles,
    mergeProgressiveInboundFollowers,
    persistInboundFollowerSnapshot,
    probeInboundFollowerCounts,
    refreshRelayList,
  }
}

function parseRelayListEvent(envelope: RelayEventEnvelope): {
  readRelays: string[]
  writeRelays: string[]
  relays: string[]
} {
  const readRelays = new Set<string>()
  const writeRelays = new Set<string>()
  const relays = new Set<string>()

  for (const tag of envelope.event.tags) {
    if (tag[0] !== 'r' || !tag[1]) {
      continue
    }

    let relayUrl: string
    try {
      relayUrl = normalizeRelayUrl(tag[1])
    } catch {
      continue
    }

    const marker = tag[2]?.trim().toLowerCase()
    relays.add(relayUrl)

    if (marker === 'read') {
      readRelays.add(relayUrl)
    } else if (marker === 'write') {
      writeRelays.add(relayUrl)
    } else {
      readRelays.add(relayUrl)
      writeRelays.add(relayUrl)
    }
  }

  return {
    readRelays: Array.from(readRelays).sort(),
    writeRelays: Array.from(writeRelays).sort(),
    relays: Array.from(relays).sort(),
  }
}

export type FollowerDiscoveryModule = ReturnType<
  typeof createFollowerDiscoveryModule
>
