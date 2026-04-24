export interface InventoryItem {
  assetId: string;
  classId: string;
  instanceId: string;
  amount: number;
  appId: number;
  contextId: number;
  marketHashName: string;
  marketName: string;
  type?: string;
  tradable: boolean;
  marketable: boolean;
  iconUrl?: string;
  iconUrlLarge?: string;
  nameColor?: string;
  backgroundColor?: string;
  tags?: Array<{ category: string; internalName: string; name: string }>;
  descriptions?: Array<{ type?: string; value: string; color?: string }>;
}

export interface SteamProfile {
  steamId: string;
  username?: string;
  avatar?: string;
}

export interface FetcherOptions {
  /**
   * HTTP(S) proxy URLs. When multiple are supplied, requests are rotated
   * round-robin so each proxy gets its own rate-limit bucket.
   */
  proxies?: string[];
  /** Per-request timeout (ms). Default: 15_000. */
  timeoutMs?: number;
  /** Per-IP/proxy rate limit. Default: 10 tokens, refill 0.2/s (1 req / 5s). */
  rateLimit?: { maxTokens?: number; refillRate?: number };
  /** Max pages to pull (each ~5000 items). Default: 20 (=100k items). */
  maxPages?: number;
  /** Cache TTL seconds. Default: 120. Set to 0 to disable cache. */
  cacheTtlSeconds?: number;
  /** User-Agent header. */
  userAgent?: string;
  /**
   * Retry config for transient errors (429 / 5xx). Default: 3 retries
   * with exponential backoff starting at 2s.
   */
  retries?: { count?: number; baseMs?: number };
}

export interface FetchResult {
  steamId: string;
  appId: number;
  contextId: number;
  items: InventoryItem[];
  totalCount: number;
  fromCache: boolean;
  fingerprint: string;
  fetchedAt: number;
}

export class InventoryPrivateError extends Error {
  constructor(public readonly steamId: string) {
    super(`Inventory for ${steamId} is private or user does not exist`);
    this.name = 'InventoryPrivateError';
  }
}

export class InventoryRateLimitError extends Error {
  constructor(public readonly steamId: string, public readonly retryAfterMs?: number) {
    super(`Steam rate limit hit for ${steamId}${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ''}`);
    this.name = 'InventoryRateLimitError';
  }
}

export class InventoryFetchError extends Error {
  constructor(public readonly steamId: string, public readonly status: number, message: string) {
    super(`Inventory fetch failed for ${steamId} (HTTP ${status}): ${message}`);
    this.name = 'InventoryFetchError';
  }
}
