'use client';

import Link from 'next/link';
import {useLocale, useTranslations} from 'next-intl';
import {usePathname, useSearchParams} from 'next/navigation';
import {localeLabels, localizePathname, type Locale} from '@/i18n/routing';

type LanguageSwitcherProps = {
  variant?: 'landing' | 'navbar';
};

const variantClasses: Record<NonNullable<LanguageSwitcherProps['variant']>, string> = {
  landing:
    'rounded-full border border-[#ffffff18] bg-[#ffffff08] p-1 text-xs text-[#f6f1e8]',
  navbar:
    'rounded-full border border-lc-border/60 bg-lc-dark/80 p-1 text-xs text-lc-white',
};

const itemVariantClasses: Record<NonNullable<LanguageSwitcherProps['variant']>, string> = {
  landing:
    'text-[#ada59b] hover:text-[#f6f1e8]',
  navbar:
    'text-lc-muted hover:text-lc-white',
};

export default function LanguageSwitcher({
  variant = 'navbar',
}: LanguageSwitcherProps) {
  const locale = useLocale() as Locale;
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const t = useTranslations('common.languageSwitcher');
  const search = searchParams.toString();

  return (
    <div
      aria-label={t('label')}
      className={`inline-flex items-center gap-1 ${variantClasses[variant]}`}
      role="navigation"
    >
      {(Object.keys(localeLabels) as Locale[]).map((candidateLocale) => {
        const href = localizePathname(pathname, candidateLocale, search);
        const isActive = locale === candidateLocale;

        return (
          <Link
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-full px-2.5 py-1.5 font-medium transition ${
              isActive
                ? variant === 'landing'
                  ? 'bg-[#ff4b5d] text-[#080808]'
                  : 'bg-lc-green text-[#0a0a0a]'
                : itemVariantClasses[variant]
            }`}
            href={href}
            key={candidateLocale}
            prefetch={false}
          >
            {t(candidateLocale)}
          </Link>
        );
      })}
    </div>
  );
}
