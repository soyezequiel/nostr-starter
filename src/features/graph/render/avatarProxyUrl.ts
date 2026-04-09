export type AvatarProxyMode = 'direct' | 'wsrv'
export const DEFAULT_AVATAR_PROXY_MODE: AvatarProxyMode = 'wsrv'

export const resolveAvatarFetchUrl = (
  sourceUrl: string,
  proxyMode: AvatarProxyMode = DEFAULT_AVATAR_PROXY_MODE,
  size: number = 160,
): string => {
  if (proxyMode === 'direct') {
    return sourceUrl
  }

  // Use wsrv.nl to bypass CORS, normalize size, and clip to a native circle
  return `https://wsrv.nl/?url=${encodeURIComponent(sourceUrl)}&w=${size}&h=${size}&fit=cover&mask=circle&output=webp`
}
