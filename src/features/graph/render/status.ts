import type {
  DeriveGraphRenderStateInput,
  GraphRenderDegradedReason,
  GraphRenderState,
} from '@/features/graph/render/types'

const describeReason = (reason: GraphRenderDegradedReason) => {
  switch (reason) {
    case 'cap-reached':
      return 'cap alcanzado'
    case 'edge-thinning':
      return 'edge thinning activo'
    case 'labels-suppressed':
      return 'labels limitadas por budget'
    case 'worker-error':
      return 'worker de render con error'
  }
}

export const deriveGraphRenderState = ({
  model,
  hasViewport,
  rootLoadStatus,
  capReached,
  modelPhase,
}: DeriveGraphRenderStateInput): GraphRenderState => {
  const reasons = [...model.lod.degradedReasons]

  if (capReached) {
    reasons.push('cap-reached')
  }

  if (modelPhase === 'error') {
    reasons.push('worker-error')
  }

  if (model.nodes.length === 0) {
    return {
      status:
        modelPhase === 'idle' ||
        modelPhase === 'building' ||
        rootLoadStatus === 'loading'
          ? 'rendering'
          : 'empty',
      reasons,
    }
  }

  if (!hasViewport) {
    return {
      status: 'rendering',
      reasons,
    }
  }

  return {
    status: reasons.length > 0 ? 'degraded' : 'interactive',
    reasons,
  }
}

export const formatGraphRenderStateLabel = (state: GraphRenderState) =>
  state.status === 'degraded'
    ? `degraded (${state.reasons.map(describeReason).join(', ')})`
    : state.status
