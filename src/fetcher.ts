import { HttpsProxyAgent } from 'https-proxy-agent';
import { RateLimiter } from './rateLimiter.js';
import { InventoryCache, type CacheBackend, inventoryFingerprint } from './cache.js';
import {
  type FetcherOptions,
  type FetchResult,
  type InventoryItem,
  InventoryPrivateError,
  InventoryRateLimitError,
  InventoryFetchError,
} from './types.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface RawPage {
  assets?: Array<{ appid: number; contextid: string; assetid: string; classid: string; instanceid: string; amount: string }>;
  descriptions?: Array<RawDescription>;
  more_items?: number;
  last_assetid?: string;
  total_inventory_count?: number;
  success?: number;
  error?: string;
}

interface RawDescription {
  appid: number;
  classid: string;
  instanceid: string;
  market_hash_name?: string;
  market_name?: string;
  name?: string;
  type?: string;
  tradable?: number;
  marketable?: number;
  icon_url?: string;
  icon_url_large?: string;
  name_color?: string;
  background_color?: string;
  tags?: Array<{ category: string; internal_name: string; localized_tag_name?: string; name?: string }>;
  descriptions?: Array<{ type?: string; value: string; color?: string }>;
}

/**
 * Steam public inventory fetcher.
 *
 * Uses `https://steamcommunity.com/inventory/{steamId}/{appId}/{contextId}` —
 * the same endpoint CSFloat / community extensions use. No Steam auth required
 * for public inventories. Respects rate limits per-proxy (or per-host when
 * running without proxies).
 */
export class InventoryFetcher {
  private readonly opts: Required<Omit<FetcherOptions, 'proxies'>> & { proxies: string[] };
  private readonly limiter: RateLimiter;
  private readonly cache: InventoryCache | null;
  private proxyIdx = 0;

  constructor(options: FetcherOptions = {}, cacheBackend?: CacheBackend) {
    this.opts = {
      proxies: options.proxies ?? [],
      timeoutMs: options.timeoutMs ?? 15_000,
      rateLimit: { maxTokens: options.rateLimit?.maxTokens ?? 10, refillRate: options.rateLimit?.refillRate ?? 0.2 },
      maxPages: options.maxPages ?? 20,
      cacheTtlSeconds: options.cacheTtlSeconds ?? 120,
      userAgent: options.userAgent ?? DEFAULT_UA,
      retries: { count: options.retries?.count ?? 3, baseMs: options.retries?.baseMs ?? 2000 },
    };

    this.limiter = new RateLimiter({
      maxTokens: this.opts.rateLimit.maxTokens,
      refillRate: this.opts.rateLimit.refillRate,
    });

    this.cache = this.opts.cacheTtlSeconds > 0 && cacheBackend
      ? new InventoryCache(cacheBackend)
      : this.opts.cacheTtlSeconds > 0
      ? new InventoryCache() // in-memory default
      : null;
  }

  async fetch(steamId: string, appId = 730, contextId = 2): Promise<FetchResult> {
    if (!/^\d{17}$/.test(steamId)) {
      throw new Error(`Invalid Steam64 ID: ${steamId}`);
    }

    if (this.cache) {
      const cached = await this.cache.get(steamId, appId, contextId);
      if (cached && cached.expiresAt > Date.now()) {
        return {
          steamId,
          appId,
          contextId,
          items: cached.items,
          totalCount: cached.itemCount,
          fromCache: true,
          fingerprint: cached.fingerprint,
          fetchedAt: cached.fetchedAt,
        };
      }
    }

    const items = await this.fetchAllPages(steamId, appId, contextId);
    const fingerprint = inventoryFingerprint(items);
    const fetchedAt = Date.now();

    if (this.cache) {
      await this.cache.set(steamId, appId, contextId, items, this.opts.cacheTtlSeconds);
    }

    return { steamId, appId, contextId, items, totalCount: items.length, fromCache: false, fingerprint, fetchedAt };
  }

  private async fetchAllPages(steamId: string, appId: number, contextId: number): Promise<InventoryItem[]> {
    const all: InventoryItem[] = [];
    let startAssetId: string | undefined;

    for (let page = 0; page < this.opts.maxPages; page++) {
      const raw = await this.fetchPageWithRetry(steamId, appId, contextId, startAssetId);
      const items = mergeAssetsAndDescriptions(raw);
      all.push(...items);

      if (!raw.more_items || !raw.last_assetid) return all;
      startAssetId = raw.last_assetid;
    }
    return all;
  }

  private nextProxy(): string | null {
    if (this.opts.proxies.length === 0) return null;
    const proxy = this.opts.proxies[this.proxyIdx % this.opts.proxies.length];
    this.proxyIdx += 1;
    return proxy;
  }

  private async fetchPageWithRetry(
    steamId: string,
    appId: number,
    contextId: number,
    startAssetId?: string,
  ): Promise<RawPage> {
    let lastErr: unknown;
    const { count, baseMs } = this.opts.retries;

    for (let attempt = 0; attempt <= count!; attempt++) {
      try {
        return await this.fetchPage(steamId, appId, contextId, startAssetId);
      } catch (err) {
        lastErr = err;
        if (err instanceof InventoryPrivateError) throw err; // not retryable
        if (attempt === count) break;
        const delay = baseMs! * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private async fetchPage(
    steamId: string,
    appId: number,
    contextId: number,
    startAssetId?: string,
  ): Promise<RawPage> {
    const proxy = this.nextProxy();
    const limiterKey = proxy ?? 'direct';
    await this.limiter.acquire(limiterKey);

    const qs = new URLSearchParams({ l: 'english', count: '5000' });
    if (startAssetId) qs.set('start_assetid', startAssetId);
    const url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?${qs.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    const init: RequestInit & { agent?: unknown } = {
      method: 'GET',
      headers: {
        'User-Agent': this.opts.userAgent,
        'Accept': 'application/json',
        'Referer': `https://steamcommunity.com/profiles/${steamId}/inventory`,
      },
      signal: controller.signal,
    };

    if (proxy) {
      init.agent = new HttpsProxyAgent(proxy);
    }

    let response: Response;
    try {
      response = await fetch(url, init as RequestInit);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 403) throw new InventoryPrivateError(steamId);
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) * 1000 || undefined;
      throw new InventoryRateLimitError(steamId, retryAfter);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new InventoryFetchError(steamId, response.status, body.slice(0, 200));
    }

    const body = (await response.json()) as RawPage;
    if (body && 'success' in body && body.success === 0) {
      throw new InventoryPrivateError(steamId);
    }
    return body;
  }
}

function mergeAssetsAndDescriptions(raw: RawPage): InventoryItem[] {
  if (!raw.assets || !raw.descriptions) return [];

  const descIndex = new Map<string, RawDescription>();
  for (const d of raw.descriptions) {
    descIndex.set(`${d.classid}_${d.instanceid}`, d);
  }

  const items: InventoryItem[] = [];
  for (const asset of raw.assets) {
    const desc = descIndex.get(`${asset.classid}_${asset.instanceid}`);
    if (!desc) continue;

    items.push({
      assetId: asset.assetid,
      classId: asset.classid,
      instanceId: asset.instanceid,
      amount: Number(asset.amount) || 1,
      appId: asset.appid,
      contextId: Number(asset.contextid),
      marketHashName: desc.market_hash_name ?? desc.name ?? '',
      marketName: desc.market_name ?? desc.name ?? '',
      type: desc.type,
      tradable: desc.tradable === 1,
      marketable: desc.marketable === 1,
      iconUrl: desc.icon_url ? `https://community.fastly.steamstatic.com/economy/image/${desc.icon_url}` : undefined,
      iconUrlLarge: desc.icon_url_large
        ? `https://community.fastly.steamstatic.com/economy/image/${desc.icon_url_large}`
        : undefined,
      nameColor: desc.name_color,
      backgroundColor: desc.background_color,
      tags: desc.tags?.map((t) => ({
        category: t.category,
        internalName: t.internal_name,
        name: t.localized_tag_name ?? t.name ?? t.internal_name,
      })),
      descriptions: desc.descriptions,
    });
  }
  return items;
}
