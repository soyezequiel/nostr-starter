'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { getInitials } from '@/lib/media';
import AvatarFallback from './AvatarFallback';
import LoginModal from './LoginModal';
import SkeletonImage from './SkeletonImage';

const navItems = [
  {
    href: '/',
    label: 'Graph',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 12h10" />
        <path d="M17.5 6.5L7 11" />
        <path d="M17.5 17.5L7 13" />
      </svg>
    ),
  },
  {
    href: '/labs/sigma',
    label: 'Sigma Lab',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 5h10" />
        <path d="M7 19h10" />
        <path d="M8 5l8 14" />
        <path d="M16 5l-8 14" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: '/badges',
    label: 'Badges',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z" />
      </svg>
    ),
  },
];

export default function Navbar() {
  const [showLogin, setShowLogin] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const pathname = usePathname();
  const { isConnected, profile, logout } = useAuthStore();
  const profileInitial = getInitials(profile?.displayName || profile?.name);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 bg-lc-black/90 backdrop-blur-xl border-b border-lc-border/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:h-16 sm:flex-nowrap sm:justify-between sm:px-6 sm:py-0">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
            <div className="w-8 h-8 bg-lc-green rounded-lg flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="truncate font-bold text-base tracking-tight text-lc-white sm:text-lg">
              nostr<span className="text-lc-green">.</span>starter
            </span>
          </Link>

          <div className="order-3 flex w-full items-center gap-0.5 overflow-x-auto pb-1 sm:order-none sm:w-auto sm:gap-1 sm:overflow-visible sm:pb-0">
            {navItems.map(({ href, label, icon }) => {
              const isActive =
                href === '/'
                  ? pathname === '/'
                  : pathname === href || pathname?.startsWith(`${href}/`);

              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all min-h-[44px] sm:min-h-0 sm:px-3 sm:py-1.5 ${
                    isActive
                      ? 'bg-lc-border/60 text-lc-green'
                      : 'text-lc-muted hover:text-lc-white hover:bg-lc-border/30'
                  }`}
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3 sm:ml-0 sm:gap-4">
            {isConnected && profile ? (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex min-h-[44px] items-center gap-2 rounded-full border border-lc-border/50 bg-lc-dark py-1.5 pl-1.5 pr-2 transition-all duration-200 hover:bg-lc-border sm:min-h-0 sm:gap-2.5 sm:pr-4"
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-lc-border flex-shrink-0">
                    {profile.picture ? (
                      <SkeletonImage
                        src={profile.picture}
                        alt={profile.displayName || profile.name || 'Profile picture'}
                        sizes="32px"
                        className="object-cover"
                        fallback={
                          <AvatarFallback
                            initials={profileInitial}
                            labelClassName="text-sm font-semibold"
                          />
                        }
                      />
                    ) : (
                      <AvatarFallback
                        initials={profileInitial}
                        labelClassName="text-sm font-semibold"
                      />
                    )}
                  </div>
                  <span className="hidden sm:block text-sm text-lc-white font-medium max-w-[120px] truncate">
                    {profile.displayName || profile.name || 'Anon'}
                  </span>
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 z-50 mt-2 w-[min(14rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-lc-border bg-lc-dark shadow-2xl">
                      <div className="p-4 border-b border-lc-border">
                        <div className="text-sm text-lc-white font-semibold truncate">
                          {profile.displayName || profile.name}
                        </div>
                        <div className="text-xs text-lc-muted truncate mt-0.5 font-mono">
                          {profile.npub.slice(0, 20)}...
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          logout();
                          setShowMenu(false);
                        }}
                        className="w-full p-3 text-left text-sm text-red-400 hover:bg-lc-border/50 transition flex items-center gap-2"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        Disconnect
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="lc-pill lc-pill-primary flex min-h-[44px] items-center gap-2 text-sm !px-3 sm:min-h-0 sm:!px-6"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                <span className="hidden sm:inline">Connect</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
