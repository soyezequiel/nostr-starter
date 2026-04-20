import type { CanonicalGraphSceneState } from '@/features/graph-v2/domain/types'
import type { NodeDetailProjection } from '@/features/graph-v2/renderer/contracts'

export const buildNodeDetailProjection = (
  state: CanonicalGraphSceneState,
): NodeDetailProjection => {
  const pubkey = state.selectedNodePubkey

  if (!pubkey) {
    return {
      node: null,
      pubkey: null,
      displayName: null,
      about: null,
      pictureUrl: null,
      nip05: null,
      lud16: null,
      followingCount: 0,
      followerCount: 0,
      mutualCount: 0,
      isPinned: false,
      isFixed: false,
      canTogglePin: false,
      isExpanded: false,
    }
  }

  const node = state.nodesByPubkey[pubkey] ?? null
  const edges = Object.values(state.edgesById)
  const following = new Set(
    edges
      .filter((edge) => edge.source === pubkey)
      .map((edge) => edge.target),
  )
  const followers = new Set(
    edges
      .filter((edge) => edge.target === pubkey)
      .map((edge) => edge.source),
  )
  const isPinned = state.pinnedNodePubkeys.has(pubkey)

  return {
    node,
    pubkey,
    displayName: node?.label?.trim() || pubkey,
    about: node?.about ?? null,
    pictureUrl: node?.picture ?? null,
    nip05: node?.nip05 ?? null,
    lud16: node?.lud16 ?? null,
    followingCount: following.size,
    followerCount: followers.size,
    mutualCount: Array.from(following).filter((target) => followers.has(target)).length,
    isPinned,
    isFixed: isPinned,
    canTogglePin: true,
    isExpanded: node?.isExpanded ?? false,
  }
}
