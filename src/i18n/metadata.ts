import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {defaultLocale, isLocale, locales, localizePathname, type Locale} from '@/i18n/routing';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nostr-en-el-espacio.vercel.app';

type PageKey = 'landing' | 'profile' | 'badges' | 'sigma';

const pagePathnames: Record<PageKey, string> = {
  landing: '/',
  profile: '/profile',
  badges: '/badges',
  sigma: '/labs/sigma',
};

export function getMetadataBase() {
  return new URL(siteUrl);
}

function resolveLocale(locale: string): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

export async function buildPageMetadata(
  inputLocale: string,
  page: PageKey,
): Promise<Metadata> {
  const locale = resolveLocale(inputLocale);
  const t = await getTranslations({locale, namespace: 'common.metadata'});
  const pathname = pagePathnames[page];

  return {
    title: t(`${page}.title`),
    description: t(`${page}.description`),
    alternates: {
      canonical: localizePathname(pathname, locale),
      languages: Object.fromEntries(
        locales.map((value) => [value, localizePathname(pathname, value)]),
      ),
    },
  };
}
