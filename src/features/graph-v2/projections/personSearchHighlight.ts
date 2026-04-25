import type {
  GraphRenderNode,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'

const DIACRITIC_MARKS_RE = /[\u0300-\u036f]/g
const PERSON_SEARCH_MATCH_COLOR = '#5ff2c2'
const PERSON_SEARCH_SIZE_BOOST = 6

export interface PersonSearchMatch {
  pubkey: string
  label: string
}

export const normalizePersonSearchTerm = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(DIACRITIC_MARKS_RE, '')
    .toLocaleLowerCase()

export const buildPersonSearchMatches = (
  nodes: readonly GraphRenderNode[],
  query: string,
): PersonSearchMatch[] => {
  const normalizedQuery = normalizePersonSearchTerm(query)
  if (!normalizedQuery) return []

  return nodes
    .filter((node) =>
      normalizePersonSearchTerm(node.label).includes(normalizedQuery),
    )
    .map((node) => ({
      pubkey: node.pubkey,
      label: node.label,
    }))
}

export const applyPersonSearchHighlight = (
  scene: GraphSceneSnapshot,
  matches: readonly PersonSearchMatch[],
): GraphSceneSnapshot => {
  if (matches.length === 0) return scene

  const matchPubkeys = new Set(matches.map((match) => match.pubkey))

  return {
    ...scene,
    render: {
      ...scene.render,
      nodes: scene.render.nodes.map((node) => {
        if (!matchPubkeys.has(node.pubkey)) return node

        return {
          ...node,
          color: PERSON_SEARCH_MATCH_COLOR,
          size: node.size + PERSON_SEARCH_SIZE_BOOST,
          isDimmed: false,
        }
      }),
    },
  }
}
