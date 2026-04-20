import type { CanonicalNode } from '@/features/graph-v2/domain/types'

export interface VisibleProfileWarmupSelectionInput {
  viewportPubkeys: readonly string[]
  scenePubkeys: readonly string[]
  nodesByPubkey: Readonly<Record<string, CanonicalNode>>
  attemptedAtByPubkey: ReadonlyMap<string, number>
  inflightPubkeys: ReadonlySet<string>
  now: number
  batchSize: number
  cooldownMs: number
}

export interface VisibleProfileWarmupSelection {
  pubkeys: string[]
  viewportPubkeyCount: number
  scenePubkeyCount: number
  orderedPubkeyCount: number
  eligibleCount: number
  skipped: {
    missingNode: number
    alreadyUsable: number
    inflight: number
    cooldown: number
  }
}

export interface VisibleProfileWarmupDebugSnapshot
  extends VisibleProfileWarmupSelection {
  generatedAtMs: number
  selectedSamples: string[]
  attemptedCount: number
  inflightCount: number
  profileStates: ProfileWarmupStateCounts
  viewportProfileStates: ProfileWarmupStateCounts
}

interface ProfileWarmupStateCounts {
  idle: number
  loading: number
  readyUsable: number
  readyEmpty: number
  missing: number
  unknown: number
}

export const hasUsableCanonicalProfile = (
  node: CanonicalNode | null | undefined,
) =>
  Boolean(
    node?.label?.trim() ||
      node?.picture?.trim() ||
      node?.about?.trim() ||
      node?.nip05?.trim() ||
      node?.lud16?.trim(),
  )

export const shouldWarmVisibleProfile = (
  node: CanonicalNode | null | undefined,
) => Boolean(node && (node.profileState !== 'ready' || !hasUsableCanonicalProfile(node)))

export const orderProfileWarmupPubkeys = ({
  viewportPubkeys,
  scenePubkeys,
}: {
  viewportPubkeys: readonly string[]
  scenePubkeys: readonly string[]
}) => Array.from(new Set([...viewportPubkeys, ...scenePubkeys].filter(Boolean)))

export const selectVisibleProfileWarmupPubkeys = ({
  viewportPubkeys,
  scenePubkeys,
  nodesByPubkey,
  attemptedAtByPubkey,
  inflightPubkeys,
  now,
  batchSize,
  cooldownMs,
}: VisibleProfileWarmupSelectionInput): VisibleProfileWarmupSelection => {
  const orderedPubkeys = orderProfileWarmupPubkeys({
    viewportPubkeys,
    scenePubkeys,
  })
  const pubkeys: string[] = []
  const skipped = {
    missingNode: 0,
    alreadyUsable: 0,
    inflight: 0,
    cooldown: 0,
  }
  let eligibleCount = 0

  for (const pubkey of orderedPubkeys) {
    const node = nodesByPubkey[pubkey]
    if (!node) {
      skipped.missingNode += 1
      continue
    }
    if (!shouldWarmVisibleProfile(node)) {
      skipped.alreadyUsable += 1
      continue
    }

    eligibleCount += 1

    if (inflightPubkeys.has(pubkey)) {
      skipped.inflight += 1
      continue
    }

    const attemptedAt = attemptedAtByPubkey.get(pubkey) ?? 0
    if (now - attemptedAt < cooldownMs) {
      skipped.cooldown += 1
      continue
    }

    if (pubkeys.length < batchSize) {
      pubkeys.push(pubkey)
    }
  }

  return {
    pubkeys,
    viewportPubkeyCount: viewportPubkeys.length,
    scenePubkeyCount: scenePubkeys.length,
    orderedPubkeyCount: orderedPubkeys.length,
    eligibleCount,
    skipped,
  }
}

export const buildVisibleProfileWarmupDebugSnapshot = (
  input: VisibleProfileWarmupSelectionInput,
): VisibleProfileWarmupDebugSnapshot => {
  const selection = selectVisibleProfileWarmupPubkeys(input)
  const orderedPubkeys = orderProfileWarmupPubkeys(input)

  return {
    ...selection,
    generatedAtMs: input.now,
    selectedSamples: selection.pubkeys.map((pubkey) => pubkey.slice(0, 12)),
    attemptedCount: input.attemptedAtByPubkey.size,
    inflightCount: input.inflightPubkeys.size,
    profileStates: countProfileStates(orderedPubkeys, input.nodesByPubkey),
    viewportProfileStates: countProfileStates(
      input.viewportPubkeys,
      input.nodesByPubkey,
    ),
  }
}

const countProfileStates = (
  pubkeys: readonly string[],
  nodesByPubkey: Readonly<Record<string, CanonicalNode>>,
): ProfileWarmupStateCounts => {
  const counts: ProfileWarmupStateCounts = {
    idle: 0,
    loading: 0,
    readyUsable: 0,
    readyEmpty: 0,
    missing: 0,
    unknown: 0,
  }

  for (const pubkey of pubkeys) {
    const node = nodesByPubkey[pubkey]
    if (!node) {
      counts.unknown += 1
      continue
    }

    if (node.profileState === 'ready') {
      if (hasUsableCanonicalProfile(node)) {
        counts.readyUsable += 1
      } else {
        counts.readyEmpty += 1
      }
      continue
    }

    counts[node.profileState] += 1
  }

  return counts
}
