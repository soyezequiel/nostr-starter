export type ZapIdentityPanelMode = 'scene' | 'off-graph'

export const resolveZapIdentityPanelMode = ({
  pubkey,
  renderedNodePubkeys,
}: {
  pubkey: string
  renderedNodePubkeys: ReadonlySet<string>
}): ZapIdentityPanelMode =>
  renderedNodePubkeys.has(pubkey) ? 'scene' : 'off-graph'
