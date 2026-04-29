import createMiddleware from 'next-intl/middleware';
import {NextResponse, type NextRequest} from 'next/server';
import {routing} from '@/i18n/routing';

const handleI18nRouting = createMiddleware(routing);
const PUBLIC_FILE_REGEX = /\.[^/]+$/;

export function shouldBypassI18n(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/_next' ||
    pathname.startsWith('/_next/') ||
    pathname === '/workers' ||
    pathname.startsWith('/workers/') ||
    PUBLIC_FILE_REGEX.test(pathname)
  );
}

export default function proxy(request: NextRequest) {
  if (shouldBypassI18n(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: '/:path*',
};
