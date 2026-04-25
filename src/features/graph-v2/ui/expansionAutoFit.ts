import type { CanonicalGraphSceneState } from '@/features/graph-v2/domain/types'

export interface ExpansionAutoFitRequest {
  pubkey: string
  sceneSignature: string
  nodeCount: number
  edgeCount: number
  graphRevision: number
  inboundGraphRevision: number
  connectionsLinksRevision: number
}

interface ExpansionAutoFitScheduleInput {
  isExpanded: boolean
  isFixtureMode: boolean
  isMobileViewport: boolean
}

export const shouldScheduleExpansionAutoFit = ({
  isExpanded,
  isFixtureMode,
  isMobileViewport,
}: ExpansionAutoFitScheduleInput) =>
  !isExpanded && !isFixtureMode && !isMobileViewport

export const createExpansionAutoFitRequest = (
  pubkey: string,
  sceneState: CanonicalGraphSceneState,
): ExpansionAutoFitRequest => ({
  pubkey,
  sceneSignature: sceneState.sceneSignature,
  nodeCount: Object.keys(sceneState.nodesByPubkey).length,
  edgeCount: Object.keys(sceneState.edgesById).length,
  graphRevision: sceneState.discoveryState.graphRevision,
  inboundGraphRevision: sceneState.discoveryState.inboundGraphRevision,
  connectionsLinksRevision: sceneState.discoveryState.connectionsLinksRevision,
})

export const shouldRunExpansionAutoFit = (
  request: ExpansionAutoFitRequest,
  sceneState: CanonicalGraphSceneState,
  isSceneTransitionPending: boolean,
) => {
  if (isSceneTransitionPending) {
    return false
  }

  if (!sceneState.discoveryState.expandedNodePubkeys.has(request.pubkey)) {
    return false
  }

  return (
    sceneState.sceneSignature !== request.sceneSignature ||
    Object.keys(sceneState.nodesByPubkey).length !== request.nodeCount ||
    Object.keys(sceneState.edgesById).length !== request.edgeCount ||
    sceneState.discoveryState.graphRevision !== request.graphRevision ||
    sceneState.discoveryState.inboundGraphRevision !==
      request.inboundGraphRevision ||
    sceneState.discoveryState.connectionsLinksRevision !==
      request.connectionsLinksRevision
  )
}

export const shouldClearExpansionAutoFitRequest = (
  request: ExpansionAutoFitRequest,
  sceneState: CanonicalGraphSceneState,
) => {
  const node = sceneState.nodesByPubkey[request.pubkey]
  return node?.nodeExpansionState?.status === 'error'
}
