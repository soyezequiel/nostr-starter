import type { Filter } from 'nostr-tools'

import type {
  GraphSlice,
  UiSlice,
} from '@/features/graph-runtime/app/store/types'
import type {
  ContactListRecord,
} from '@/features/graph-runtime/db'
import type {
  ParseContactListResult,
} from '@/features/graph-runtime/workers/events/contracts'
import type {
  AddActivityExternalNodeInput,
  AddActivityExternalNodeResult,
  AddDetachedNodeInput,
  AddDetachedNodeResult,
  FindPathResult,
  NodeDetailProfile,
  SelectNodeResult,
} from '@/features/graph-runtime/kernel/runtime'
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
  const activeNodeProfilePrefetchPubkeys = new Set<string>()
  const activityRelationshipContactListCache = new Map<
    string,
    Promise<ReadonlySet<string> | null>
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

  function addDetachedNode(input: AddDetachedNodeInput): AddDetachedNodeResult {
    const state = ctx.store.getState()
    const existingNode = state.nodes[input.pubkey]
    const fallbackLabel = input.label?.trim() || existingNode?.label || undefined
    const nextProfileState =
      existingNode?.profileState === 'ready' && input.profileState !== 'ready'
        ? 'ready'
        : input.profileState ?? existingNode?.profileState ?? 'idle'

    const result = state.upsertNodes([
      {
        pubkey: input.pubkey,
        label: fallbackLabel,
        picture: input.picture ?? existingNode?.picture ?? null,
        about: input.about ?? existingNode?.about ?? null,
        nip05: input.nip05 ?? existingNode?.nip05 ?? null,
        lud16: input.lud16 ?? existingNode?.lud16 ?? null,
        profileEventId: input.profileEventId ?? existingNode?.profileEventId ?? null,
        profileFetchedAt: input.profileFetchedAt ?? existingNode?.profileFetchedAt ?? null,
        profileSource: input.profileSource ?? existingNode?.profileSource ?? null,
        profileState: nextProfileState,
        keywordHits: existingNode?.keywordHits ?? 0,
        discoveredAt: input.discoveredAt ?? existingNode?.discoveredAt ?? ctx.now(),
        source: existingNode?.source ?? input.source ?? 'zap',
      },
    ])

    if (!result.acceptedPubkeys.includes(input.pubkey)) {
      throw new KernelCommandError(
        'CAP_REACHED',
        'No hay lugar en el grafo para agregar esa identidad aislada.',
        {
          maxNodes: state.graphCaps.maxNodes,
          pubkey: input.pubkey,
        },
      )
    }

    if (input.markExpanded !== false) {
      state.markNodeExpanded(input.pubkey)
    }

    if (input.pin === true) {
      state.pinNode(input.pubkey)
    }

    const selectResult =
      input.select === false
        ? { selectedPubkey: state.selectedNodePubkey }
        : selectNode(input.pubkey)

    return {
      status: existingNode ? 'existing' : 'inserted',
      selectedPubkey: selectResult.selectedPubkey,
      message: existingNode
        ? 'Esa identidad ya estaba en el grafo.'
        : 'Identidad agregada al grafo como nodo aislado.',
    }
  }

  async function addActivityExternalNode(
    input: AddActivityExternalNodeInput,
  ): Promise<AddActivityExternalNodeResult> {
    const pubkey = input.pubkey.toLowerCase()
    const anchorPubkeys = Array.from(
      new Set(
        input.anchorPubkeys
          .map((anchorPubkey) => anchorPubkey.toLowerCase())
          .filter((anchorPubkey) => anchorPubkey && anchorPubkey !== pubkey),
      ),
    )

    if (pubkey.length === 0 || anchorPubkeys.length === 0) {
      return {
        status: 'skipped',
        selectedPubkey: ctx.store.getState().selectedNodePubkey,
        relationCount: 0,
        message: 'Sin endpoints visibles para agregar identidad por actividad.',
      }
    }

    if (
      input.rootPubkey !== undefined &&
      ctx.store.getState().rootNodePubkey !== input.rootPubkey
    ) {
      return {
        status: 'skipped',
        selectedPubkey: ctx.store.getState().selectedNodePubkey,
        relationCount: 0,
        message: 'Actividad descartada porque cambio la identidad raiz.',
      }
    }

    const existingNode = ctx.store.getState().nodes[pubkey]
    let nodeResult: AddDetachedNodeResult
    try {
      nodeResult = addDetachedNode({
        pubkey,
        label: existingNode?.label ?? null,
        picture: existingNode?.picture ?? null,
        about: existingNode?.about ?? null,
        nip05: existingNode?.nip05 ?? null,
        lud16: existingNode?.lud16 ?? null,
        profileEventId: existingNode?.profileEventId ?? null,
        profileFetchedAt: existingNode?.profileFetchedAt ?? null,
        profileSource: existingNode?.profileSource ?? null,
        profileState: existingNode?.profileState ?? 'loading',
        source: existingNode?.source ?? 'activity',
        pin: true,
        select: false,
        markExpanded: true,
      })
    } catch (error) {
      if (
        error instanceof KernelCommandError &&
        error.code === 'CAP_REACHED'
      ) {
        return {
          status: 'skipped',
          selectedPubkey: ctx.store.getState().selectedNodePubkey,
          relationCount: 0,
          message: error.message,
        }
      }
      throw error
    }

    if (
      input.rootPubkey !== undefined &&
      ctx.store.getState().rootNodePubkey !== input.rootPubkey
    ) {
      return {
        status: 'skipped',
        selectedPubkey: ctx.store.getState().selectedNodePubkey,
        relationCount: 0,
        message: 'Actividad descartada porque cambio la identidad raiz.',
      }
    }

    await prefetchNodeProfiles([pubkey])

    const relayUrls =
      ctx.store.getState().relayUrls.length > 0
        ? ctx.store.getState().relayUrls.slice()
        : ctx.defaultRelayUrls.slice()
    const relationCount = await addVerifiedActivityRelationships({
      pubkey,
      anchorPubkeys,
      relayUrls,
      rootPubkey: input.rootPubkey,
    })

    return {
      status: nodeResult.status,
      selectedPubkey: ctx.store.getState().selectedNodePubkey,
      relationCount,
      message:
        relationCount > 0
          ? 'Identidad agregada por actividad con relacion verificada.'
          : 'Identidad agregada por actividad sin relacion social verificada.',
    }
  }

  async function getNodeDetail(pubkey: string): Promise<NodeDetailProfile | null> {
    return queueNodeDetailRequest(pubkey)
  }

  async function prefetchNodeProfiles(pubkeys: string[]): Promise<string[]> {
    const state = ctx.store.getState()
    const rootPubkeyAtStart = state.rootNodePubkey
    const targets: string[] = []

    for (const pubkey of Array.from(new Set(pubkeys.filter(Boolean)))) {
      const node = state.nodes[pubkey]
      if (!node || !shouldHydrateNodeProfile(node)) {
        continue
      }
      if (
        activeNodeProfilePrefetchPubkeys.has(pubkey) ||
        activeNodeDetailRequests.has(pubkey)
      ) {
        continue
      }

      activeNodeProfilePrefetchPubkeys.add(pubkey)
      targets.push(pubkey)
    }

    if (targets.length === 0) {
      return []
    }

    const relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : ctx.defaultRelayUrls.slice()

    try {
      await collaborators.profileHydration.hydrateNodeProfiles(
        targets,
        relayUrls,
        () => ctx.store.getState().rootNodePubkey !== rootPubkeyAtStart,
        {
          persistProfileEvent: collaborators.persistence.persistProfileEvent,
        },
      )
      return targets
    } finally {
      for (const pubkey of targets) {
        activeNodeProfilePrefetchPubkeys.delete(pubkey)
      }
    }
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

    if (!shouldHydrateNodeProfile(existingNode)) {
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
    addDetachedNode,
    addActivityExternalNode,
    findPath,
    selectNode,
    getNodeDetail,
    prefetchNodeProfiles,
    getActivePreviewRequest,
  }

  async function addVerifiedActivityRelationships({
    pubkey,
    anchorPubkeys,
    relayUrls,
    rootPubkey,
  }: {
    pubkey: string
    anchorPubkeys: readonly string[]
    relayUrls: string[]
    rootPubkey?: string | null
  }): Promise<number> {
    let relationCount = 0

    for (const anchorPubkey of anchorPubkeys) {
      const state = ctx.store.getState()
      if (rootPubkey !== undefined && state.rootNodePubkey !== rootPubkey) {
        return relationCount
      }

      if (hasFollowRelation(state, anchorPubkey, pubkey)) {
        relationCount += upsertFollowRelationship(anchorPubkey, pubkey)
        continue
      }
      if (hasInboundRelation(state, pubkey, anchorPubkey)) {
        relationCount += upsertInboundRelationship(pubkey, anchorPubkey)
        continue
      }

      const anchorFollows = await getActivityRelationshipFollows(
        anchorPubkey,
        relayUrls,
      )
      if (anchorFollows?.has(pubkey)) {
        relationCount += upsertFollowRelationship(anchorPubkey, pubkey)
      }

      const externalFollows = await getActivityRelationshipFollows(
        pubkey,
        relayUrls,
      )
      if (externalFollows?.has(anchorPubkey)) {
        relationCount += upsertInboundRelationship(pubkey, anchorPubkey)
      }
    }

    return relationCount
  }

  async function getActivityRelationshipFollows(
    pubkey: string,
    relayUrls: string[],
  ): Promise<ReadonlySet<string> | null> {
    const cached = activityRelationshipContactListCache.get(pubkey)
    if (cached) {
      return cached
    }

    const request = loadActivityRelationshipFollows(pubkey, relayUrls).finally(
      () => {
        if (activityRelationshipContactListCache.get(pubkey) === request) {
          activityRelationshipContactListCache.delete(pubkey)
        }
      },
    )
    activityRelationshipContactListCache.set(pubkey, request)
    return request
  }

  async function loadActivityRelationshipFollows(
    pubkey: string,
    relayUrls: string[],
  ): Promise<ReadonlySet<string> | null> {
    const cachedRecord = await ctx.repositories.contactLists.get(pubkey)
    if (cachedRecord) {
      return contactListRecordToFollowSet(cachedRecord)
    }

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
        return null
      }

      const parsedContactList = await parseAndPersistContactList(
        latestContactListEvent,
      )
      return new Set(parsedContactList.followPubkeys)
    } catch {
      return null
    } finally {
      adapter.close()
    }
  }

  async function parseAndPersistContactList(
    envelope: Awaited<ReturnType<typeof collectRelayEvents>>['events'][number],
  ): Promise<ParseContactListResult> {
    const parsedContactList = await ctx.eventsWorker.invoke(
      'PARSE_CONTACT_LIST',
      {
        event: serializeContactListEvent(envelope.event),
      },
    )
    await collaborators.persistence.persistContactListEvent(
      envelope,
      parsedContactList,
    )
    return parsedContactList
  }

  function upsertFollowRelationship(source: string, target: string): number {
    const state = ctx.store.getState()
    if (hasStoredFollowLink(state, source, target)) {
      return 0
    }
    state.upsertLinks([{ source, target, relation: 'follow' }])
    return 1
  }

  function upsertInboundRelationship(source: string, target: string): number {
    const state = ctx.store.getState()
    if (hasStoredInboundLink(state, source, target)) {
      return 0
    }
    state.upsertInboundLinks([{ source, target, relation: 'inbound' }])
    return 1
  }
}

export type NodeDetailModule = ReturnType<typeof createNodeDetailModule>

type RelationshipState = Pick<
  GraphSlice & UiSlice,
  'links' | 'inboundLinks'
>

const contactListRecordToFollowSet = (record: ContactListRecord) =>
  new Set(record.follows.map((pubkey) => pubkey.toLowerCase()))

const hasStoredFollowLink = (
  state: RelationshipState,
  source: string,
  target: string,
) =>
  state.links.some(
    (link) =>
      link.source === source &&
      link.target === target &&
      link.relation === 'follow',
  )

const hasStoredInboundLink = (
  state: RelationshipState,
  source: string,
  target: string,
) =>
  state.inboundLinks.some(
    (link) =>
      link.source === source &&
      link.target === target &&
      link.relation === 'inbound',
  )

const hasFollowRelation = (
  state: RelationshipState,
  source: string,
  target: string,
) =>
  hasStoredFollowLink(state, source, target) ||
  state.inboundLinks.some(
    (link) =>
      link.source === source &&
      link.target === target &&
      link.relation === 'inbound',
  )

const hasInboundRelation = (
  state: RelationshipState,
  source: string,
  target: string,
) =>
  hasStoredInboundLink(state, source, target) ||
  state.links.some(
    (link) =>
      link.source === source &&
      link.target === target &&
      link.relation === 'follow',
  )

const shouldHydrateNodeProfile = (node: {
  profileState?: 'idle' | 'loading' | 'ready' | 'missing'
  label?: string | null
  picture?: string | null
  about?: string | null
  nip05?: string | null
  lud16?: string | null
}) => node.profileState !== 'ready' || !hasUsableNodeProfile(node)

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
