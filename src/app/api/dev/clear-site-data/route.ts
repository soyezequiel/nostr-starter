import { NextResponse } from 'next/server'

export const CLEAR_SITE_DATA_HEADER_VALUE = '"cache", "cookies", "storage"'

export function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  )
}

export function canServeClearSiteData(
  hostname: string,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  return nodeEnv === 'development' || isLocalDevHost(hostname)
}

export async function POST(request: Request): Promise<Response> {
  const { hostname } = new URL(request.url)

  if (!canServeClearSiteData(hostname)) {
    return NextResponse.json(
      { ok: false, error: 'not_available' },
      {
        status: 404,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    )
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Clear-Site-Data': CLEAR_SITE_DATA_HEADER_VALUE,
      },
    },
  )
}
