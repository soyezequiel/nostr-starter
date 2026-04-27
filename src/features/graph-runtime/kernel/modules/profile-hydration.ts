import type { Filter } from 'nostr-tools'

import type { GraphNodePatch } from '@/features/graph-runtime/app/store/types'
import type { NodeDetailProfile } from '@/features/graph-runtime/kernel/runtime'
import type { KernelContext } from '@/features/graph-runtime/kernel/modules/context'
import type { ProfileRecord } from '@/features/graph-runtime/db/entities'
import type { RelayEventEnvelope } from '@/features/graph-runtime/nostr'
import { PrimalCacheClient } from '@/features/graph-runtime/nostr'
import {
  NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
  NODE_PROFILE_HYDRATION_BATCH_SIZE,
  NODE_PROFILE_PERSIST_CONCURRENCY,
} from '@/features/graph-runtime/kernel/modules/constants'
import {
  mapProfileRecordToNodeProfile,
  runWithConcurrencyLimit,
  safeParseProfile,
} from '@/features/graph-runtime/kernel/modules/helpers'
import {
  isAvatarTraceEnabled,
  summarizeAvatarPictureTransition,
  traceAvatarFlow,
  truncateAvatarPubkey,
} from '@/features/graph-runtime/debug/avatarTrace'
import { getTerminalAvatarFailureForPicture } from '@/features/graph-runtime/debug/avatarTerminalFailures'
import {
  isGraphPerfTraceEnabled,
  nowGraphPerfMs,
  traceGraphPerfDuration,
} from '@/features/graph-runtime/debug/perfTrace'
import {
  logTerminalWarning,
  summarizeHumanTerminalError,
} from '@/features/graph-runtime/debug/humanTerminalLog'
import { normalizeMediaUrl } from '@/lib/media'

const PROFILE_PATCH_BUFFER_FLUSH_MS = 16
const PROFILE_PATCH_BUFFER_MAX = 64

export function createProfileHydrationModule(ctx: KernelContext) {
  const pendingNodePatches = new Map<string, GraphNodePatch>()
  let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null

  const flushPendingNodePatches = (reason: 'manual' | 'max' | 'timer') => {
    if (pendingFlushTimer !== null) {
      clearTimeout(pendingFlushTimer)
      pendingFlushTimer = null
    }

    if (pendingNodePatches.size === 0) {
      return
    }

    const patches = Array.from(pendingNodePatches.values())
    pendingNodePatches.clear()
    const startedAtMs = isGraphPerfTraceEnabled() ? nowGraphPerfMs() : 0
    ctx.store.getState().upsertNodePatches(patches)
    if (startedAtMs > 0) {
      traceGraphPerfDuration(
        'profileHydration.flushNodePatches',
        startedAtMs,
        () => ({
          reason,
          patchCount: patches.length,
          readyCount: patches.filter((patch) => patch.profileState === 'ready')
            .length,
          missingCount: patches.filter(
            (patch) => patch.profileState === 'missing',
          ).length,
          picturePatchCount: patches.filter((patch) => 'picture' in patch)
            .length,
        }),
        { thresholdMs: 8 },
      )
    }
  }

  const queueNodePatch = (patch: GraphNodePatch) => {
    const previousPatch = pendingNodePatches.get(patch.pubkey)
    pendingNodePatches.set(
      patch.pubkey,
      previousPatch ? mergeNodePatch(previousPatch, patch) : patch,
    )

    if (pendingNodePatches.size >= PROFILE_PATCH_BUFFER_MAX) {
      flushPendingNodePatches('max')
      return
    }

    if (pendingFlushTimer !== null) {
      return
    }

    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null
      flushPendingNodePatches('timer')
    }, PROFILE_PATCH_BUFFER_FLUSH_MS)
  }

  const markBatchProfilesMissing = (batch: readonly string[]) => {
    for (const pubkey of batch) {
      const existingNode = ctx.store.getState().nodes[pubkey]
      if (!existingNode || existingNode.profileState === 'ready') {
        continue
      }

      markNodeProfileMissing(pubkey, { buffered: true })
    }
  }

  async function hydrateNodeProfiles(
    pubkeys: string[],
    relayUrls: string[],
    isStale: () => boolean,
    collaborators?: {
      persistProfileEvent?: (
        pubkeyEnvelope: RelayEventEnvelope,
        options?: {
          cacheUrl?: string
          source?: 'relay' | 'primal-cache'
          profileOverrides?: { picture?: string | null }
        },
      ) => Promise<void>
    },
  ): Promise<void> {
    const uniquePubkeys = Array.from(new Set(pubkeys.filter(Boolean)))
    if (uniquePubkeys.length === 0) {
      return
    }

    const cachedProfilesByPubkey = new Map<string, ProfileRecord>()
    try {
      const cachedProfiles = await ctx.repositories.profiles.getMany(uniquePubkeys)
      if (isStale()) {
        return
      }

      for (const cachedProfile of cachedProfiles) {
        if (!cachedProfile) {
          continue
        }

        cachedProfilesByPubkey.set(cachedProfile.pubkey, cachedProfile)
        syncNodeProfile(
          cachedProfile.pubkey,
          mapProfileRecordToNodeProfile(cachedProfile),
          {
            inputSource: 'profile-cache',
            profileEventId: cachedProfile.eventId,
            profileCreatedAt: cachedProfile.createdAt,
            profileFetchedAt: cachedProfile.fetchedAt,
          },
          { buffered: true },
        )
      }
    } catch (error) {
      logTerminalWarning('Perfiles', 'No se pudo leer cache de perfiles', {
        cantidad: uniquePubkeys.length,
        motivo: summarizeHumanTerminalError(error),
      })
    }

    const batches: string[][] = []
    for (
      let index = 0;
      index < uniquePubkeys.length;
      index += NODE_PROFILE_HYDRATION_BATCH_SIZE
    ) {
      batches.push(
        uniquePubkeys.slice(index, index + NODE_PROFILE_HYDRATION_BATCH_SIZE),
      )
    }

    const adapter = ctx.createRelayAdapter({ relayUrls, retryCount: 0 })
    const primalCacheClient = new PrimalCacheClient()

    try {
      const processBatch = async (batch: string[]) => {
        if (isStale()) {
          return
        }

        try {
          if (isStale()) {
            return
          }

          const syncedPubkeys = new Set<string>()
          const latestEnvelopesByPubkey = new Map<string, RelayEventEnvelope>()
          const latestEnvelopeSourcesByPubkey = new Map<
            string,
            'relay' | 'primal-cache'
          >()
          const latestProfileOverridesByPubkey = new Map<
            string,
            { picture?: string | null }
          >()

          const syncProfileEnvelope = (
            envelope: RelayEventEnvelope,
            options: {
              profileSource?: 'relay' | 'primal-cache'
              mediaFallbacks?: Record<string, string>
            } = {},
          ): boolean => {
            const profileSource = options.profileSource ?? 'relay'
            if (isStale()) {
              return false
            }

            const current = latestEnvelopesByPubkey.get(envelope.event.pubkey)
            const parsed = safeParseProfile(envelope.event.content)
            if (!parsed) {
              return false
            }
            const pictureFallback =
              parsed.pictureSource && options.mediaFallbacks
                ? normalizeMediaUrl(
                    options.mediaFallbacks[parsed.pictureSource],
                  ) ?? undefined
                : undefined
            const profileOverrides =
              pictureFallback && pictureFallback !== parsed.picture
                ? { picture: pictureFallback }
                : undefined

            if (
              current &&
              !isNewerReplaceableEnvelope(envelope, current) &&
              !isSameReplaceableEnvelope(envelope, current, profileOverrides)
            ) {
              return false
            }

            const cachedProfile = cachedProfilesByPubkey.get(
              envelope.event.pubkey,
            )
            if (
              cachedProfile &&
              !isEnvelopeNewerThanProfile(envelope, cachedProfile) &&
              !shouldPromoteRelayProfileSource(
                envelope,
                cachedProfile,
                profileSource,
                profileOverrides,
              )
            ) {
              return false
            }

            latestEnvelopesByPubkey.set(envelope.event.pubkey, envelope)
            latestEnvelopeSourcesByPubkey.set(
              envelope.event.pubkey,
              profileSource,
            )
            if (profileOverrides) {
              latestProfileOverridesByPubkey.set(
                envelope.event.pubkey,
                profileOverrides,
              )
            } else {
              latestProfileOverridesByPubkey.delete(envelope.event.pubkey)
            }

            syncNodeProfile(
              envelope.event.pubkey,
              {
                eventId: envelope.event.id,
                fetchedAt: envelope.receivedAtMs,
                profileSource,
                name: parsed.name,
                about: parsed.about,
                picture: profileOverrides?.picture ?? parsed.picture,
                nip05: parsed.nip05,
                lud16: parsed.lud16,
              },
              isAvatarTraceEnabled()
                ? {
                    inputSource: 'profile-envelope',
                    relayUrl: envelope.relayUrl,
                    profileSource,
                    eventId: envelope.event.id,
                    eventCreatedAt: envelope.event.created_at,
                    receivedAtMs: envelope.receivedAtMs,
                    mediaFallbackApplied: Boolean(profileOverrides?.picture),
                    rawPicture: summarizeAvatarPictureTransition(
                      null,
                      parsed.picture,
                    ).nextPicture,
                  fallbackPicture: summarizeAvatarPictureTransition(
                    null,
                    profileOverrides?.picture,
                  ).nextPicture,
                }
                : undefined,
              { buffered: true },
            )
            syncedPubkeys.add(envelope.event.pubkey)
            return true
          }

          // Optimización: lanzamos la consulta a Primal cache (CDN de perfiles)
          // EN PARALELO con la suscripción a relays. Antes era secuencial:
          // esperábamos a que terminaran TODOS los relays (hasta page timeout)
          // y recién después preguntábamos a Primal. Ahora ambos llegan al
          // mismo tiempo; `syncProfileEnvelope` ya tiene dedupe por created_at
          // y promueve la fuente correcta (relay > primal-cache) cuando empata.
          // Filtramos los pubkeys cuyo perfil cacheado en disco ya está completo
          // y fresco para no sobrecargar Primal innecesariamente.
          const primalCandidatePubkeys = batch.filter((pubkey) => {
            const cachedProfile = cachedProfilesByPubkey.get(pubkey)
            return (
              !cachedProfile ||
              !cachedProfile.picture ||
              !hasUsefulProfileFields(cachedProfile)
            )
          })

          const primalPromise =
            primalCandidatePubkeys.length > 0
              ? primalCacheClient
                  .fetchUserInfoProfileEvents(primalCandidatePubkeys)
                  .then((cachedProfiles) => {
                    if (isStale()) {
                      return
                    }
                    for (const cacheProfile of cachedProfiles) {
                      const envelope: RelayEventEnvelope = {
                        event: cacheProfile.event,
                        relayUrl: cacheProfile.cacheUrl,
                        receivedAtMs: cacheProfile.receivedAtMs,
                        attempt: 1,
                      }
                      syncProfileEnvelope(envelope, {
                        profileSource: 'primal-cache',
                        mediaFallbacks: cacheProfile.mediaFallbacks,
                      })
                    }
                  })
                  .catch((error) => {
                    logTerminalWarning('Perfiles', 'No respondio cache de perfiles', {
                      cantidad: primalCandidatePubkeys.length,
                      motivo: summarizeHumanTerminalError(error),
                    })
                  })
              : Promise.resolve()

          const relayPromise = new Promise<void>((resolve) => {
            let settled = false
            let cancel = () => {}

            const finalize = () => {
              if (settled) {
                return
              }

              settled = true
              cancel()
              resolve()
            }

            cancel = adapter
              .subscribe([{ authors: batch, kinds: [0] } satisfies Filter])
              .subscribe({
                next: syncProfileEnvelope,
                nextBatch: (envelopes) => {
                  for (const envelope of envelopes) {
                    syncProfileEnvelope(envelope)
                  }
                },
                error: finalize,
                complete: finalize,
              })
          })

          await Promise.all([relayPromise, primalPromise])

          if (isStale()) {
            return
          }

          const envelopes = Array.from(latestEnvelopesByPubkey.values()).sort(
            (left, right) => left.event.pubkey.localeCompare(right.event.pubkey),
          )

          if (collaborators?.persistProfileEvent) {
            void runWithConcurrencyLimit(
              envelopes,
              NODE_PROFILE_PERSIST_CONCURRENCY,
              async (envelope) => {
                const profileSource =
                  latestEnvelopeSourcesByPubkey.get(envelope.event.pubkey) ??
                  'relay'
                await collaborators.persistProfileEvent?.(
                  envelope,
                  profileSource === 'primal-cache'
                    ? {
                        cacheUrl: envelope.relayUrl,
                        source: 'primal-cache',
                        profileOverrides:
                          latestProfileOverridesByPubkey.get(
                            envelope.event.pubkey,
                          ),
                      }
                    : { source: 'relay' },
                )
              },
            ).catch((error) => {
              logTerminalWarning('Persistencia', 'No se pudieron guardar perfiles', {
                cantidad: envelopes.length,
                motivo: summarizeHumanTerminalError(error),
              })
            })
          }

          for (const pubkey of batch) {
            if (syncedPubkeys.has(pubkey)) {
              continue
            }
            const existingNode = ctx.store.getState().nodes[pubkey]
            if (!existingNode || existingNode.profileState === 'ready') {
              continue
            }
            markNodeProfileMissing(pubkey, { buffered: true })
          }
        } catch {
          if (isStale()) {
            return
          }

          markBatchProfilesMissing(batch)
        }
      }

      await runWithConcurrencyLimit(
        batches,
        NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
        processBatch,
      )
      flushPendingNodePatches('manual')
    } finally {
      flushPendingNodePatches('manual')
      adapter.close()
    }
  }

  function isNewerReplaceableEnvelope(
    next: RelayEventEnvelope,
    current: RelayEventEnvelope,
  ): boolean {
    if (next.event.created_at !== current.event.created_at) {
      return next.event.created_at > current.event.created_at
    }

    return next.event.id.localeCompare(current.event.id) < 0
  }

  function isEnvelopeNewerThanProfile(
    envelope: RelayEventEnvelope,
    profile: ProfileRecord,
  ): boolean {
    if (envelope.event.created_at !== profile.createdAt) {
      return envelope.event.created_at > profile.createdAt
    }

    return envelope.event.id.localeCompare(profile.eventId) < 0
  }

  function isSameReplaceableEnvelope(
    next: RelayEventEnvelope,
    current: RelayEventEnvelope,
    profileOverrides?: { picture?: string | null },
  ): boolean {
    return (
      Boolean(profileOverrides) &&
      next.event.created_at === current.event.created_at &&
      next.event.id === current.event.id
    )
  }

  function shouldPromoteRelayProfileSource(
    envelope: RelayEventEnvelope,
    profile: ProfileRecord,
    profileSource: 'relay' | 'primal-cache',
    profileOverrides?: { picture?: string | null },
  ): boolean {
    return (
      profile.profileSource === 'primal-cache' &&
      profileSource === 'relay' &&
      envelope.event.created_at === profile.createdAt &&
      envelope.event.id === profile.eventId
    ) || (
      Boolean(profileOverrides) &&
      envelope.event.created_at === profile.createdAt &&
      envelope.event.id === profile.eventId &&
      profile.picture !== profileOverrides?.picture
    )
  }

  function syncNodeProfile(
    pubkey: string,
    profile: NodeDetailProfile,
    traceContext?: Record<string, unknown>,
    options?: { buffered?: boolean },
  ): void {
    const existingNode = ctx.store.getState().nodes[pubkey]

    if (!existingNode) {
      return
    }

    const terminalAvatarFailure = getTerminalAvatarFailureForPicture(
      pubkey,
      profile.picture,
    )
    const nextPicture = terminalAvatarFailure ? null : profile.picture

    if (terminalAvatarFailure) {
      traceAvatarFlow('profileHydration.syncNodeProfile.invalidPictureSuppressed', {
        pubkey,
        pubkeyShort: truncateAvatarPubkey(pubkey),
        previousProfileState: existingNode.profileState,
        nextProfileState: 'ready',
        previousProfileSource: existingNode.profileSource,
        nextProfileSource: profile.profileSource ?? null,
        suppressedReason: terminalAvatarFailure.reason,
        suppressedHost: terminalAvatarFailure.host,
        ...summarizeAvatarPictureTransition(
          existingNode.picture,
          nextPicture,
        ),
        ...(traceContext ?? {}),
      })
    }

    if ((existingNode.picture ?? null) !== (nextPicture ?? null)) {
      traceAvatarFlow('profileHydration.syncNodeProfile.pictureChanged', {
        pubkey,
        pubkeyShort: truncateAvatarPubkey(pubkey),
        previousProfileState: existingNode.profileState,
        nextProfileState: 'ready',
        previousProfileSource: existingNode.profileSource,
        nextProfileSource: profile.profileSource ?? null,
        ...summarizeAvatarPictureTransition(
          existingNode.picture,
          nextPicture,
        ),
        ...(traceContext ?? {}),
      })
    }

    const patch: GraphNodePatch = {
      pubkey,
      label: profile.name ?? undefined,
      picture: nextPicture,
      about: profile.about,
      nip05: profile.nip05,
      lud16: profile.lud16,
      profileEventId: profile.eventId,
      profileFetchedAt: profile.fetchedAt,
      profileSource: profile.profileSource ?? null,
      profileState: 'ready',
    }

    if (options?.buffered) {
      queueNodePatch(patch)
      return
    }

    ctx.store.getState().upsertNodePatches([patch])
  }

  function markNodeProfileMissing(
    pubkey: string,
    options?: { buffered?: boolean },
  ): void {
    const existingNode = ctx.store.getState().nodes[pubkey]

    if (!existingNode || existingNode.profileState === 'ready') {
      return
    }

    if (existingNode.picture) {
      traceAvatarFlow('profileHydration.markNodeProfileMissing.pictureCleared', {
        pubkey,
        pubkeyShort: truncateAvatarPubkey(pubkey),
        previousProfileState: existingNode.profileState,
        nextProfileState: 'missing',
        previousProfileSource: existingNode.profileSource,
        nextProfileSource: null,
        ...summarizeAvatarPictureTransition(existingNode.picture, null),
      })
    }

    const patch: GraphNodePatch = {
      pubkey,
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'missing',
    }

    if (options?.buffered) {
      queueNodePatch(patch)
      return
    }

    ctx.store.getState().upsertNodePatches([patch])
  }

  return { hydrateNodeProfiles, syncNodeProfile, markNodeProfileMissing }
}

export type ProfileHydrationModule = ReturnType<
  typeof createProfileHydrationModule
>

const mergeNodePatch = (
  existingPatch: GraphNodePatch,
  nextPatch: GraphNodePatch,
): GraphNodePatch => {
  const mergedPatch = { ...existingPatch }

  for (const [key, value] of Object.entries(nextPatch) as Array<
    [keyof GraphNodePatch, GraphNodePatch[keyof GraphNodePatch]]
  >) {
    if (value !== undefined) {
      Object.assign(mergedPatch, { [key]: value })
    }
  }

  return mergedPatch
}

const hasUsefulProfileFields = (profile: {
  name?: string | null
  about?: string | null
  picture?: string | null
  nip05?: string | null
  lud16?: string | null
}) =>
  Boolean(
    profile.name?.trim() ||
      profile.about?.trim() ||
      profile.picture?.trim() ||
      profile.nip05?.trim() ||
      profile.lud16?.trim(),
  )
