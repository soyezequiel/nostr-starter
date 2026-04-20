import type { UiLayer } from '@/features/graph-runtime/app/store/types'

export const GRAPH_V2_LAYERS = [
  'graph',
  'connections',
  'following',
  'followers',
  'mutuals',
  'following-non-followers',
  'nonreciprocal-followers',
] as const

export type GraphV2Layer = (typeof GRAPH_V2_LAYERS)[number]

export const DEFAULT_GRAPH_V2_LAYER: GraphV2Layer = 'graph'

export const isGraphV2Layer = (layer: UiLayer): layer is GraphV2Layer =>
  GRAPH_V2_LAYERS.includes(layer as GraphV2Layer)

export const createCanonicalEdgeId = (
  source: string,
  target: string,
  relation: string,
) => `${source}->${target}:${relation}`

export const comparePubkeys = (left: string, right: string) =>
  left.localeCompare(right, undefined, {
    numeric: false,
    sensitivity: 'base',
  })

