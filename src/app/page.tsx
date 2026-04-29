import {redirect} from 'next/navigation';
import {defaultLocale, localizePathname} from '@/i18n/routing';

export default function LegacyRootPage() {
  redirect(localizePathname('/', defaultLocale));
}
