'use client';

import { useEffect, useState } from 'react';
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

function BadgesSkeleton({ status }: { status: string }) {
  return (
    <div className="min-h-screen pt-20 sm:pt-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <div className="mb-8 space-y-2">
          <div className="lc-skeleton h-8 w-32" />
          <div className="lc-skeleton h-4 w-64" />
        </div>
        <div
          aria-live="polite"
          className="mb-5 rounded-lg border border-lc-green/20 bg-lc-green/10 px-4 py-3 text-sm text-lc-white"
          role="status"
        >
          <div className="font-semibold text-lc-green">Cargando badges NIP-58</div>
          <div className="mt-1 text-lc-muted">{status}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-12">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="lc-card p-4 flex flex-col items-center">
              <div className="w-20 h-20 lc-skeleton-rounded mb-3" />
              <div className="lc-skeleton h-4 w-20 mb-1" />
              <div className="lc-skeleton h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Badges() {
  const { isConnected, profile } = useAuthStore();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Preparando consulta de badges...');

  useEffect(() => {
    if (!isConnected || !profile) return;

    let cancelled = false;

    const loadBadges = async () => {
      setLoading(true);
      setLoadingStatus('Conectando NDK para leer awards kind:8...');

      try {
        await connectNDK();
        const ndk = getNDK();

        if (cancelled) return;

        setLoadingStatus('Buscando awards kind:8 recibidos por tu pubkey...');
        const awardEvents = await Promise.race([
          ndk.fetchEvents({ kinds: [8], '#p': [profile.pubkey], limit: 50 }),
          new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 10000)),
        ]);

        if (cancelled) return;

        const badgeDefIds = new Set<string>();
        awardEvents.forEach((event: NDKEvent) => {
          const aTag = event.tags.find(t => t[0] === 'a' && t[1]?.startsWith('30009:'));
          if (aTag) badgeDefIds.add(aTag[1]);
        });
        setLoadingStatus(`Awards encontrados: ${awardEvents.size}. Resolviendo ${badgeDefIds.size} definiciones kind:30009...`);

        const results = await Promise.allSettled(
          Array.from(badgeDefIds).map(async (defId, index) => {
            const [, pubkey, dTag] = defId.split(':');
            if (!pubkey || !dTag) return null;

            if (!cancelled) {
              setLoadingStatus(`Resolviendo definicion ${index + 1}/${badgeDefIds.size}: ${dTag}`);
            }
            const defEvents = await Promise.race([
              ndk.fetchEvents({ kinds: [30009], authors: [pubkey], '#d': [dTag], limit: 1 }),
              new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 5000)),
            ]);

            const defEvent = Array.from(defEvents)[0];
            if (!defEvent) return null;

            const name = defEvent.tags.find(t => t[0] === 'name')?.[1] || dTag;
            const description = defEvent.tags.find(t => t[0] === 'description')?.[1] || '';
            const image = defEvent.tags.find(t => t[0] === 'image')?.[1];
            const thumb = defEvent.tags.find(t => t[0] === 'thumb')?.[1];

            return { id: defId, name, description, image, thumb, creator: pubkey } as Badge;
          }),
        );

        const parsedBadges = results
          .filter((r): r is PromiseFulfilledResult<Badge | null> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((b): b is Badge => b !== null);

        if (!cancelled) {
          setLoadingStatus(`Normalizando media y preparando ${parsedBadges.length} badges visibles...`);
          setBadges(parsedBadges);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading badges:', error);
          setLoadingStatus('La carga de badges termino con error o cobertura parcial.');
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
  }, [isConnected, profile]);

  if (!isConnected || !profile) return null;

  if (loading) {
    return <BadgesSkeleton status={loadingStatus} />;
  }

  return (
    <div className="min-h-screen pt-20 sm:pt-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-lc-white tracking-tight">Badges</h1>
          <p className="text-lc-muted mt-1">Nostr badges awarded to your profile (NIP-58)</p>
        </div>

        {badges.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-lc-dark rounded-2xl flex items-center justify-center border border-lc-border/50">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.5">
                <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
              </svg>
            </div>
            <p className="text-lc-muted text-sm mb-1">No badges yet</p>
            <p className="text-lc-muted/60 text-xs">Badges you receive from the Nostr network will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-12">
            {badges.map((badge) => {
              const badgeImage = normalizeMediaUrl(badge.thumb ?? badge.image);

              return (
                <div key={badge.id} className="lc-card p-4 flex flex-col items-center text-center">
                  {badgeImage ? (
                  <div className="w-20 h-20 rounded-xl overflow-hidden mb-3">
                    <SkeletonImage
                      src={badgeImage}
                      alt={badge.name}
                      sizes="80px"
                      className="object-cover"
                      fallback={
                        <div className="w-full h-full rounded-xl bg-lc-olive/40 flex items-center justify-center">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5">
                            <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
                          </svg>
                        </div>
                      }
                    />
                  </div>
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-lc-olive/40 flex items-center justify-center mb-3">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5">
                        <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
                      </svg>
                    </div>
                  )}
                  <div className="font-semibold text-lc-white text-sm">{badge.name}</div>
                  {badge.description && (
                    <div className="text-xs text-lc-muted mt-1 line-clamp-2">{badge.description}</div>
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
