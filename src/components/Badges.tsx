'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { useAuthStore } from '@/store/auth';
import { getNDK, connectNDK } from '@/lib/nostr';
import { normalizeMediaUrl } from '@/lib/media';
import SkeletonImage from '@/components/SkeletonImage';

interface Badge {
  id: string;
  name: string;
  description: string;
  image?: string;
  thumb?: string;
  creator: string;
}

function BadgesSkeleton({ status, title }: { status: string; title: string }) {
  return (
    <div className="min-h-[100dvh] px-4 pb-12 pt-28 sm:px-6 sm:pt-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 space-y-2">
          <div className="h-8 w-32 lc-skeleton" />
          <div className="h-4 w-64 lc-skeleton" />
        </div>
        <div
          aria-live="polite"
          className="mb-5 rounded-lg border border-lc-green/20 bg-lc-green/10 px-4 py-3 text-sm text-lc-white"
          role="status"
        >
          <div className="font-semibold text-lc-green">{title}</div>
          <div className="mt-1 text-lc-muted">{status}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 pb-12 sm:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="lc-card flex flex-col items-center p-4">
              <div className="mb-3 h-20 w-20 lc-skeleton-rounded" />
              <div className="mb-1 h-4 w-20 lc-skeleton" />
              <div className="h-3 w-28 lc-skeleton" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Badges() {
  const { isConnected, profile } = useAuthStore();
  const t = useTranslations('badges');
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(t('loading.prepare'));

  useEffect(() => {
    setLoadingStatus(t('loading.prepare'));
  }, [t]);

  useEffect(() => {
    if (!isConnected || !profile) return;

    let cancelled = false;

    const loadBadges = async () => {
      setLoading(true);
      setLoadingStatus(t('loading.connectNdk'));

      try {
        await connectNDK();
        const ndk = getNDK();

        if (cancelled) return;

        setLoadingStatus(t('loading.searchAwards'));
        const awardEvents = await Promise.race([
          ndk.fetchEvents({ kinds: [8], '#p': [profile.pubkey], limit: 50 }),
          new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 10000)),
        ]);

        if (cancelled) return;

        const badgeDefIds = new Set<string>();
        awardEvents.forEach((event: NDKEvent) => {
          const aTag = event.tags.find((tag) => tag[0] === 'a' && tag[1]?.startsWith('30009:'));
          if (aTag) badgeDefIds.add(aTag[1]);
        });
        setLoadingStatus(
          t('loading.awardsFound', {
            awards: awardEvents.size,
            definitions: badgeDefIds.size,
          }),
        );

        const results = await Promise.allSettled(
          Array.from(badgeDefIds).map(async (defId, index) => {
            const [, pubkey, dTag] = defId.split(':');
            if (!pubkey || !dTag) return null;

            if (!cancelled) {
              setLoadingStatus(
                t('loading.resolveDefinition', {
                  index: index + 1,
                  total: badgeDefIds.size,
                  tag: dTag,
                }),
              );
            }

            const defEvents = await Promise.race([
              ndk.fetchEvents({ kinds: [30009], authors: [pubkey], '#d': [dTag], limit: 1 }),
              new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 5000)),
            ]);

            const defEvent = Array.from(defEvents)[0];
            if (!defEvent) return null;

            const name = defEvent.tags.find((tag) => tag[0] === 'name')?.[1] || dTag;
            const description = defEvent.tags.find((tag) => tag[0] === 'description')?.[1] || '';
            const image = defEvent.tags.find((tag) => tag[0] === 'image')?.[1];
            const thumb = defEvent.tags.find((tag) => tag[0] === 'thumb')?.[1];

            return { id: defId, name, description, image, thumb, creator: pubkey } as Badge;
          }),
        );

        const parsedBadges = results
          .filter((result): result is PromiseFulfilledResult<Badge | null> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((badge): badge is Badge => badge !== null);

        if (!cancelled) {
          setLoadingStatus(t('loading.normalize', { count: parsedBadges.length }));
          setBadges(parsedBadges);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading badges:', error);
          setLoadingStatus(t('loading.partialError'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadBadges();

    return () => {
      cancelled = true;
    };
  }, [isConnected, profile, t]);

  if (!isConnected || !profile) return null;

  if (loading) {
    return <BadgesSkeleton status={loadingStatus} title={t('loading.title')} />;
  }

  return (
    <div className="min-h-[100dvh] px-4 pb-12 pt-28 sm:px-6 sm:pt-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-lc-white sm:text-3xl">{t('page.title')}</h1>
          <p className="mt-1 text-lc-muted">{t('page.description')}</p>
        </div>

        {badges.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-lc-border/50 bg-lc-dark">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.5">
                <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
              </svg>
            </div>
            <p className="mb-1 text-sm text-lc-muted">{t('page.emptyTitle')}</p>
            <p className="text-xs text-lc-muted/60">{t('page.emptyDescription')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 pb-12 md:grid-cols-3 xl:grid-cols-4">
            {badges.map((badge) => {
              const badgeImage = normalizeMediaUrl(badge.thumb ?? badge.image);

              return (
                <div key={badge.id} className="lc-card flex flex-col items-center p-4 text-center sm:p-5">
                  {badgeImage ? (
                    <div className="mb-3 h-20 w-20 overflow-hidden rounded-xl">
                      <SkeletonImage
                        src={badgeImage}
                        alt={badge.name}
                        sizes="80px"
                        className="object-cover"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center rounded-xl bg-lc-olive/40">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5">
                              <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
                            </svg>
                          </div>
                        }
                      />
                    </div>
                  ) : (
                    <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-xl bg-lc-olive/40">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5">
                        <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
                      </svg>
                    </div>
                  )}
                  <div className="text-sm font-semibold text-lc-white">{badge.name}</div>
                  {badge.description && (
                    <div className="mt-1 line-clamp-2 text-xs text-lc-muted">{badge.description}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
