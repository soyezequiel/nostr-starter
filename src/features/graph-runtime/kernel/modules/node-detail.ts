import type { Filter } from 'nostr-tools'

import type { FindPathResult, NodeDetailProfile, SelectNodeResult } from '@/features/graph-runtime/kernel/runtime'
import type { KernelContext } from '@/features/graph-runtime/kernel/modules/context'
import {
  NODE_DETAIL_PREVIEW_CONNECT_TIMEOUT_MS,
  NODE_DETAIL_PREVIEW_PAGE_TIMEOUT_MS,
  NODE_DETAIL_PREVIEW_RETRY_COUNT,
  NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS,
} from '@/features/graph-runtime/kernel/modules/constants'
import {
  KernelCommandError,
  buildMutualAdjacency,
  buildNodeProfileFromNode,
  collectRelayEvents,
  mapProfileRecordToNodeProfile,
  selectLatestReplaceableEvent,
  serializeContactListEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import type { PersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import {
  buildContactListPartialMessage,
  buildDiscoveredMessage,
} from '@/features/graph-runtime/kernel/modules/text-helpers'

export function createNodeDetailModule(
  ctx: KernelContext,
  collaborators: {
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
  },
) {
  const activeNodeStructurePreviewRequests = new Map<string, Promise<void>>()
  const activeNodeDetailRequests = new Map<
    string,
    Promise<NodeDetailProfile | null>
  >()

  async function findPath(
    sourcePubkey: string,
    targetPubkey: string,
    algorithm: 'bfs' | 'dijkstra' = 'bfs',
  ): Promise<FindPathResult> {
    const state = ctx.store.getState()

    if (!state.nodes[sourcePubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo origen ${sourcePubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }
    if (!state.nodes[targetPubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo destino ${targetPubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }

    const adjacency = buildMutualAdjacency(state)
    const result = await ctx.graphWorker.invoke('FIND_PATH', {
      sourcePubkey,
      targetPubkey,
      adjacency,
      algorithm,
    })

    return {
      path: result.path,
      visitedCount: result.visitedCount,
      algorithm: result.algorithm,
    }
  }

  function selectNode(pubkey: string | null): SelectNodeResult {
    const state = ctx.store.getState()
    const previousPubkey = state.selectedNodePubkey

    if (pubkey !== null && !state.nodes[pubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo ${pubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }

    state.setSelectedNodePubkey(pubkey)
    state.setOpenPanel(pubkey === null ? 'overview' : 'node-detail')

    if (pubkey !== null) {
      prefetchNodeStructurePreview(pubkey)
      prefetchNodeProfile(pubkey)
    }

    return { previousPubkey, selectedPubkey: pubkey }
  }

  async function getNodeDetail(pubkey: string): Promise<NodeDetailProfile | null> {
    return queueNodeDetailRequest(pubkey)
  }

  function queueNodeDetailRequest(pubkey: string): Promise<NodeDetailProfile | null> {
    const activeRequest = activeNodeDetailRequests.get(pubkey)
    if (activeRequest) {
      return activeRequest
    }

    const request = loadNodeDetail(pubkey).finally(() => {
      if (activeNodeDetailRequests.get(pubkey) === request) {
        activeNodeDetailRequests.delete(pubkey)
      }
    })
    activeNodeDetailRequests.set(pubkey, request)
    return request
  }

  async function loadNodeDetail(pubkey: string): Promise<NodeDetailProfile | null> {
    const state = ctx.store.getState()
    const existingNode = state.nodes[pubkey]

    if (!existingNode) {
      return null
    }

    if (
      existingNode.profileState === 'ready' &&
      hasUsableNodeProfile(existingNode)
    ) {
      return buildNodeProfileFromNode(existingNode)
    }

    const profileRecord = await ctx.repositories.profiles.get(pubkey)
    if (profileRecord) {
      const profile = mapProfileRecordToNodeProfile(profileRecord)
      collaborators.profileHydration.syncNodeProfile(pubkey, profile)
      return profile
    }

    const relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : ctx.defaultRelayUrls.slice()

    if (existingNode.profileState !== 'loading') {
      state.upsertNodes([
        {
          ...existingNode,
          profileState: 'loading',
        },
      ])
    }

    await collaborators.profileHydration.hydrateNodeProfiles(
      [pubkey],
      relayUrls,
      () => !ctx.store.getState().nodes[pubkey],
      {
        persistProfileEvent: collaborators.persistence.persistProfileEvent,
      },
    )

    const refreshedNode = ctx.store.getState().nodes[pubkey]
    if (!refreshedNode) {
      return null
    }

    const refreshedProfile =
      refreshedNode.profileState === 'ready' && hasUsableNodeProfile(refreshedNode)
        ? buildNodeProfileFromNode(refreshedNode)
        : refreshedNode.profileState === 'missing'
          ? null
          : undefined

    if (refreshedProfile !== undefined) {
      return refreshedProfile
    }

    const hydratedProfileRecord = await ctx.repositories.profiles.get(pubkey)
    if (hydratedProfileRecord) {
      const profile = mapProfileRecordToNodeProfile(hydratedProfileRecord)
      collaborators.profileHydration.syncNodeProfile(pubkey, profile)
      return profile
    }

    collaborators.profileHydration.markNodeProfileMissing(pubkey)
    return null
  }

  function getActivePreviewRequest(pubkey: string): Promise<void> | undefined {
    return activeNodeStructurePreviewRequests.get(pubkey)
  }

  function prefetchNodeProfile(pubkey: string): void {
    void queueNodeDetailRequest(pubkey)
  }

  function prefetchNodeStructurePreview(pubkey: string): void {
    const state = ctx.store.getState()

    if (!state.nodes[pubkey]) {
      return
    }

    if (pubkey === state.rootNodePubkey || state.expandedNodePubkeys.has(pubkey)) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'ready',
        message: null,
        discoveredFollowCount: state.adjacency[pubkey]?.length ?? 0,
      })
      return
    }

    const currentState = state.nodeStructurePreviewStates[pubkey]
    if (
      currentState &&
      (currentState.status === 'ready' ||
        currentState.status === 'partial' ||
        currentState.status === 'empty')
    ) {
      return
    }

    const activeRequest = activeNodeStructurePreviewRequests.get(pubkey)
    if (activeRequest) {
      return
    }

    const request = loadNodeStructurePreview(pubkey).finally(() => {
      activeNodeStructurePreviewRequests.delete(pubkey)
    })
    activeNodeStructurePreviewRequests.set(pubkey, request)
  }

  async function loadNodeStructurePreview(pubkey: string): Promise<void> {
    const state = ctx.store.getState()

    if (!state.nodes[pubkey]) {
      return
    }

    if (pubkey === state.rootNodePubkey || state.expandedNodePubkeys.has(pubkey)) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'ready',
        message: null,
        discoveredFollowCount: state.adjacency[pubkey]?.length ?? 0,
      })
      return
    }

    const relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : ctx.defaultRelayUrls.slice()

    state.setNodeStructurePreviewState(pubkey, {
      status: 'loading',
      message: 'Consultando follows publicados para poblar el panel...',
      discoveredFollowCount: null,
    })

    const adapter = ctx.createRelayAdapter({
      relayUrls,
      connectTimeoutMs: NODE_DETAIL_PREVIEW_CONNECT_TIMEOUT_MS,
      pageTimeoutMs: NODE_DETAIL_PREVIEW_PAGE_TIMEOUT_MS,
      retryCount: NODE_DETAIL_PREVIEW_RETRY_COUNT,
      stragglerGraceMs: NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS,
    })

    try {
      const contactListResult = await collectRelayEvents(adapter, [
        { authors: [pubkey], kinds: [3] } satisfies Filter,
      ])

      const latestContactListEvent = selectLatestReplaceableEvent(
        contactListResult.events,
      )
      if (!latestContactListEvent) {
        state.setNodeStructurePreviewState(pubkey, {
          status: 'empty',
          message: `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
          discoveredFollowCount: 0,
        })
        return
      }

      const parsedContactList = await ctx.eventsWorker.invoke('PARSE_CONTACT_LIST', {
        event: serializeContactListEvent(latestContactListEvent.event),
      })
      const hasPartialSignals = parsedContactList.diagnostics.length > 0
      await collaborators.persistence.persistContactListEvent(
        latestContactListEvent,
        parsedContactList,
      )

      state.setNodeStructurePreviewState(pubkey, {
        status: hasPartialSignals ? 'partial' : 'ready',
        message: hasPartialSignals
          ? buildContactListPartialMessage({
              discoveredFollowCount: parsedContactList.followPubkeys.length,
              diagnostics: parsedContactList.diagnostics,
              rejectedPubkeyCount: 0,
            }) ?? buildDiscoveredMessage(parsedContactList.followPubkeys.length, true)
          : null,
        discoveredFollowCount: parsedContactList.followPubkeys.length,
      })
    } catch (error) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'error',
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'No se pudieron cargar los follows descubiertos para este panel.',
        discoveredFollowCount: null,
      })
    } finally {
      adapter.close()
    }
  }

  return {
    findPath,
    selectNode,
    getNodeDetail,
    getActivePreviewRequest,
  }
}

export type NodeDetailModule = ReturnType<typeof createNodeDetailModule>

const hasUsableNodeProfile = (node: {
  label?: string | null
  picture?: string | null
  about?: string | null
  nip05?: string | null
  lud16?: string | null
}) =>
  Boolean(
    node.label?.trim() ||
      node.picture?.trim() ||
      node.about?.trim() ||
      node.nip05?.trim() ||
      node.lud16?.trim(),
  )
