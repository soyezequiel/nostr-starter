'use client';

import {NDKUser} from '@nostr-dev-kit/ndk';
import {useTranslations} from 'next-intl';
import {useState, useEffect, useEffectEvent, useCallback, useRef} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {useAuthStore} from '@/store/auth';
import {
  connectNDK,
  loginWithExtension,
  loginWithNsec,
  loginWithBunker,
  createNostrConnectSession,
  type LoginMethod,
  type NostrConnectSession,
} from '@/lib/nostr';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type BunkerTab = 'qr' | 'url';

function translateAuthError(input: unknown, t: ReturnType<typeof useTranslations<'auth.errors'>>) {
  const message = input instanceof Error ? input.message : '';

  if (message.includes('No NIP-07 extension found.')) {
    return t('missingExtension');
  }
  if (message.includes('Nostr extension not detected.')) {
    return t('missingExtensionInline');
  }
  if (message === 'Please enter your nsec') {
    return t('missingNsec');
  }
  if (message === 'Please enter your bunker URL') {
    return t('missingBunkerUrl');
  }
  if (message === 'Invalid nsec format' || message === 'Invalid nsec') {
    return t('invalidNsec');
  }
  if (message === 'Connection failed') {
    return t('connectionFailed');
  }
  if (message === 'Login failed') {
    return t('loginFailed');
  }

  return message || t('loginFailed');
}

export default function LoginModal({isOpen, onClose}: LoginModalProps) {
  const [method, setMethod] = useState<LoginMethod | null>(null);
  const [nsecInput, setNsecInput] = useState('');
  const [bunkerInput, setBunkerInput] = useState('');
  const [hasNip07, setHasNip07] = useState(false);
  const [bunkerTab, setBunkerTab] = useState<BunkerTab>('qr');
  const [connectUri, setConnectUri] = useState('');
  const [waitingForScan, setWaitingForScan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState<LoginMethod | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const sessionRef = useRef<NostrConnectSession | null>(null);
  const {setUser, setLoading, setError, isLoading, error} = useAuthStore();
  const t = useTranslations('auth');
  const errorT = useTranslations('auth.errors');

  const handleBunkerConnected = useEffectEvent((user: NDKUser) => {
    setStatusMessage(t('status.bunkerConnected'));
    setUser(user, 'bunker');
    onClose();
  });

  const handleBunkerError = useEffectEvent((err: unknown) => {
    console.error('NostrConnect error:', err);
    setError(translateAuthError(err, errorT));
    setWaitingForScan(false);
  });

  useEffect(() => {
    if (!isOpen) return;
    const check = () => setHasNip07(!!window.nostr);
    check();
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (method !== 'bunker' || bunkerTab !== 'qr') return;

    let cancelled = false;

    const generate = async () => {
      try {
        setConnectUri('');
        setWaitingForScan(false);
        setStatusMessage(t('status.createSession'));

        const session = await createNostrConnectSession();
        if (cancelled) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
        setConnectUri(session.uri);
        setWaitingForScan(true);
        setStatusMessage(t('status.qrReady'));

        const user = await session.waitForConnection();
        if (cancelled || !user) return;

        handleBunkerConnected(user);
      } catch (err) {
        if (!cancelled) {
          handleBunkerError(err);
        }
      }
    };

    void generate();

    return () => {
      cancelled = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, [bunkerTab, method, t]);

  useEffect(() => {
    if (!isOpen) {
      setMethod(null);
      setConnectUri('');
      setWaitingForScan(false);
      setCopied(false);
      setStatusMessage(null);
      sessionRef.current?.cancel();
      sessionRef.current = null;
    }
  }, [isOpen]);

  const handleCopyUri = useCallback(async () => {
    if (!connectUri) return;
    try {
      await navigator.clipboard.writeText(connectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = connectUri;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [connectUri]);

  if (!isOpen) return null;

  const handleLogin = async (loginMethod: LoginMethod) => {
    setLoading(true);
    setLoadingMethod(loginMethod);
    setError(null);
    setStatusMessage(t('status.verifyMethod'));

    try {
      await connectNDK();

      let user = null;

      switch (loginMethod) {
        case 'extension':
          if (!window.nostr) {
            throw new Error('Nostr extension not detected. Make sure Alby or nos2x is installed and tap the extension icon.');
          }
          setStatusMessage(t('status.requestPubkey'));
          user = await loginWithExtension();
          break;
        case 'nsec':
          if (!nsecInput.trim()) {
            throw new Error('Please enter your nsec');
          }
          setStatusMessage(t('status.decodeNsec'));
          user = await loginWithNsec(nsecInput);
          break;
        case 'bunker':
          if (!bunkerInput.trim()) {
            throw new Error('Please enter your bunker URL');
          }
          setStatusMessage(t('status.connectBunker'));
          user = await loginWithBunker(bunkerInput);
          break;
      }

      if (user) {
        setStatusMessage(t('status.syncSession'));
        setUser(user, loginMethod);
        onClose();
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(translateAuthError(err, errorT));
    } finally {
      setLoading(false);
      setLoadingMethod(null);
      setStatusMessage(null);
    }
  };

  const handleBack = () => {
    setMethod(null);
    setConnectUri('');
    setWaitingForScan(false);
    setCopied(false);
    setStatusMessage(null);
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[min(90dvh,44rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-lc-border bg-lc-dark p-5 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4 sm:mb-8">
          <div>
            <h2 className="text-xl font-bold text-lc-white">{t('header.title')}</h2>
            <p className="mt-1 text-sm text-lc-muted">{t('header.subtitle')}</p>
          </div>
          <button
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-lc-border/50 text-lc-muted transition hover:bg-lc-border hover:text-lc-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {statusMessage && (
          <div
            aria-live="polite"
            className="mb-6 rounded-lg border border-lc-green/20 bg-lc-green/10 p-3 text-sm text-lc-white"
            role="status"
          >
            <div className="font-semibold text-lc-green">{t('status.title')}</div>
            <div className="mt-1 text-lc-muted">{statusMessage}</div>
          </div>
        )}

        {!method ? (
          <div className="space-y-3">
            {hasNip07 && (
              <button
                onClick={() => handleLogin('extension')}
                disabled={isLoading}
                className="group flex min-h-[52px] w-full items-center gap-4 rounded-xl border border-lc-green/20 bg-lc-olive/40 p-4 transition-all duration-200 hover:bg-lc-olive/60 disabled:opacity-50"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lc-green/20 transition group-hover:bg-lc-green/30">
                  {loadingMethod === 'extension' ? (
                    <div className="lc-spinner" />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b4f953" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-lc-white">{t('methods.browserExtension')}</div>
                  <div className="text-sm text-lc-muted">
                    {loadingMethod === 'extension'
                      ? t('methods.browserExtensionLoading')
                      : t('methods.browserExtensionSubtitle')}
                  </div>
                </div>
                {loadingMethod !== 'extension' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="2" className="opacity-0 transition group-hover:opacity-100">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </button>
            )}

            <button
              onClick={() => setMethod('nsec')}
              disabled={isLoading}
              className="group flex min-h-[52px] w-full items-center gap-4 rounded-xl border border-lc-border bg-lc-card p-4 transition-all duration-200 hover:bg-lc-border/50 disabled:opacity-50"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lc-border transition group-hover:bg-lc-border/80">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-lc-white">{t('methods.privateKey')}</div>
                <div className="text-sm text-lc-muted">{t('methods.privateKeySubtitle')}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="2" className="opacity-0 transition group-hover:opacity-100">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              onClick={() => setMethod('bunker')}
              disabled={isLoading}
              className="group flex min-h-[52px] w-full items-center gap-4 rounded-xl border border-lc-border bg-lc-card p-4 transition-all duration-200 hover:bg-lc-border/50 disabled:opacity-50"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lc-border transition group-hover:bg-lc-border/80">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-lc-white">{t('methods.bunker')}</div>
                <div className="text-sm text-lc-muted">{t('methods.bunkerSubtitle')}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="2" className="opacity-0 transition group-hover:opacity-100">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        ) : method === 'nsec' ? (
          <div className="space-y-5">
            <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-lc-muted transition hover:text-lc-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              {t('common.back')}
            </button>
            <div>
              <label className="mb-2 block text-sm font-medium text-lc-muted">
                {t('nsec.label')}
              </label>
              <input
                type="password"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                placeholder={t('nsec.placeholder')}
                className="w-full rounded-xl border border-lc-border bg-lc-black p-3.5 font-mono text-sm text-lc-white placeholder-lc-border transition focus:border-lc-green/50 focus:outline-none focus:ring-1 focus:ring-lc-green/20"
              />
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-lc-muted">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t('nsec.warning')}
              </p>
            </div>
            <button
              onClick={() => handleLogin('nsec')}
              disabled={isLoading || !nsecInput.trim()}
              className="lc-pill lc-pill-primary flex w-full items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loadingMethod === 'nsec' && <div className="lc-spinner" style={{borderTopColor: '#0a0a0a', borderColor: 'rgba(10,10,10,0.3)'}} />}
              {loadingMethod === 'nsec' ? t('common.connecting') : t('common.connect')}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-lc-muted transition hover:text-lc-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              {t('common.back')}
            </button>

            <div className="flex rounded-xl border border-lc-border/50 bg-lc-black p-1">
              <button
                onClick={() => setBunkerTab('qr')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  bunkerTab === 'qr'
                    ? 'bg-lc-border text-lc-white'
                    : 'text-lc-muted hover:text-lc-white'
                }`}
              >
                {t('bunker.tabs.qr')}
              </button>
              <button
                onClick={() => setBunkerTab('url')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  bunkerTab === 'url'
                    ? 'bg-lc-border text-lc-white'
                    : 'text-lc-muted hover:text-lc-white'
                }`}
              >
                {t('bunker.tabs.url')}
              </button>
            </div>

            {bunkerTab === 'qr' ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  {connectUri ? (
                    <>
                      <div className="mb-4 rounded-2xl bg-white p-4">
                        <QRCodeSVG
                          value={connectUri}
                          size={200}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#0a0a0a"
                        />
                      </div>
                      <p className="mb-3 text-center text-sm text-lc-muted">
                        {t('bunker.scanInstructions')}
                      </p>

                      <button
                        onClick={handleCopyUri}
                        className="flex items-center gap-2 rounded-lg border border-lc-border/50 bg-lc-black px-3 py-1.5 text-xs text-lc-muted transition hover:text-lc-green"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                        {copied ? t('common.copied') : t('common.copyConnectionUri')}
                      </button>

                      {waitingForScan && (
                        <div className="mt-4 flex items-center gap-2 text-sm text-lc-green">
                          <div className="lc-spinner" />
                          {t('bunker.waiting')}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <div className="lc-spinner" />
                      <p className="text-sm text-lc-muted">{t('bunker.generating')}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-lc-muted">
                    {t('bunker.pasteLabel')}
                  </label>
                  <input
                    type="text"
                    value={bunkerInput}
                    onChange={(e) => setBunkerInput(e.target.value)}
                    placeholder={t('bunker.pastePlaceholder')}
                    className="w-full rounded-xl border border-lc-border bg-lc-black p-3.5 font-mono text-sm text-lc-white placeholder-lc-border transition focus:border-lc-green/50 focus:outline-none focus:ring-1 focus:ring-lc-green/20"
                  />
                  <p className="mt-2.5 text-xs text-lc-muted">{t('bunker.pasteHelp')}</p>
                </div>
                <button
                  onClick={() => handleLogin('bunker')}
                  disabled={isLoading || !bunkerInput.trim()}
                  className="lc-pill lc-pill-primary flex w-full items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loadingMethod === 'bunker' && <div className="lc-spinner" style={{borderTopColor: '#0a0a0a', borderColor: 'rgba(10,10,10,0.3)'}} />}
                  {loadingMethod === 'bunker' ? t('common.connecting') : t('common.connect')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
