import type { Filter } from 'nostr-tools'

import type { NodeDetailProfile } from '@/features/graph/kernel/runtime'
import type { KernelContext } from '@/features/graph/kernel/modules/context'
import type { ProfileRecord } from '@/features/graph/db/entities'
import type { RelayEventEnvelope } from '@/features/graph/nostr'
import {
  NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
  NODE_PROFILE_HYDRATION_BATCH_SIZE,
  NODE_PROFILE_PERSIST_CONCURRENCY,
} from '@/features/graph/kernel/modules/constants'
import {
  mapProfileRecordToNodeProfile,
  runWithConcurrencyLimit,
  safeParseProfile,
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
      persistProfileEvent?: (pubkeyEnvelope: RelayEventEnvelope) => Promise<void>
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

          const cachedProfilesByPubkey = new Map<string, ProfileRecord>()
          for (const cachedProfile of cachedProfiles) {
            if (!cachedProfile) {
              continue
            }

            cachedProfilesByPubkey.set(cachedProfile.pubkey, cachedProfile)
            syncNodeProfile(
              cachedProfile.pubkey,
              mapProfileRecordToNodeProfile(cachedProfile),
            )
          }

          if (isStale()) {
            return
          }

          const syncedPubkeys = new Set<string>()
          const latestEnvelopesByPubkey = new Map<string, RelayEventEnvelope>()

          const syncProfileEnvelope = (envelope: RelayEventEnvelope) => {
            if (isStale()) {
              return
            }

            const current = latestEnvelopesByPubkey.get(envelope.event.pubkey)
            if (current && !isNewerReplaceableEnvelope(envelope, current)) {
              return
            }

            const cachedProfile = cachedProfilesByPubkey.get(
              envelope.event.pubkey,
            )
            if (
              cachedProfile &&
              !isEnvelopeNewerThanProfile(envelope, cachedProfile)
            ) {
              return
            }

            latestEnvelopesByPubkey.set(envelope.event.pubkey, envelope)
            const parsed = safeParseProfile(envelope.event.content)
            if (!parsed) {
              return
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

          await new Promise<void>((resolve) => {
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
                await collaborators.persistProfileEvent?.(envelope)
              },
            ).catch(console.warn)
          }

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
