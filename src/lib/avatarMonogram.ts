export interface AvatarMonogramPalette {
  hue: number
  hue2: number
  background: string
  highlight: string
  rim: string
  text: string
}

export const hashAvatarHue = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return ((hash % 360) + 360) % 360
}

export const getAvatarMonogram = (value: string) => {
  const trimmedValue = value.trim().replace(/^@+/, '')

  if (trimmedValue.length === 0) {
    return '??'
  }

  const words = trimmedValue.split(/[\s_.-]+/).filter(Boolean)

  if (words.length >= 2) {
    return `${getFirstMonogramChar(words[0])}${getFirstMonogramChar(
      words[1],
    )}`.toUpperCase()
  }

  const word = words[0] ?? trimmedValue
  const chars = getMonogramChars(word)
  return `${chars[0] ?? '?'}${chars[1] ?? chars[0] ?? '?'}`.toUpperCase()
}

const getFirstMonogramChar = (value: string) => getMonogramChars(value)[0] ?? '?'

const getMonogramChars = (value: string) =>
  Array.from(value).filter((char) => /[\p{L}\p{N}]/u.test(char))

export const getAvatarMonogramPalette = (
  value: string | null | undefined,
): AvatarMonogramPalette => {
  const hue = hashAvatarHue(value?.trim() || 'nostr')
  const hue2 = (hue + 38) % 360

  return {
    hue,
    hue2,
    background: [
      `radial-gradient(circle at 24% 20%, oklch(98% 0.05 ${hue2} / 0.56), transparent 34%)`,
      `radial-gradient(circle at 72% 76%, oklch(48% 0.20 ${hue} / 0.55), transparent 46%)`,
      `linear-gradient(145deg, oklch(86% 0.18 ${hue2}), oklch(68% 0.22 ${hue}) 52%, oklch(48% 0.20 ${hue}))`,
    ].join(', '),
    highlight: `oklch(98% 0.05 ${hue2} / 0.56)`,
    rim: `oklch(96% 0.08 ${hue2} / 0.35)`,
    text: `oklch(15% 0.06 ${hue} / 0.92)`,
  }
}
