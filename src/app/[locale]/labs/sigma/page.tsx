import type {Metadata} from 'next';
import GraphClientV2 from '@/features/graph-v2/GraphClientV2';
import {buildPageMetadata} from '@/i18n/metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  return buildPageMetadata(locale, 'sigma');
}

export default function SigmaLabPage() {
  return <GraphClientV2 />;
}
