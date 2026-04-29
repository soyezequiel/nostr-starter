import type {Metadata} from 'next';
import Navbar from '@/components/Navbar';
import Profile from '@/components/Profile';
import {buildPageMetadata} from '@/i18n/metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  return buildPageMetadata(locale, 'profile');
}

export default function ProfilePage() {
  return (
    <main className="min-h-[100dvh] bg-lc-black lc-grid-bg">
      <Navbar />
      <Profile />
    </main>
  );
}
