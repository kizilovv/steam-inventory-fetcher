import { InventoryFetcher, InventoryPrivateError } from '../src/index.js';

async function main() {
  const steamId = process.argv[2];
  if (!steamId) {
    console.error('Usage: tsx examples/basic.ts <steamId64>');
    process.exit(1);
  }

  const fetcher = new InventoryFetcher({
    cacheTtlSeconds: 120,
  });

  try {
    const result = await fetcher.fetch(steamId, 730, 2); // CS2 = appId 730
    console.log(`Fetched ${result.totalCount} items (cached: ${result.fromCache})`);
    console.log(`Fingerprint: ${result.fingerprint.slice(0, 12)}…`);

    const tradable = result.items.filter((i) => i.tradable);
    console.log(`Tradable: ${tradable.length}`);

    for (const item of result.items.slice(0, 5)) {
      console.log(`- ${item.marketHashName} (${item.type ?? 'unknown'})`);
    }
  } catch (err) {
    if (err instanceof InventoryPrivateError) {
      console.error(`Inventory for ${steamId} is private.`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
