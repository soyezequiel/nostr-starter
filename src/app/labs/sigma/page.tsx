import {redirect} from 'next/navigation';
import {defaultLocale, localizePathname} from '@/i18n/routing';

export default function LegacySigmaPage() {
  redirect(localizePathname('/labs/sigma', defaultLocale));
}
