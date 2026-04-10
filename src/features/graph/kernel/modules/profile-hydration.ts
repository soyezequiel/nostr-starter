import type { Filter } from 'nostr-tools'

import type { NodeDetailProfile } from '@/features/graph/kernel/runtime'
import type { KernelContext } from '@/features/graph/kernel/modules/context'
import {
  NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
  NODE_PROFILE_HYDRATION_BATCH_SIZE,
  NODE_PROFILE_PERSIST_CONCURRENCY,
} from '@/features/graph/kernel/modules/constants'
import {
  collectRelayEvents,
  mapProfileRecordToNodeProfile,
  runWithConcurrencyLimit,
  safeParseProfile,
  selectLatestReplaceableEventsByPubkey,
} from '@/features/graph/kernel/modules/helpers'

export function createProfileHydrationModule(ctx: KernelContext) {
  const markBatchProfilesMissing = (batch: readonly string[]) => {
    for (const pubkey of batch) {
      const existingNode = ctx.store.getState().nodes[pubkey]
      if (!existingNode || existingNode.profileState === 'ready') {
        continue
      }

      markNodeProfileMissing(pubkey)
    }
  }

  async function hydrateNodeProfiles(
    pubkeys: string[],
    relayUrls: string[],
    isStale: () => boolean,
    collaborators?: {
      persistProfileEvent?: (pubkeyEnvelope: Parameters<
        typeof selectLatestReplaceableEventsByPubkey
      >[0][number]) => Promise<void>
    },
  ): Promise<void> {
    const uniquePubkeys = Array.from(new Set(pubkeys.filter(Boolean)))
    if (uniquePubkeys.length === 0) {
      return
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

    const adapter = ctx.createRelayAdapter({ relayUrls })

    try {
      const processBatch = async (batch: string[]) => {
        if (isStale()) {
          return
        }

        try {
          const cachedProfiles = await Promise.all(
            batch.map((pubkey) => ctx.repositories.profiles.get(pubkey)),
          )

          if (isStale()) {
            return
          }

          for (const cachedProfile of cachedProfiles) {
            if (!cachedProfile) {
              continue
            }

            syncNodeProfile(
              cachedProfile.pubkey,
              mapProfileRecordToNodeProfile(cachedProfile),
            )
          }

          if (isStale()) {
            return
          }

          const profileResult = await collectRelayEvents(
            adapter,
            [{ authors: batch, kinds: [0] } satisfies Filter],
          )

          if (isStale()) {
            return
          }

          const envelopes = selectLatestReplaceableEventsByPubkey(
            profileResult.events,
          )

          // Sincronizar perfiles frescos al store INMEDIATAMENTE, sin esperar
          // los writes a IDB. Esto permite que el pipeline de imágenes arranque
          // mientras la persistencia ocurre en background.
          const syncedPubkeys = new Set<string>()
          for (const envelope of envelopes) {
            const parsed = safeParseProfile(envelope.event.content)
            if (!parsed) {
              continue
            }
            syncNodeProfile(envelope.event.pubkey, {
              eventId: envelope.event.id,
              fetchedAt: envelope.receivedAtMs,
              name: parsed.name,
              about: parsed.about,
              picture: parsed.picture,
              nip05: parsed.nip05,
              lud16: parsed.lud16,
            })
            syncedPubkeys.add(envelope.event.pubkey)
          }

          if (isStale()) {
            return
          }

          // Persistir a IDB en background (no bloquea la UI)
          if (collaborators?.persistProfileEvent) {
            void runWithConcurrencyLimit(
              envelopes,
              NODE_PROFILE_PERSIST_CONCURRENCY,
              async (envelope) => {
                await collaborators.persistProfileEvent?.(envelope)
              },
            ).catch(console.warn)
          }

          // Marcar como missing solo los pubkeys que no recibieron perfil
          for (const pubkey of batch) {
            if (syncedPubkeys.has(pubkey)) {
              continue
            }
            const existingNode = ctx.store.getState().nodes[pubkey]
            if (!existingNode || existingNode.profileState === 'ready') {
              continue
            }
            markNodeProfileMissing(pubkey)
          }
        } catch {
          if (isStale()) {
            return
          }

          // Background hydration should degrade gracefully instead of leaving
          // nodes stuck in loading forever.
          markBatchProfilesMissing(batch)
        }
      }

      await runWithConcurrencyLimit(
        batches,
        NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
        processBatch,
      )
    } finally {
      adapter.close()
    }
  }

  function syncNodeProfile(pubkey: string, profile: NodeDetailProfile): void {
    const existingNode = ctx.store.getState().nodes[pubkey]

    if (!existingNode) {
      return
    }

    ctx.store.getState().upsertNodes([
      {
        ...existingNode,
        label: profile.name ?? undefined,
        picture: profile.picture,
        about: profile.about,
        nip05: profile.nip05,
        lud16: profile.lud16,
        profileEventId: profile.eventId,
        profileFetchedAt: profile.fetchedAt,
        profileState: 'ready',
      },
    ])
  }

  function markNodeProfileMissing(pubkey: string): void {
    const existingNode = ctx.store.getState().nodes[pubkey]

    if (!existingNode || existingNode.profileState === 'ready') {
      return
    }

    ctx.store.getState().upsertNodes([
      {
        ...existingNode,
        picture: null,
        about: null,
        nip05: null,
        lud16: null,
        profileEventId: null,
        profileFetchedAt: null,
        profileState: 'missing',
      },
    ])
  }
  return { hydrateNodeProfiles, syncNodeProfile, markNodeProfileMissing }
}

export type ProfileHydrationModule = ReturnType<
  typeof createProfileHydrationModule
>
