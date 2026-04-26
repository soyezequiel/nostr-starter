import type { Filter } from 'nostr-tools'

import type { GraphNode } from '@/features/graph-runtime/app/store'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import {
  logTerminalWarning,
  summarizeHumanTerminalError,
} from '@/features/graph-runtime/debug/humanTerminalLog'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import {
  collectRelayEvents,
  parseRelayListEvent,
  selectLatestReplaceableEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph-runtime/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import {
  type RelayCountResult,
  type RelayEventEnvelope,
} from '@/features/graph-runtime/nostr'

import { NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS } from '@/features/graph-runtime/kernel/modules/constants'

export const ROOT_RELAY_LIST_KIND = 10002

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
  ): Promise<{ readRelays: string[]; writeRelays: string[] } | null> {
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
        return null
      }

      const latestRelayListEvent = selectLatestReplaceableEvent(
        relayListResult.events,
      )
      if (!latestRelayListEvent) {
        return null
      }

      const parsedRelayList = parseRelayListEvent(latestRelayListEvent)
      await persistRelayListEvent(latestRelayListEvent)
      return {
        readRelays: parsedRelayList.readRelays,
        writeRelays: parsedRelayList.writeRelays,
      }
    } catch (error) {
      logTerminalWarning('Relays', 'No se pudo actualizar la lista', {
        motivo: summarizeHumanTerminalError(error),
      })
      return null
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
        timeoutMs: NODE_EXPAND_INBOUND_COUNT_TIMEOUT_MS,
        idPrefix: `inbound:${rootPubkey.slice(0, 8)}`,
      })

      if (isStale()) {
        return []
      }

      return countResults
    } catch (error) {
      logTerminalWarning('Relays', 'No se pudo contar followers inbound', {
        motivo: summarizeHumanTerminalError(error),
      })
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
      logTerminalWarning('Persistencia', 'No se pudo guardar followers inbound', {
        motivo: summarizeHumanTerminalError(error),
      })
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
      logTerminalWarning('Persistencia', 'No se pudo guardar la lista de relays', {
        motivo: summarizeHumanTerminalError(error),
      })
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
        logTerminalWarning('Perfiles', 'No se pudieron hidratar followers inbound', {
          cantidad: pubkeys.length,
          motivo: summarizeHumanTerminalError(error),
        })
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

export type FollowerDiscoveryModule = ReturnType<
  typeof createFollowerDiscoveryModule
>
