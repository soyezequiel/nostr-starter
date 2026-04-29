import type {Metadata, Viewport} from 'next';
import {NextIntlClientProvider} from 'next-intl';
import {setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {getMessagesForLocale} from '@/i18n/messages';
import {getMetadataBase} from '@/i18n/metadata';
import {isLocale, locales} from '@/i18n/routing';

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  applicationName: 'Nostr Espacial',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export function generateStaticParams() {
  return locales.map((locale) => ({locale}));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}>) {
  const {locale: requestedLocale} = await params;

  if (!isLocale(requestedLocale)) {
    notFound();
  }

  setRequestLocale(requestedLocale);
  const messages = await getMessagesForLocale(requestedLocale);

  return (
    <NextIntlClientProvider locale={requestedLocale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
