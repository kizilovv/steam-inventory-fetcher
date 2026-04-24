import { InventoryFetcher } from '../src/index.js';

/**
 * Rotating proxies — each proxy gets its own rate-limit bucket so you can
 * scale inventory fetches without tripping Steam's per-IP 429s.
 */
async function main() {
  const proxies = (process.env.PROXIES || '').split(',').filter(Boolean);
  if (proxies.length === 0) {
    console.error('Set PROXIES="http://user:pass@host1:port,http://user:pass@host2:port"');
    process.exit(1);
  }

  const steamId = process.argv[2] || '76561197960287930'; // Gabe

  const fetcher = new InventoryFetcher({
    proxies,
    rateLimit: { maxTokens: 5, refillRate: 0.1 }, // 1 req / 10s per proxy
    cacheTtlSeconds: 300,
  });

  const start = Date.now();
  const result = await fetcher.fetch(steamId, 730, 2);
  console.log(`Fetched ${result.totalCount} items in ${Date.now() - start}ms (cached: ${result.fromCache})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
