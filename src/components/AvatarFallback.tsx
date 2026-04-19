'use client';

import type { CSSProperties } from 'react';

import { getAvatarMonogramPalette } from '@/lib/avatarMonogram';

type AvatarFallbackProps = {
  className?: string;
  initials: string;
  labelClassName?: string;
  seed?: string | null;
};

export default function AvatarFallback({
  className,
  initials,
  labelClassName,
  seed,
}: AvatarFallbackProps) {
  const palette = getAvatarMonogramPalette(seed || initials);
  const style = {
    '--lc-avatar-monogram-bg': palette.background,
    '--lc-avatar-monogram-rim': palette.rim,
    '--lc-avatar-monogram-text': palette.text,
  } as CSSProperties;

  return (
    <div
      className={['lc-avatar-fallback-liquid', className].filter(Boolean).join(' ')}
      style={style}
    >
      <span className={['lc-avatar-fallback-liquid__label', labelClassName].filter(Boolean).join(' ')}>
        {initials}
      </span>
    </div>
  );
}
