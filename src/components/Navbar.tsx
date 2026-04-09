'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useNavStore } from '@/store/nav';
import LoginModal from './LoginModal';
import SkeletonImage from './SkeletonImage';

export default function Navbar() {
  const [showLogin, setShowLogin] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const { isConnected, profile, logout } = useAuthStore();
  const { activeSection, setActiveSection } = useNavStore();

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 bg-lc-black/90 backdrop-blur-xl border-b border-lc-border/50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-lc-green rounded-lg flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="font-bold text-lg text-lc-white tracking-tight">
              nostr<span className="text-lc-green">.</span>starter
            </span>
          </div>

          {/* Nav links — shown when logged in */}
          {isConnected && profile && (
            <div className="flex items-center gap-1">
              {([
                { id: 'profile' as const, label: 'Profile', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                )},
                { id: 'badges' as const, label: 'Badges', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 15l-2 5l9-6.5H13L15 2l-9 8.5h7z"/>
                  </svg>
                )},
              ]).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveSection(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeSection === id
                      ? 'bg-lc-border/60 text-lc-green'
                      : 'text-lc-muted hover:text-lc-white hover:bg-lc-border/30'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-4">
            {isConnected && profile ? (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex items-center gap-2.5 py-1.5 pl-1.5 pr-4 bg-lc-dark hover:bg-lc-border rounded-full transition-all duration-200 border border-lc-border/50"
                >
                  {profile.picture ? (
                    <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-lc-border">
                      <SkeletonImage
                        src={profile.picture}
                        alt={profile.displayName || profile.name || 'Profile picture'}
                        sizes="32px"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-lc-olive flex items-center justify-center text-lc-green text-sm font-semibold">
                      {(profile.name || profile.displayName || 'N')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-lc-white font-medium max-w-[120px] truncate">
                    {profile.displayName || profile.name || 'Anon'}
                  </span>
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-lc-dark border border-lc-border rounded-xl shadow-2xl overflow-hidden z-50">
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
                          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                          <polyline points="16 17 21 12 16 7"/>
                          <line x1="21" y1="12" x2="9" y2="12"/>
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
                className="lc-pill lc-pill-primary text-sm flex items-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Connect
              </button>
            )}
          </div>
        </div>
      </nav>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
