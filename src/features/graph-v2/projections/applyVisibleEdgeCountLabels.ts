import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'

export const buildVisibleEdgeDegreeByPubkey = (
  scene: GraphSceneSnapshot,
): Map<string, number> => {
  const degreeByPubkey = new Map<string, number>()

  for (const node of scene.render.nodes) {
    degreeByPubkey.set(node.pubkey, 0)
  }

  for (const edge of scene.render.visibleEdges) {
    if (edge.hidden) continue
    if (degreeByPubkey.has(edge.source)) {
      degreeByPubkey.set(edge.source, (degreeByPubkey.get(edge.source) ?? 0) + 1)
    }
    if (edge.target !== edge.source && degreeByPubkey.has(edge.target)) {
      degreeByPubkey.set(edge.target, (degreeByPubkey.get(edge.target) ?? 0) + 1)
    }
  }

  return degreeByPubkey
}

export const applyVisibleEdgeCountLabels = (
  scene: GraphSceneSnapshot,
  enabled: boolean,
): GraphSceneSnapshot => {
  if (!enabled) return scene

  const degreeByPubkey = buildVisibleEdgeDegreeByPubkey(scene)
  const nodes = scene.render.nodes.map((node) => {
    const label = String(degreeByPubkey.get(node.pubkey) ?? 0)

    return {
      ...node,
      label,
      forceLabel: true,
    }
  })

  return {
    ...scene,
    render: {
      ...scene.render,
      nodes,
      labels: nodes.map((node) => ({
        pubkey: node.pubkey,
        text: node.label,
      })),
    },
  }
}
