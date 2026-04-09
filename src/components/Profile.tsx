'use client';

import { useEffect, useState } from 'react';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { useAuthStore } from '@/store/auth';
import {
  connectNDK,
  fetchFollowers,
  fetchFollowing,
  fetchUserNotes,
  formatTimestamp,
} from '@/lib/nostr';
import { getInitials } from '@/lib/media';
import AvatarFallback from '@/components/AvatarFallback';
import SkeletonImage from '@/components/SkeletonImage';

function ProfileSkeleton() {
  return (
    <div className="min-h-screen pt-16">
      {/* Banner skeleton */}
      <div className="h-52 lc-skeleton" style={{ borderRadius: 0 }} />

      <div className="max-w-2xl mx-auto px-6">
        {/* Avatar skeleton */}
        <div className="relative -mt-16 mb-6">
          <div className="w-32 h-32 lc-skeleton-rounded border-4 border-lc-black" />
        </div>

        {/* Name skeleton */}
        <div className="mb-4 space-y-2">
          <div className="lc-skeleton h-8 w-48" />
          <div className="lc-skeleton h-4 w-32" />
        </div>

        {/* Bio skeleton */}
        <div className="space-y-2 mb-5">
          <div className="lc-skeleton h-4 w-full" />
          <div className="lc-skeleton h-4 w-3/4" />
        </div>

        {/* Stats skeleton */}
        <div className="flex gap-1 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-1 py-3 px-4 bg-lc-dark rounded-xl text-center border border-lc-border/50">
              <div className="lc-skeleton h-6 w-10 mx-auto mb-1" />
              <div className="lc-skeleton h-3 w-16 mx-auto" />
            </div>
          ))}
        </div>

        {/* Pubkey skeleton */}
        <div className="p-4 bg-lc-dark rounded-xl mb-6 border border-lc-border/50">
          <div className="lc-skeleton h-3 w-16 mb-2" />
          <div className="lc-skeleton h-4 w-full" />
        </div>

        {/* Tabs skeleton */}
        <div className="border-b border-lc-border mb-6">
          <div className="flex gap-4 pb-3">
            <div className="lc-skeleton h-4 w-12" />
            <div className="lc-skeleton h-4 w-14" />
            <div className="lc-skeleton h-4 w-10" />
          </div>
        </div>

        {/* Notes skeleton */}
        <div className="space-y-3 pb-12">
          {[1, 2, 3].map((i) => (
            <div key={i} className="lc-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 lc-skeleton-rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="lc-skeleton h-4 w-28" />
                  <div className="lc-skeleton h-3 w-16" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="lc-skeleton h-4 w-full" />
                <div className="lc-skeleton h-4 w-5/6" />
                <div className="lc-skeleton h-4 w-2/3" />
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
  const [followers, setFollowers] = useState<string[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'replies' | 'likes'>('posts');

  useEffect(() => {
    if (!isConnected || !profile) return;

    let cancelled = false;

    const loadProfileData = async () => {
      setLoading(true);
      try {
        await connectNDK();

        const [followersData, followingData, notesData] = await Promise.all([
          fetchFollowers(profile.pubkey),
          fetchFollowing(profile.pubkey),
          fetchUserNotes(profile.pubkey, 20),
        ]);

        if (cancelled) return;

        setFollowers(followersData);
        setFollowing(followingData);
        setNotes(notesData);
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading profile data:', error);
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
  }, [isConnected, profile]);

  if (!isConnected || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-lg mx-auto px-6">
          <div className="w-20 h-20 mx-auto mb-8 bg-lc-green/10 rounded-2xl flex items-center justify-center lc-glow">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="text-4xl font-extrabold text-lc-white mb-3 tracking-tight">
            Nostr Starter Kit
          </h1>
          <p className="text-lg text-lc-muted mb-8">
            Connect your identity to explore the decentralized social network
          </p>
          <div className="flex items-center justify-center gap-3 text-sm text-lc-muted/70">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-lc-green/60" />
              Extension
            </span>
            <span className="text-lc-border">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-lc-green/60" />
              nsec
            </span>
            <span className="text-lc-border">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-lc-green/60" />
              Bunker
            </span>
          </div>
          <div className="mt-12 text-xs text-lc-muted/40 font-mono">
            Powered by La Crypta
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <ProfileSkeleton />;
  }

  const profileInitial = getInitials(profile.displayName || profile.name);

  return (
    <div className="min-h-screen pt-16">
      {/* Banner */}
      <div className="h-52 lc-banner-gradient relative overflow-hidden">
        {profile.banner ? (
          <SkeletonImage
            src={profile.banner}
            alt="Profile banner"
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

      {/* Profile Header */}
      <div className="max-w-2xl mx-auto px-6">
        <div className="relative -mt-16 mb-6">
          {/* Avatar */}
          <div className="w-32 h-32 rounded-2xl border-4 border-lc-black bg-lc-dark overflow-hidden shadow-2xl">
            {profile.picture ? (
              <SkeletonImage
                src={profile.picture}
                alt={profile.displayName || profile.name || 'Profile picture'}
                sizes="128px"
                className="object-cover"
                fallback={
                  <AvatarFallback
                    initials={profileInitial}
                    labelClassName="text-4xl font-bold tracking-[0.08em]"
                  />
                }
              />
            ) : (
              <AvatarFallback
                initials={profileInitial}
                labelClassName="text-4xl font-bold tracking-[0.08em]"
              />
            )}
          </div>
        </div>

        {/* Name & Bio */}
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold text-lc-white tracking-tight">
            {profile.displayName || profile.name || 'Anonymous'}
          </h1>
          {profile.name && profile.displayName && profile.name !== profile.displayName && (
            <div className="text-lc-muted mt-0.5">@{profile.name}</div>
          )}
          {profile.nip05 && (
            <div className="text-lc-green text-sm flex items-center gap-1.5 mt-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>{profile.nip05}</span>
            </div>
          )}
        </div>

        {/* Bio */}
        {profile.about && (
          <p className="text-lc-white/80 mb-5 whitespace-pre-wrap leading-relaxed">{profile.about}</p>
        )}

        {/* Links */}
        <div className="flex flex-wrap gap-4 text-sm text-lc-muted mb-5">
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-lc-green transition"
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

        {/* Stats */}
        <div className="flex gap-1 mb-6">
          {[
            { label: 'Following', value: following.length },
            { label: 'Followers', value: followers.length },
            { label: 'Notes', value: notes.length },
          ].map((stat) => (
            <div key={stat.label} className="flex-1 py-3 px-4 bg-lc-dark rounded-xl text-center border border-lc-border/50">
              <div className="text-xl font-bold text-lc-white">{stat.value}</div>
              <div className="text-xs text-lc-muted mt-0.5 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Pubkey */}
        <div className="p-4 bg-lc-dark rounded-xl mb-6 border border-lc-border/50">
          <div className="text-xs text-lc-muted mb-1.5 uppercase tracking-wider font-medium">Public Key</div>
          <div className="text-sm text-lc-white/70 font-mono break-all leading-relaxed">
            {profile.npub}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-lc-border mb-6">
          <div className="flex gap-0">
            {(['posts', 'replies', 'likes'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 px-5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'text-lc-green border-lc-green'
                    : 'text-lc-muted border-transparent hover:text-lc-white hover:border-lc-border'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Notes Feed */}
        <div className="space-y-3 pb-12">
          {notes.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-3 bg-lc-dark rounded-xl flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <p className="text-lc-muted text-sm">No notes yet</p>
            </div>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className="lc-card p-5"
              >
                <div className="flex items-center gap-3 mb-3">
                  {profile.picture ? (
                    <div className="w-10 h-10 rounded-xl overflow-hidden">
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
                    <div className="w-10 h-10 rounded-xl overflow-hidden">
                      <AvatarFallback
                        initials={profileInitial}
                        labelClassName="text-sm font-semibold"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lc-white text-sm truncate">
                      {profile.displayName || profile.name || 'Anonymous'}
                    </div>
                    <div className="text-xs text-lc-muted">
                      {formatTimestamp(note.created_at || 0)}
                    </div>
                  </div>
                </div>
                <p className="text-lc-white/85 whitespace-pre-wrap break-words leading-relaxed">
                  {note.content}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
