import assert from 'node:assert/strict';
import test from 'node:test';
import {getMessageNamespaces} from '@/i18n/messages';
import {locales, type Locale} from '@/i18n/routing';

function collectMessageKeys(
  input: unknown,
  prefix = '',
  keys: string[] = [],
): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    keys.push(prefix);
    return keys;
  }

  Object.entries(input).forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectMessageKeys(value, nextPrefix, keys);
  });

  return keys;
}

test('all locales expose the same message keys as es', () => {
  const canonicalKeys = collectMessageKeys(getMessageNamespaces('es')).sort();

  locales
    .filter((locale): locale is Exclude<Locale, 'es'> => locale !== 'es')
    .forEach((locale) => {
      const localeKeys = collectMessageKeys(getMessageNamespaces(locale)).sort();
      assert.deepEqual(localeKeys, canonicalKeys, `Locale ${locale} is missing or adding message keys.`);
    });
});
