import type { AppStoreApi } from '@/features/graph/app/store/types'
import type { NostrGraphRepositories } from '@/features/graph/db/repositories'
import type { FrozenSnapshot, FrozenUserData } from '@/features/graph/export/types'

export interface SnapshotFreezerDependencies {
  store: AppStoreApi
  repositories: NostrGraphRepositories
  now?: () => number
}

export async function freezeSnapshot(
  deps: SnapshotFreezerDependencies,
): Promise<FrozenSnapshot> {
  const state = deps.store.getState()
  const nowMs = (deps.now ?? Date.now)()
  const captureUpperBoundSec = Math.floor(nowMs / 1000 / 3600) * 3600

  const nodes = Object.values(state.nodes)
  const links = [...state.links]
  const adjacency: Record<string, string[]> = {}

  for (const [pubkey, neighbors] of Object.entries(state.adjacency)) {
    adjacency[pubkey] = [...neighbors].sort()
  }

  const relays = [...state.relayUrls].sort()
  const graphCaps = { ...state.graphCaps }
  const pubkeys = Object.keys(state.nodes).sort()
  const activeKeyword = state.currentKeyword.trim()

  const users = new Map<string, FrozenUserData>()

  for (const pubkey of pubkeys) {
    const userData = await freezeUserData(pubkey, deps.repositories)
    users.set(pubkey, userData)
  }

  const captureId = buildCaptureId(nowMs)

  return {
    captureId,
    capturedAtIso: new Date(nowMs).toISOString(),
    captureUpperBoundSec,
    executionMode: 'snapshot',
    relays,
    graphCaps,
    nodes: nodes.sort((a, b) => a.pubkey.localeCompare(b.pubkey)),
    links: links.sort((a, b) => {
      const srcCmp = a.source.localeCompare(b.source)
      if (srcCmp !== 0) return srcCmp
      return a.target.localeCompare(b.target)
    }),
    adjacency,
    keywordSearch: {
      keyword: activeKeyword || null,
      totalHits: nodes.reduce((total, node) => total + node.keywordHits, 0),
      matchedNodeCount: nodes.filter((node) => node.keywordHits > 0).length,
    },
    users,
  }
}

async function freezeUserData(
  pubkey: string,
  repos: NostrGraphRepositories,
): Promise<FrozenUserData> {
  const [profile, contactList, replaceableHeads, addressableHeads, zaps, inboundRefs] =
    await Promise.all([
      repos.profiles.get(pubkey),
      repos.contactLists.get(pubkey),
      queryReplaceableHeadsByPubkey(pubkey, repos),
      queryAddressableHeadsByPubkey(pubkey, repos),
      repos.zaps.findByPubkey(pubkey),
      repos.inboundRefs.findByTargetPubkey(pubkey),
    ])

  const allZaps = zaps
  const zapsSent = allZaps.filter((z) => z.fromPubkey === pubkey)
  const zapsReceived = allZaps.filter((z) => z.toPubkey === pubkey)

  const rawEvents = await queryRawEventsByPubkey(pubkey, repos)

  return {
    pubkey,
    profile: profile ?? null,
    contactList: contactList ?? null,
    replaceableHeads: replaceableHeads.sort((a, b) => a.kind - b.kind),
    addressableHeads: addressableHeads.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind - b.kind
      return (a.dTag ?? '').localeCompare(b.dTag ?? '')
    }),
    rawEvents,
    zapsSent,
    zapsReceived,
    inboundRefs,
  }
}

async function queryReplaceableHeadsByPubkey(
  pubkey: string,
  repos: NostrGraphRepositories,
): Promise<FrozenUserData['replaceableHeads']> {
  const knownKinds = [0, 3, 10002]
  const results = await Promise.all(
    knownKinds.map((kind) => repos.replaceableHeads.get(pubkey, kind)),
  )
  return results.filter((r): r is NonNullable<typeof r> => r != null)
}

async function queryAddressableHeadsByPubkey(
  pubkey: string,
  repos: NostrGraphRepositories,
): Promise<FrozenUserData['addressableHeads']> {
  void pubkey
  void repos
  return []
}

async function queryRawEventsByPubkey(
  pubkey: string,
  repos: NostrGraphRepositories,
): Promise<FrozenUserData['rawEvents']> {
  const knownKinds = [0, 1, 3, 5, 6, 7, 16, 1111, 9735, 10002]
  const results = await Promise.all(
    knownKinds.map((kind) => repos.rawEvents.findByPubkeyAndKind(pubkey, kind)),
  )
  return results.flat().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    if (a.kind !== b.kind) return a.kind - b.kind
    return a.id.localeCompare(b.id)
  })
}

function buildCaptureId(nowMs: number): string {
  const date = new Date(nowMs)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const ts = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('')
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}`
}
