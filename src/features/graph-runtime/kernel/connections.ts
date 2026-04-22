import type { GraphLink } from '@/features/graph-runtime/app/store/types'
import type { ContactListRecord } from '@/features/graph-runtime/db/entities'

export type ConnectionContactListRecord = Pick<
  ContactListRecord,
  'pubkey' | 'eventId' | 'createdAt' | 'fetchedAt' | 'follows' | 'relayHints'
>

export interface ConnectionsDerivedState {
  links: GraphLink[]
  signature: string
}

export const compareConnectionPubkeys = (left: string, right: string) => {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

const compareConnectionLinks = (left: GraphLink, right: GraphLink) => {
  const sourceOrder = compareConnectionPubkeys(left.source, right.source)
  if (sourceOrder !== 0) {
    return sourceOrder
  }

  return compareConnectionPubkeys(left.target, right.target)
}

const hashLinkPart = (hash: number, value: string) => {
  let nextHash = hash

  for (let index = 0; index < value.length; index += 1) {
    nextHash = Math.imul(nextHash ^ value.charCodeAt(index), 16_777_619)
  }

  return nextHash >>> 0
}

const createConnectionsSignature = (links: readonly GraphLink[]) => {
  let hashA = 2_166_136_261
  let hashB = 5381

  for (const link of links) {
    hashA = hashLinkPart(hashA, link.source)
    hashA = hashLinkPart(hashA, '>')
    hashA = hashLinkPart(hashA, link.target)

    for (let index = 0; index < link.source.length; index += 1) {
      hashB = ((hashB << 5) + hashB + link.source.charCodeAt(index)) >>> 0
    }
    hashB = ((hashB << 5) + hashB + 62) >>> 0
    for (let index = 0; index < link.target.length; index += 1) {
      hashB = ((hashB << 5) + hashB + link.target.charCodeAt(index)) >>> 0
    }
  }

  return `${links.length}:${hashA.toString(36)}:${hashB.toString(36)}`
}

export const areGraphLinksEqual = (
  left: readonly GraphLink[],
  right: readonly GraphLink[],
) => {
  if (left === right) {
    return true
  }

  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftLink = left[index]
    const rightLink = right[index]

    if (
      leftLink.source !== rightLink.source ||
      leftLink.target !== rightLink.target ||
      leftLink.relation !== rightLink.relation ||
      (leftLink.weight ?? 1) !== (rightLink.weight ?? 1)
    ) {
      return false
    }
  }

  return true
}

export const createConnectionsDerivedState = (
  rootPubkey: string,
  graphNodePubkeys: ReadonlySet<string>,
  contactListsByPubkey: ReadonlyMap<string, ConnectionContactListRecord>,
): ConnectionsDerivedState => {
  const derivedLinks: GraphLink[] = []
  const orderedGraphPubkeys = Array.from(graphNodePubkeys).sort(
    compareConnectionPubkeys,
  )

  for (const pubkey of orderedGraphPubkeys) {
    if (pubkey === rootPubkey) {
      continue
    }

    const contactList = contactListsByPubkey.get(pubkey)
    if (!contactList || contactList.follows.length === 0) {
      continue
    }

    const seenTargets = new Set<string>()
    for (const followPubkey of contactList.follows) {
      if (
        followPubkey === pubkey ||
        followPubkey === rootPubkey ||
        !graphNodePubkeys.has(followPubkey) ||
        seenTargets.has(followPubkey)
      ) {
        continue
      }

      seenTargets.add(followPubkey)
      derivedLinks.push({
        source: pubkey,
        target: followPubkey,
        relation: 'follow',
      })
    }
  }

  derivedLinks.sort(compareConnectionLinks)

  return {
    links: derivedLinks,
    signature: createConnectionsSignature(derivedLinks),
  }
}
