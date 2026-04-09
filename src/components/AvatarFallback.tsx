'use client';

type AvatarFallbackProps = {
  className?: string;
  initials: string;
  labelClassName?: string;
};

export default function AvatarFallback({
  className,
  initials,
  labelClassName,
}: AvatarFallbackProps) {
  return (
    <div className={['lc-avatar-fallback-liquid', className].filter(Boolean).join(' ')}>
      <span className={['lc-avatar-fallback-liquid__label', labelClassName].filter(Boolean).join(' ')}>
        {initials}
      </span>
    </div>
  );
}
