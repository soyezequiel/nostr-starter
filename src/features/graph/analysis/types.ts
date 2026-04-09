export type DiscoveredGraphAnalysisStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'partial'
  | 'error'

export type DiscoveredGraphAnalysisMode = 'full' | 'heuristic'

export type DiscoveredGraphAnalysisConfidence = 'low' | 'medium' | 'high'

export type DiscoveredGraphAnalysisFlag =
  | 'relay-health-mixed'
  | 'relay-health-poor'
  | 'graph-sparse'
  | 'cap-reached'
  | 'stale-relay-override'
  | 'budget-exceeded'
  | 'isolated-topology'

export interface DiscoveredGraphRelayHealthSummary {
  totalRelayCount: number
  healthyRelayCount: number
  degradedRelayCount: number
  offlineRelayCount: number
}

export interface DiscoveredGraphCommunity {
  id: string
  size: number
  confidence: DiscoveredGraphAnalysisConfidence
  memberPubkeys: string[]
}

export interface DiscoveredGraphNodeAnalysis {
  pubkey: string
  communityId: string | null
  communitySize: number
  leaderScore: number
  bridgeScore: number
  leaderQuantile: number
  bridgeQuantile: number
  confidence: DiscoveredGraphAnalysisConfidence
  useNeutralFill: boolean
  isLeader: boolean
  isBridge: boolean
}

export interface DiscoveredGraphAnalysisResult {
  analysisKey: string
  mode: DiscoveredGraphAnalysisMode
  confidence: DiscoveredGraphAnalysisConfidence
  nodeCount: number
  analyzedNodeCount: number
  communityCount: number
  relayHealth: DiscoveredGraphRelayHealthSummary
  flags: DiscoveredGraphAnalysisFlag[]
  communities: DiscoveredGraphCommunity[]
  nodeAnalysis: Record<string, DiscoveredGraphNodeAnalysis>
}

export interface DiscoveredGraphAnalysisState {
  status: DiscoveredGraphAnalysisStatus
  isStale: boolean
  analysisKey: string | null
  message: string | null
  result: DiscoveredGraphAnalysisResult | null
}
