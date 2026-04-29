import {redirect} from 'next/navigation';
import {defaultLocale, localizePathname} from '@/i18n/routing';

export default function LegacyBadgesPage() {
  redirect(localizePathname('/badges', defaultLocale));
}
