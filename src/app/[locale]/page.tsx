import type {Metadata} from 'next';
import LandingPage from '@/components/landing/LandingPage';
import {buildPageMetadata} from '@/i18n/metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  return buildPageMetadata(locale, 'landing');
}

export default function HomePage() {
  return <LandingPage />;
}
