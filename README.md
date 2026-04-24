# steam-inventory-fetcher

Fast, production-grade Steam inventory fetcher for Node.js. Battle-tested in a CS2 trading marketplace handling 1000+ daily users.

- **Zero Steam auth** — uses the public `steamcommunity.com/inventory` endpoint, same one CSFloat / community extensions hit.
- **Proxy rotation** — round-robin across an HTTP(S) proxy pool, each proxy gets its own rate-limit bucket.
- **Token-bucket rate limiter** — per-proxy (or per-host when no proxies) with automatic refill.
- **Pluggable caching** — in-memory by default, drop in any Redis client for multi-process deployments.
- **Change detection** — SHA-256 fingerprint of sorted asset IDs lets you skip downstream work when inventory hasn't changed.
- **Pagination** — handles Steam's `more_items`/`last_assetid` protocol out of the box (up to 100k items per inventory).
- **Trade-URL utilities** — parse, validate, convert partner ID ↔ Steam64.

---

## Install

```bash
npm install steam-inventory-fetcher
```

## Quick start

```ts
import { InventoryFetcher } from 'steam-inventory-fetcher';

const fetcher = new InventoryFetcher({
  cacheTtlSeconds: 120,
});

const result = await fetcher.fetch('76561197960287930', 730, 2); // CS2 = appId 730, ctx 2
console.log(`${result.totalCount} items, fingerprint: ${result.fingerprint}`);

for (const item of result.items) {
  if (item.tradable) console.log(item.marketHashName);
}
```

## With a proxy pool

```ts
const fetcher = new InventoryFetcher({
  proxies: [
    'http://user:pass@proxy1.example.com:8080',
    'http://user:pass@proxy2.example.com:8080',
  ],
  rateLimit: { maxTokens: 5, refillRate: 0.1 }, // 1 req / 10s per proxy
  cacheTtlSeconds: 300,
});

const result = await fetcher.fetch(steamId);
```

## With Redis cache (production)

```ts
import Redis from 'ioredis';
import { InventoryFetcher, RedisCache } from 'steam-inventory-fetcher';

const redis = new Redis(process.env.REDIS_URL);
const fetcher = new InventoryFetcher(
  { cacheTtlSeconds: 300 },
  new RedisCache(redis),
);
```

## Trade-URL utilities

```ts
import {
  parseTradeUrl,
  partnerIdToSteam64,
  buildTradeUrl,
} from 'steam-inventory-fetcher';

const { partnerId, token } = parseTradeUrl(
  'https://steamcommunity.com/tradeoffer/new/?partner=123456789&token=abcDEF12'
);

const steam64 = partnerIdToSteam64(partnerId); // '76561198083732517'
const rebuilt = buildTradeUrl(partnerId, token);
```

---

## Error handling

All errors are subclasses of `Error` — import and narrow:

```ts
import {
  InventoryPrivateError,
  InventoryRateLimitError,
  InventoryFetchError,
} from 'steam-inventory-fetcher';

try {
  await fetcher.fetch(steamId);
} catch (err) {
  if (err instanceof InventoryPrivateError) return 'private';
  if (err instanceof InventoryRateLimitError) return 'retry-later';
  throw err;
}
```

## Options

| Option | Default | Description |
|---|---|---|
| `proxies` | `[]` | HTTP(S) proxy URLs. Round-robin rotation. |
| `timeoutMs` | `15000` | Per-request timeout. |
| `rateLimit.maxTokens` | `10` | Bucket capacity per proxy/host. |
| `rateLimit.refillRate` | `0.2` | Tokens per second (0.2 = 1 req / 5s). |
| `maxPages` | `20` | Max pages (each ~5000 items). |
| `cacheTtlSeconds` | `120` | Cache TTL. `0` disables cache. |
| `retries.count` | `3` | Retries for 429 / 5xx. |
| `retries.baseMs` | `2000` | Exponential backoff base. |

## What this does NOT do

- No Steam login, no trade offers, no bot orchestration — just reads public inventories.
- No persistence beyond the cache you plug in.
- Items with `tradable=false` from trade holds / ban protection won't appear here — the public endpoint hides them by design. For bot-owned inventories including holds you need `IEconService/GetInventoryItemsWithDescriptions` with an access token, which is out of scope.

## License

MIT
