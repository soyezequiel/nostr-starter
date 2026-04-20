import NDK, { NDKEvent, NDKUser, NDKNip07Signer, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import type { Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import {
  createRelayPoolAdapter,
  type RelayCountResult,
  type RelayEventEnvelope,
} from '@/features/graph-runtime/nostr';
import { normalizeMediaUrl } from '@/lib/media';

// Popular relays (high availability)
const POPULAR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://cache2.primal.net/v1',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://purplepag.es',
];

// Global NDK instance
let ndkInstance: NDK | null = null;
let userRelaysAdded = new Set<string>();
let userRelayUrlsByPubkey = new Map<string, string[]>();

const FOLLOWER_COUNT_TIMEOUT_MS = 1200;
const FOLLOWER_SEED_LIMIT = 250;
const FOLLOWER_MAX_PAGES_PER_RELAY = 8;
const FOLLOWER_PAGINATION_RELAY_LIMIT = 4;
const FOLLOWER_PAGE_CONCURRENCY = 2;
const FOLLOWER_CONNECT_TIMEOUT_MS = 2500;
const FOLLOWER_PAGE_TIMEOUT_MS = 3500;

export function getNDK(): NDK {
  if (!ndkInstance) {
    ndkInstance = new NDK({
      explicitRelayUrls: [...POPULAR_RELAYS],
    });
  }
  return ndkInstance;
}

export async function connectNDK(): Promise<NDK> {
  const ndk = getNDK();
  ndk.connect();
  return ndk;
}

export function resetUserRelays(): void {
  userRelaysAdded = new Set<string>();
  userRelayUrlsByPubkey = new Map<string, string[]>();
}

// Fetch user's preferred relays (NIP-65 kind 10002) and add them to NDK
async function addUserRelays(pubkey: string): Promise<void> {
  if (userRelaysAdded.has(pubkey)) return;
  const ndk = getNDK();

  try {
    const relayListEvents = await withTimeout(
      ndk.fetchEvents({ kinds: [10002], authors: [pubkey], limit: 1 }),
      5000
    );
    const relayEvent = Array.from(relayListEvents)[0];
    if (relayEvent) {
      const relayTags = relayEvent.tags.filter((t) => t[0] === 'r');
      const discoveredRelayUrls: string[] = [];
      for (const tag of relayTags) {
        const url = tag[1];
        if (url && url.startsWith('wss://')) {
          discoveredRelayUrls.push(url);
          try {
            ndk.addExplicitRelay(url);
          } catch {
            // relay already added or invalid
          }
        }
      }
      userRelayUrlsByPubkey.set(pubkey, Array.from(new Set(discoveredRelayUrls)));
    }
    userRelaysAdded.add(pubkey);
  } catch {
    // timeout or error: continue with default relays
  }
}

function getRelayUrlsForPubkey(pubkey: string): string[] {
  return Array.from(
    new Set([
      ...POPULAR_RELAYS,
      ...(userRelayUrlsByPubkey.get(pubkey) ?? []),
    ]),
  );
}

function eventReferencesPubkey(event: { tags: string[][] }, pubkey: string): boolean {
  return event.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey);
}

function selectLatestFollowerEventsByPubkey(
  envelopes: readonly RelayEventEnvelope[],
  targetPubkey: string,
): RelayEventEnvelope[] {
  const latestByPubkey = new Map<string, RelayEventEnvelope>();

  for (const envelope of envelopes) {
    if (
      envelope.event.kind !== 3 ||
      envelope.event.pubkey === targetPubkey ||
      !eventReferencesPubkey(envelope.event, targetPubkey)
    ) {
      continue;
    }

    const current = latestByPubkey.get(envelope.event.pubkey);
    if (!current) {
      latestByPubkey.set(envelope.event.pubkey, envelope);
      continue;
    }

    if (envelope.event.created_at > current.event.created_at) {
      latestByPubkey.set(envelope.event.pubkey, envelope);
      continue;
    }

    if (
      envelope.event.created_at === current.event.created_at &&
      envelope.event.id.localeCompare(current.event.id) < 0
    ) {
      latestByPubkey.set(envelope.event.pubkey, envelope);
    }
  }

  return Array.from(latestByPubkey.values()).sort((left, right) =>
    left.event.pubkey.localeCompare(right.event.pubkey)
  );
}

function groupRelayEventsByRelayUrl(
  envelopes: readonly RelayEventEnvelope[],
): Map<string, RelayEventEnvelope[]> {
  const grouped = new Map<string, RelayEventEnvelope[]>();

  envelopes.forEach((envelope) => {
    const current = grouped.get(envelope.relayUrl);
    if (current) {
      current.push(envelope);
      return;
    }
    grouped.set(envelope.relayUrl, [envelope]);
  });

  return grouped;
}

function findOldestCreatedAt(
  envelopes: readonly RelayEventEnvelope[],
): number | null {
  let oldest: number | null = null;

  envelopes.forEach((envelope) => {
    if (oldest === null || envelope.event.created_at < oldest) {
      oldest = envelope.event.created_at;
    }
  });

  return oldest;
}

function selectPaginationRelayUrls({
  countByRelayUrl,
  pageLimit,
  relayLimit,
  relayUrls,
  seedEnvelopesByRelayUrl,
}: {
  countByRelayUrl: ReadonlyMap<string, number>;
  pageLimit: number;
  relayLimit: number;
  relayUrls: readonly string[];
  seedEnvelopesByRelayUrl: ReadonlyMap<string, readonly RelayEventEnvelope[]>;
}): string[] {
  if (relayLimit <= 0) {
    return [];
  }

  return relayUrls
    .map((relayUrl, index) => {
      const seedEventCount = new Set(
        (seedEnvelopesByRelayUrl.get(relayUrl) ?? []).map((envelope) => envelope.event.id)
      ).size;
      const knownCount = countByRelayUrl.get(relayUrl) ?? null;
      const hasKnownMore = knownCount !== null && knownCount > seedEventCount;
      const likelyHasMoreWithoutCount =
        knownCount === null && seedEventCount >= pageLimit;

      return {
        relayUrl,
        index,
        seedEventCount,
        knownCount,
        shouldPaginate: hasKnownMore || likelyHasMoreWithoutCount,
      };
    })
    .filter((relay) => relay.shouldPaginate)
    .sort((left, right) => {
      const leftKnown = left.knownCount ?? -1;
      const rightKnown = right.knownCount ?? -1;
      if (leftKnown !== rightKnown) {
        return rightKnown - leftKnown;
      }

      if (left.seedEventCount !== right.seedEventCount) {
        return right.seedEventCount - left.seedEventCount;
      }

      return left.index - right.index;
    })
    .slice(0, relayLimit)
    .map((relay) => relay.relayUrl);
}

async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));
}

async function collectRelayEvents(
  relayUrls: readonly string[],
  filters: Filter[],
  options?: {
    relayUrls?: readonly string[];
  },
): Promise<{
  events: RelayEventEnvelope[];
  countResults: RelayCountResult[];
}> {
  const adapter = createRelayPoolAdapter({
    relayUrls: [...relayUrls],
    connectTimeoutMs: FOLLOWER_CONNECT_TIMEOUT_MS,
    pageTimeoutMs: FOLLOWER_PAGE_TIMEOUT_MS,
    retryCount: 0,
  });

  try {
    const activeRelayUrls = options?.relayUrls ? [...options.relayUrls] : [...relayUrls];
    const [countResults, events] = await Promise.all([
      adapter.count(filters, {
        timeoutMs: FOLLOWER_COUNT_TIMEOUT_MS,
        idPrefix: 'profile-followers',
        relayUrls: activeRelayUrls,
      }),
      new Promise<RelayEventEnvelope[]>((resolve) => {
        const discoveredEvents: RelayEventEnvelope[] = [];
        let settled = false;
        const cancel = adapter.subscribe(filters, {
          priority: 'background',
          relayUrls: activeRelayUrls,
          verificationMode: 'verify-worker',
        }).subscribe({
          next: (value) => {
            discoveredEvents.push(value);
          },
          nextBatch: (values) => {
            discoveredEvents.push(...values);
          },
          error: () => {
            if (settled) return;
            settled = true;
            resolve(discoveredEvents);
          },
          complete: () => {
            if (settled) return;
            settled = true;
            resolve(discoveredEvents);
          },
        });

        setTimeout(() => {
          if (settled) return;
          settled = true;
          cancel();
          resolve(discoveredEvents);
        }, FOLLOWER_PAGE_TIMEOUT_MS + 300);
      }),
    ]);

    return { events, countResults };
  } finally {
    adapter.close();
  }
}

async function fetchFollowerDiscovery(pubkey: string): Promise<{
  followerPubkeys: string[];
  estimatedCount: number;
}> {
  const relayUrls = getRelayUrlsForPubkey(pubkey);
  const seedFilter: Filter & { '#p': string[] } = {
    kinds: [3],
    '#p': [pubkey],
    limit: FOLLOWER_SEED_LIMIT,
  };

  const { events: seedEvents, countResults } = await collectRelayEvents(relayUrls, [seedFilter]);
  const usefulCountResults = countResults.filter(
    (result) => result.supported && result.count !== null && result.count > 0
  );
  const bestRelayCount = usefulCountResults.reduce(
    (maxCount, result) => Math.max(maxCount, result.count ?? 0),
    0
  );

  const allEvents = [...seedEvents];
  const countByRelayUrl = new Map(
    usefulCountResults.map((result) => [result.relayUrl, result.count ?? 0])
  );
  const seedEnvelopesByRelayUrl = groupRelayEventsByRelayUrl(seedEvents);
  const paginationRelayUrls = selectPaginationRelayUrls({
    countByRelayUrl,
    pageLimit: FOLLOWER_SEED_LIMIT,
    relayLimit: FOLLOWER_PAGINATION_RELAY_LIMIT,
    relayUrls,
    seedEnvelopesByRelayUrl,
  });

  if (paginationRelayUrls.length > 0) {
    const paginatedAdapter = createRelayPoolAdapter({
      relayUrls,
      connectTimeoutMs: FOLLOWER_CONNECT_TIMEOUT_MS,
      pageTimeoutMs: FOLLOWER_PAGE_TIMEOUT_MS,
      retryCount: 0,
    });

    try {
      const seedEventIds = new Set(seedEvents.map((envelope) => envelope.event.id));

      await runWithConcurrencyLimit(
        paginationRelayUrls,
        FOLLOWER_PAGE_CONCURRENCY,
        async (relayUrl) => {
          const seedForRelay = seedEnvelopesByRelayUrl.get(relayUrl) ?? [];
          const knownCount = countByRelayUrl.get(relayUrl) ?? null;
          let requestedPageCount = seedForRelay.length > 0 ? 1 : 0;
          let collectedEventCount = new Set(seedForRelay.map((envelope) => envelope.event.id)).size;
          let until = findOldestCreatedAt(seedForRelay);

          while (requestedPageCount < FOLLOWER_MAX_PAGES_PER_RELAY) {
            const filter: Filter & { '#p': string[] } = {
              kinds: [3],
              '#p': [pubkey],
              limit: FOLLOWER_SEED_LIMIT,
            };
            if (until !== null) {
              filter.until = Math.max(0, until - 1);
            }

            const pageEvents = await new Promise<RelayEventEnvelope[]>((resolve) => {
              const discoveredEvents: RelayEventEnvelope[] = [];
              let settled = false;
              const cancel = paginatedAdapter.subscribe([filter], {
                priority: 'background',
                relayUrls: [relayUrl],
                verificationMode: 'verify-worker',
              }).subscribe({
                next: (value) => {
                  discoveredEvents.push(value);
                },
                nextBatch: (values) => {
                  discoveredEvents.push(...values);
                },
                error: () => {
                  if (settled) return;
                  settled = true;
                  resolve(discoveredEvents);
                },
                complete: () => {
                  if (settled) return;
                  settled = true;
                  resolve(discoveredEvents);
                },
              });

              setTimeout(() => {
                if (settled) return;
                settled = true;
                cancel();
                resolve(discoveredEvents);
              }, FOLLOWER_PAGE_TIMEOUT_MS + 300);
            });

            requestedPageCount += 1;

            const pageEventIds = new Set(pageEvents.map((envelope) => envelope.event.id));
            pageEvents.forEach((envelope) => {
              if (seedEventIds.has(envelope.event.id)) {
                return;
              }
              seedEventIds.add(envelope.event.id);
              allEvents.push(envelope);
            });

            collectedEventCount += pageEventIds.size;

            if (pageEvents.length === 0) {
              break;
            }

            if (knownCount !== null && collectedEventCount >= knownCount) {
              break;
            }

            if (pageEvents.length < FOLLOWER_SEED_LIMIT) {
              break;
            }

            until = findOldestCreatedAt(pageEvents);
            if (until === null || until <= 0) {
              break;
            }
          }
        }
      );
    } finally {
      paginatedAdapter.close();
    }
  }

  const followerPubkeys = selectLatestFollowerEventsByPubkey(allEvents, pubkey).map(
    (envelope) => envelope.event.pubkey
  );

  return {
    followerPubkeys,
    estimatedCount: Math.max(followerPubkeys.length, bestRelayCount),
  };
}

// Helper: race a promise against a timeout
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function fetchUserProfileWithTimeout(
  user: NDKUser,
  warningMessage: string
): Promise<void> {
  try {
    await withTimeout(user.fetchProfile(), 8000);
  } catch {
    console.warn(warningMessage);
  }
}

// Login methods
export type LoginMethod = 'extension' | 'nsec' | 'bunker';

export async function loginWithExtension(): Promise<NDKUser | null> {
  if (typeof window === 'undefined') {
    throw new Error('NIP-07 login only works in the browser');
  }

  const ndk = getNDK();

  // Pass NDK to the signer so the returned user is bound to the same instance.
  const signer = new NDKNip07Signer(4000, ndk);
  ndk.signer = signer;

  try {
    // Explicitly request access and wait for the extension to be ready.
    const user = await signer.blockUntilReady();
    await fetchUserProfileWithTimeout(
      user,
      'Profile fetch timed out or failed, continuing with pubkey only'
    );

    return user;
  } catch (error) {
    if (!window.nostr) {
      throw new Error('No NIP-07 extension found. Install Alby or another Nostr extension.');
    }
    throw error;
  }
}

export async function loginWithNsec(nsec: string): Promise<NDKUser | null> {
  let privateKey: string;

  try {
    if (nsec.startsWith('nsec')) {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
      // Convert Uint8Array to hex string
      const bytes = decoded.data as Uint8Array;
      privateKey = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      privateKey = nsec;
    }
  } catch {
    throw new Error('Invalid nsec format');
  }

  const ndk = getNDK();
  const signer = new NDKPrivateKeySigner(privateKey);
  ndk.signer = signer;

  const user = await signer.user();
  await fetchUserProfileWithTimeout(
    user,
    'Profile fetch timed out or failed, continuing with pubkey only'
  );

  return user;
}

export async function loginWithBunker(bunkerUrl: string): Promise<NDKUser | null> {
  const ndk = getNDK();

  const { NDKNip46Signer } = await import('@nostr-dev-kit/ndk');

  const localSigner = NDKPrivateKeySigner.generate();
  const bunkerSigner = NDKNip46Signer.bunker(ndk, bunkerUrl, localSigner);
  ndk.signer = bunkerSigner;

  await bunkerSigner.blockUntilReady();

  const user = await bunkerSigner.user();
  await fetchUserProfileWithTimeout(user, 'Profile fetch timed out or failed');

  return user;
}

// NostrConnect flow: generates a URI for QR scanning
export interface NostrConnectSession {
  uri: string;
  waitForConnection: () => Promise<NDKUser | null>;
  cancel: () => void;
}

export async function createNostrConnectSession(relay?: string): Promise<NostrConnectSession> {
  const ndk = getNDK();
  // Don't await: NDK connects in the background
  ndk.connect();

  const { NDKNip46Signer } = await import('@nostr-dev-kit/ndk');

  const connectRelay = relay || 'wss://relay.nsec.app';

  const signer = NDKNip46Signer.nostrconnect(ndk, connectRelay, undefined, {
    name: 'Nostr Espacial',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://nostr-espacial.local',
  });

  const uri = signer.nostrConnectUri || '';

  let cancelled = false;

  const waitForConnection = async (): Promise<NDKUser | null> => {
    try {
      const user = await signer.blockUntilReady();
      if (cancelled) return null;
      ndk.signer = signer;
      await fetchUserProfileWithTimeout(user, 'Profile fetch timed out or failed');
      return user;
    } catch (err) {
      if (cancelled) return null;
      throw err;
    }
  };

  const cancel = () => {
    cancelled = true;
  };

  return { uri, waitForConnection, cancel };
}

// Profile types
export interface NostrProfile {
  pubkey: string;
  npub: string;
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

export function parseProfile(user: NDKUser): NostrProfile {
  const profile = user.profile || {};

  const readProfileField = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }

    return undefined;
  };

  return {
    pubkey: user.pubkey,
    npub: user.npub,
    name: readProfileField(profile.name),
    displayName: readProfileField(profile.displayName, profile.display_name),
    about: readProfileField(profile.about),
    picture: normalizeMediaUrl(profile.image ?? profile.picture),
    banner: normalizeMediaUrl(profile.banner),
    nip05: readProfileField(profile.nip05),
    lud16: readProfileField(profile.lud16),
    website: readProfileField(profile.website),
  };
}

export async function fetchProfileByPubkey(pubkey: string): Promise<NostrProfile> {
  const ndk = await connectNDK();
  await addUserRelays(pubkey);

  const user = ndk.getUser({ pubkey });

  try {
    await withTimeout(user.fetchProfile(), 8000);
  } catch {
    console.warn(`fetchProfileByPubkey timed out or failed for ${pubkey.slice(0, 8)}...`);
  }

  return parseProfile(user);
}

// Fetch followers and following
export async function fetchFollowers(pubkey: string): Promise<string[]> {
  await addUserRelays(pubkey);

  try {
    const discovery = await withTimeout(fetchFollowerDiscovery(pubkey), 12000);
    return discovery.followerPubkeys;
  } catch {
    console.warn('fetchFollowers timed out');
    return [];
  }
}

export async function fetchFollowerCount(pubkey: string): Promise<number> {
  await addUserRelays(pubkey);

  try {
    const discovery = await withTimeout(fetchFollowerDiscovery(pubkey), 12000);
    return discovery.estimatedCount;
  } catch {
    console.warn('fetchFollowerCount timed out');
    return 0;
  }
}

export async function fetchFollowing(pubkey: string): Promise<string[]> {
  const ndk = getNDK();
  await addUserRelays(pubkey);

  try {
    const user = ndk.getUser({ pubkey });
    const followSet = await withTimeout(user.follows(), 10000);
    return Array.from(followSet).map((u) => u.pubkey);
  } catch {
    console.warn('fetchFollowing timed out');
    return [];
  }
}

// Fetch user's notes
export async function fetchUserNotes(pubkey: string, limit = 20): Promise<NDKEvent[]> {
  const ndk = getNDK();
  await addUserRelays(pubkey);

  try {
    const events = await withTimeout(
      ndk.fetchEvents({ kinds: [1], authors: [pubkey], limit }),
      10000
    );
    return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  } catch {
    console.warn('fetchUserNotes timed out');
    return [];
  }
}

// Format pubkey for display
export function formatPubkey(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
}

// Format timestamp
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString();
}
