import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canServeClearSiteData,
  CLEAR_SITE_DATA_HEADER_VALUE,
  isLocalDevHost,
  POST,
} from '@/app/api/dev/clear-site-data/route'

test('clear-site-data route recognizes localhost development hosts', () => {
  assert.equal(isLocalDevHost('localhost'), true)
  assert.equal(isLocalDevHost('127.0.0.1'), true)
  assert.equal(isLocalDevHost('0.0.0.0'), true)
  assert.equal(isLocalDevHost('::1'), true)
  assert.equal(isLocalDevHost('app.example'), false)
})

test('clear-site-data route is limited to development or local hosts', () => {
  assert.equal(canServeClearSiteData('app.example', 'development'), true)
  assert.equal(canServeClearSiteData('localhost', 'production'), true)
  assert.equal(canServeClearSiteData('127.0.0.1', 'production'), true)
  assert.equal(canServeClearSiteData('app.example', 'production'), false)
})

test('clear-site-data route emits the browser purge header for localhost', async () => {
  const response = await POST(
    new Request('http://localhost:3000/api/dev/clear-site-data', {
      method: 'POST',
    }),
  )

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('Clear-Site-Data'),
    CLEAR_SITE_DATA_HEADER_VALUE,
  )
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0')
})

test('clear-site-data route rejects non-local production hosts', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  try {
    const response = await POST(
      new Request('https://app.example/api/dev/clear-site-data', {
        method: 'POST',
      }),
    )

    assert.equal(response.status, 404)
    assert.equal(response.headers.get('Clear-Site-Data'), null)
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
  }
})
