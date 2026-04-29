export interface GraphSceneNodeSizeConfig {
  rootSize: number
  expandedSize: number
}

export const DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG: GraphSceneNodeSizeConfig = {
  rootSize: 72,
  expandedSize: 40,
}

export const MIN_GRAPH_SCENE_NODE_SIZE = 9
export const MAX_GRAPH_SCENE_NODE_SIZE = 72
export const GRAPH_SCENE_NODE_SIZE_STEP = 1

const clampGraphSceneNodeSizeValue = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(
    MAX_GRAPH_SCENE_NODE_SIZE,
    Math.max(MIN_GRAPH_SCENE_NODE_SIZE, Math.round(value)),
  )
}

export const normalizeGraphSceneNodeSizeConfig = (
  config: Partial<GraphSceneNodeSizeConfig> | null | undefined,
): GraphSceneNodeSizeConfig => ({
  rootSize: clampGraphSceneNodeSizeValue(
    config?.rootSize ?? DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG.rootSize,
    DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG.rootSize,
  ),
  expandedSize: clampGraphSceneNodeSizeValue(
    config?.expandedSize ?? DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG.expandedSize,
    DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG.expandedSize,
  ),
})

export const getGraphSceneNodeSizeConfigSignature = (
  config: Partial<GraphSceneNodeSizeConfig> | null | undefined,
) => {
  const normalized = normalizeGraphSceneNodeSizeConfig(config)
  return `${normalized.rootSize}:${normalized.expandedSize}`
}
