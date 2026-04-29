import {defineRouting} from 'next-intl/routing';

export const locales = ['es', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'es';
export const localeCookieName = 'NEXT_LOCALE';

export const localeLabels: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: true,
  localeCookie: {
    name: localeCookieName,
    sameSite: 'lax',
    path: '/',
  },
});

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'es' || value === 'en';
}

export function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split('/');
  const firstSegment = segments[1];

  if (!isLocale(firstSegment)) {
    return pathname || '/';
  }

  const stripped = pathname.slice(firstSegment.length + 1);
  return stripped.length > 0 ? stripped : '/';
}

export function localizePathname(
  pathname: string,
  locale: Locale,
  search = '',
): string {
  if (/^https?:\/\//.test(pathname)) {
    return pathname;
  }

  const barePathname = stripLocalePrefix(pathname.startsWith('/') ? pathname : `/${pathname}`);
  const normalizedPathname = barePathname === '/' ? '' : barePathname;
  const normalizedSearch = search
    ? search.startsWith('?')
      ? search
      : `?${search}`
    : '';

  return `/${locale}${normalizedPathname}${normalizedSearch}`;
}
