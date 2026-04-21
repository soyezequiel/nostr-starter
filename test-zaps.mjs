import NDK from '@nostr-dev-kit/ndk';

const ndk = new NDK({ explicitRelayUrls: ['wss://relay.damus.io', 'wss://nos.lol'] });
await ndk.connect();

const events = await ndk.fetchEvents({ kinds: [9735], limit: 20 });
for (const event of events) {
  const pTag = event.tags.find(t => t[0] === 'p')?.[1];
  const PTag = event.tags.find(t => t[0] === 'P')?.[1];
  const desc = event.tags.find(t => t[0] === 'description')?.[1];
  let sender = null;
  if (desc) {
    try {
      sender = JSON.parse(desc).pubkey;
    } catch {}
  }
  console.log(`Receipt id: ${event.id}`);
  console.log(`  Recipient (p): ${pTag}`);
  console.log(`  Provider (P): ${PTag}`);
  console.log(`  Sender (from desc): ${sender}`);
}
process.exit(0);
