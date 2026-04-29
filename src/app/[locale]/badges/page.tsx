import type {Metadata} from 'next';
import Badges from '@/components/Badges';
import Navbar from '@/components/Navbar';
import {buildPageMetadata} from '@/i18n/metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  return buildPageMetadata(locale, 'badges');
}

export default function BadgesPage() {
  return (
    <main className="min-h-[100dvh] bg-lc-black lc-grid-bg">
      <Navbar />
      <Badges />
    </main>
  );
}
