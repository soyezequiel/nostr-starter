import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import DevCacheButton from '@/components/DevCacheButton';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Nostr Espacial',
  description:
    'Explorador visual para entender relaciones, relays y señales públicas de identidad en Nostr.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} bg-lc-black text-lc-white antialiased`}>
        <DevCacheButton />
        {children}
      </body>
    </html>
  );
}
