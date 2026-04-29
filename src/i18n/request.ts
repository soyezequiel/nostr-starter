import {getRequestConfig} from 'next-intl/server';
import {defaultLocale, isLocale} from '@/i18n/routing';
import {getMessagesForLocale} from '@/i18n/messages';

export default getRequestConfig(async ({requestLocale}) => {
  const requestedLocale = await requestLocale;
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;

  return {
    locale,
    messages: await getMessagesForLocale(locale),
  };
});
