import assert from 'node:assert/strict';
import test from 'node:test';
import {NextRequest} from 'next/server';
import proxy, {shouldBypassI18n} from '../../proxy';

function createRequest(pathname: string, headers?: HeadersInit) {
  return new NextRequest(`https://nostr-en-el-espacio.vercel.app${pathname}`, {
    headers,
  });
}

test('proxy prioritizes NEXT_LOCALE over Accept-Language for root redirects', () => {
  const response = proxy(
    createRequest('/', {
      'accept-language': 'es-AR,es;q=0.9',
      cookie: 'NEXT_LOCALE=en',
    }),
  );

  assert.equal(response.headers.get('location'), 'https://nostr-en-el-espacio.vercel.app/en');
});

test('proxy falls back to Accept-Language when the locale cookie is absent', () => {
  const response = proxy(
    createRequest('/', {
      'accept-language': 'en-US,en;q=0.9',
    }),
  );

  assert.equal(response.headers.get('location'), 'https://nostr-en-el-espacio.vercel.app/en');
});

test('proxy falls back to es when neither cookie nor Accept-Language matches', () => {
  const response = proxy(
    createRequest('/', {
      'accept-language': 'pt-BR,pt;q=0.9',
    }),
  );

  assert.equal(response.headers.get('location'), 'https://nostr-en-el-espacio.vercel.app/es');
});

test('proxy does not override explicit locale prefixes', () => {
  const response = proxy(
    createRequest('/en/profile', {
      cookie: 'NEXT_LOCALE=es',
    }),
  );

  assert.equal(response.headers.get('location'), null);
});

test('proxy bypass helper ignores API, Next internals, workers, and static files', () => {
  assert.equal(shouldBypassI18n('/api/social-avatar'), true);
  assert.equal(shouldBypassI18n('/_next/static/chunk.js'), true);
  assert.equal(shouldBypassI18n('/workers/graph.worker.js'), true);
  assert.equal(shouldBypassI18n('/graph-explorer-preview.png'), true);
  assert.equal(shouldBypassI18n('/profile'), false);
});
