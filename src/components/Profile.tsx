'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { useAuthStore } from '@/store/auth';
import {
  connectNDK,
  fetchFollowerCount,
  fetchFollowing,
  fetchUserNotes,
} from '@/lib/nostr';
import { formatRelativeTimestamp } from '@/i18n/format';
import { getInitials } from '@/lib/media';
import AvatarFallback from '@/components/AvatarFallback';
import SkeletonImage from '@/components/SkeletonImage';

function ProfileSkeleton({
  status,
  title,
}: {
  status: string;
  title: string;
}) {
  return (
    <div className="min-h-[100dvh] px-4 pb-12 pt-28 sm:px-6 sm:pt-20">
      <div className="h-32 lc-skeleton sm:h-44 lg:h-52" style={{ borderRadius: 0 }} />

      <div className="mx-auto max-w-3xl">
        <div className="relative -mt-12 mb-6 sm:-mt-16">
          <div className="h-24 w-24 border-4 border-lc-black lc-skeleton-rounded sm:h-32 sm:w-32" />
        </div>

        <div
          aria-live="polite"
          className="mb-5 rounded-lg border border-lc-green/20 bg-lc-green/10 px-4 py-3 text-sm text-lc-white"
          role="status"
        >
          <div className="font-semibold text-lc-green">{title}</div>
          <div className="mt-1 text-lc-muted">{status}</div>
        </div>

        <div className="mb-4 space-y-2">
          <div className="lc-skeleton h-8 w-48" />
          <div className="lc-skeleton h-4 w-32" />
        </div>

        <div className="mb-5 space-y-2">
          <div className="lc-skeleton h-4 w-full" />
          <div className="lc-skeleton h-4 w-3/4" />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-lc-border/50 bg-lc-dark px-4 py-3 text-center">
              <div className="mx-auto mb-1 h-6 w-10 lc-skeleton" />
              <div className="mx-auto h-3 w-16 lc-skeleton" />
            </div>
          ))}
        </div>

        <div className="mb-6 rounded-xl border border-lc-border/50 bg-lc-dark p-4">
          <div className="mb-2 h-3 w-16 lc-skeleton" />
          <div className="h-4 w-full lc-skeleton" />
        </div>

        <div className="mb-6 border-b border-lc-border">
          <div className="flex gap-4 overflow-x-auto pb-3">
            <div className="h-4 w-12 lc-skeleton" />
            <div className="h-4 w-14 lc-skeleton" />
            <div className="h-4 w-10 lc-skeleton" />
          </div>
        </div>

        <div className="space-y-3 pb-12">
          {[1, 2, 3].map((i) => (
            <div key={i} className="lc-card p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-10 w-10 lc-skeleton-rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-28 lc-skeleton" />
                  <div className="h-3 w-16 lc-skeleton" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full lc-skeleton" />
                <div className="h-4 w-5/6 lc-skeleton" />
                <div className="h-4 w-2/3 lc-skeleton" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  const { isConnected, profile } = useAuthStore();
  const locale = useLocale();
  const t = useTranslations('profile');
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState<string[]>([]);
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(t('loading.prepare'));
  const [activeTab, setActiveTab] = useState<'posts' | 'replies'>('posts');

  useEffect(() => {
    setLoadingStatus(t('loading.prepare'));
  }, [t]);

  useEffect(() => {
    if (!isConnected || !profile) return;

    let cancelled = false;

    const loadProfileData = async () => {
      setLoading(true);
      setLoadingStatus(t('loading.connectNdk'));
      try {
        await connectNDK();

        if (cancelled) return;

        setLoadingStatus(t('loading.parallelFetch'));
        const followersRequest = fetchFollowerCount(profile.pubkey).then((result) => {
          if (!cancelled) {
            setLoadingStatus(t('loading.followersEstimated', { count: result }));
          }
          return result;
        });
        const followingRequest = fetchFollowing(profile.pubkey).then((result) => {
          if (!cancelled) {
            setLoadingStatus(t('loading.followingLoaded', { count: result.length }));
          }
          return result;
        });
        const notesRequest = fetchUserNotes(profile.pubkey, 20).then((result) => {
          if (!cancelled) {
            setLoadingStatus(t('loading.notesLoaded', { count: result.length }));
          }
          return result;
        });

        const [followersData, followingData, notesData] = await Promise.all([
          followersRequest,
          followingRequest,
          notesRequest,
        ]);

        if (cancelled) return;

        setLoadingStatus(t('loading.applyData'));
        setFollowerCount(followersData);
        setFollowing(followingData);
        setNotes(notesData);
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading profile data:', error);
          setLoadingStatus(t('loading.partialError'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadProfileData();

    return () => {
      cancelled = true;
    };
  }, [isConnected, profile, t]);

  if (!isConnected || !profile) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-4 pb-10 pt-28 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-lg text-center">
          <div className="lc-glow mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-lc-green/10">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-lc-white sm:text-4xl">
            Nostr Espacial
          </h1>
          <p className="mb-8 text-base text-lc-muted sm:text-lg">
            {t('empty.description')}
          </p>
          <div className="flex items-center justify-center gap-3 text-sm text-lc-muted/70">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lc-green/60" />
              {t('empty.extension')}
            </span>
            <span className="text-lc-border">|</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lc-green/60" />
              nsec
            </span>
            <span className="text-lc-border">|</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lc-green/60" />
              Bunker
            </span>
          </div>
          <div className="mt-12 font-mono text-xs text-lc-muted/40">
            La Crypta IDENTITY
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <ProfileSkeleton status={loadingStatus} title={t('loading.connectedProfile')} />;
  }

  const profileInitial = getInitials(profile.displayName || profile.name);

  return (
    <div className="min-h-[100dvh] pb-12 pt-28 sm:pt-20 lg:pt-24">
      <div className="relative h-32 overflow-hidden lc-banner-gradient sm:h-44 lg:h-52">
        {profile.banner ? (
          <SkeletonImage
            src={profile.banner}
            alt={t('labels.bannerAlt')}
            sizes="100vw"
            className="object-cover"
            containerClassName="absolute inset-0"
            fallback={<div className="absolute inset-0 lc-grid-bg opacity-40" />}
          />
        ) : (
          <div className="absolute inset-0 lc-grid-bg opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-lc-black via-transparent to-transparent" />
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="relative -mt-12 mb-6 sm:-mt-16">
          <div className="h-24 w-24 overflow-hidden rounded-2xl border-4 border-lc-black bg-lc-dark shadow-2xl sm:h-32 sm:w-32">
            {profile.picture ? (
              <SkeletonImage
                src={profile.picture}
                alt={profile.displayName || profile.name || t('labels.profilePictureAlt')}
                sizes="128px"
                className="object-cover"
                fallback={
                  <AvatarFallback
                    initials={profileInitial}
                    labelClassName="text-4xl font-bold tracking-[0.08em]"
                    seed={profile.npub}
                  />
                }
              />
            ) : (
              <AvatarFallback
                initials={profileInitial}
                labelClassName="text-4xl font-bold tracking-[0.08em]"
                seed={profile.npub}
              />
            )}
          </div>
        </div>

        <div className="mb-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-lc-white sm:text-3xl">
            {profile.displayName || profile.name || t('labels.anonymous')}
          </h1>
          {profile.name && profile.displayName && profile.name !== profile.displayName && (
            <div className="mt-0.5 text-lc-muted">@{profile.name}</div>
          )}
          {profile.nip05 && (
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-lc-green">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>{profile.nip05}</span>
            </div>
          )}
        </div>

        {profile.about && (
          <p className="mb-5 whitespace-pre-wrap leading-relaxed text-lc-white/80">{profile.about}</p>
        )}

        <div className="mb-5 flex flex-wrap gap-4 text-sm text-lc-muted">
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition hover:text-lc-green"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
              <span>{profile.website.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
          {profile.lud16 && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <span>{profile.lud16}</span>
            </div>
          )}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          {[
            { label: t('labels.following'), value: following.length },
            { label: t('labels.followers'), value: followerCount },
            { label: t('labels.notes'), value: notes.length },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-lc-border/50 bg-lc-dark px-4 py-3 text-center">
              <div className="text-xl font-bold text-lc-white">{stat.value}</div>
              <div className="mt-0.5 text-xs uppercase tracking-wider text-lc-muted">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="mb-6 rounded-xl border border-lc-border/50 bg-lc-dark p-4">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-lc-muted">{t('labels.publicKey')}</div>
          <div className="break-all font-mono text-xs leading-relaxed text-lc-white/70 sm:text-sm">
            {profile.npub}
          </div>
        </div>

        <div className="mb-6 border-b border-lc-border">
          <div className="flex gap-0 overflow-x-auto">
            {(['posts', 'replies'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`-mb-px shrink-0 border-b-2 px-5 pb-3 text-sm font-medium transition-all ${
                  activeTab === tab
                    ? 'border-lc-green text-lc-green'
                    : 'border-transparent text-lc-muted hover:border-lc-border hover:text-lc-white'
                }`}
              >
                {tab === 'posts' ? t('labels.posts') : t('labels.replies')}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 pb-12">
          {(() => {
            const filteredNotes = activeTab === 'replies'
              ? notes.filter((note) => note.tags.some((tag) => tag[0] === 'e'))
              : notes.filter((note) => !note.tags.some((tag) => tag[0] === 'e'));

            if (filteredNotes.length === 0) {
              return (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-lc-dark">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.5">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                  </div>
                  <p className="text-sm text-lc-muted">
                    {activeTab === 'replies' ? t('labels.noReplies') : t('labels.noPosts')}
                  </p>
                </div>
              );
            }

            return filteredNotes.map((note) => (
              <div
                key={note.id}
                className="lc-card p-4 sm:p-5"
              >
                <div className="mb-3 flex items-center gap-3">
                  {profile.picture ? (
                    <div className="h-10 w-10 overflow-hidden rounded-xl">
                      <SkeletonImage
                        src={profile.picture}
                        alt=""
                        sizes="40px"
                        className="object-cover"
                        fallback={
                          <AvatarFallback
                            initials={profileInitial}
                            labelClassName="text-sm font-semibold"
                          />
                        }
                      />
                    </div>
                  ) : (
                    <div className="h-10 w-10 overflow-hidden rounded-xl">
                      <AvatarFallback
                        initials={profileInitial}
                        labelClassName="text-sm font-semibold"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-lc-white">
                      {profile.displayName || profile.name || t('labels.anonymous')}
                    </div>
                    <div className="text-xs text-lc-muted">
                      {formatRelativeTimestamp(note.created_at || 0, locale)}
                    </div>
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words leading-relaxed text-lc-white/85">
                  {note.content}
                </p>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
