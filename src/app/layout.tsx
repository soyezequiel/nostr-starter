import {Inter} from 'next/font/google';
import {getLocale} from 'next-intl/server';
import DevCacheButton from '@/components/DevCacheButton';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.className} bg-lc-black text-lc-white antialiased`}>
        <DevCacheButton />
        {children}
      </body>
    </html>
  );
}
