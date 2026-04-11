import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import DevCacheButton from '@/components/DevCacheButton';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Nostr Starter Kit - La Crypta Hackathon',
  description: 'Build your first Nostr app. Connect with extension, nsec, or bunker.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-lc-black text-lc-white antialiased`}>
        <DevCacheButton />
        {children}
      </body>
    </html>
  );
}
