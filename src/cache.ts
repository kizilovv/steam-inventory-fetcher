import { createHash } from 'crypto';
import type { InventoryItem, SteamProfile } from './types.js';

export interface CachedInventory {
  steamId: string;
  appId: number;
  contextId: number;
  items: InventoryItem[];
  fingerprint: string;
  itemCount: number;
  fetchedAt: number;
  expiresAt: number;
  profile?: SteamProfile;
}

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryCache implements CacheBackend {
  private store = new Map<string, { expires: number; value: string }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Redis-compatible wrapper (accepts ioredis / redis@4 instance with matching methods).
 */
export class RedisCache implements CacheBackend {
  constructor(private redis: { get(k: string): Promise<string | null>; setex(k: string, s: number, v: string): Promise<unknown>; del(k: string): Promise<unknown>; }) {}
  async get(k: string) { return this.redis.get(k); }
  async setex(k: string, s: number, v: string) { await this.redis.setex(k, s, v); }
  async del(k: string) { await this.redis.del(k); }
}

/**
 * Deterministic fingerprint across inventory snapshots — useful to skip
 * downstream work when the inventory hasn't changed since the last fetch.
 */
export function inventoryFingerprint(items: InventoryItem[]): string {
  const sorted = items.map((i) => i.assetId).sort().join(',');
  return createHash('sha256').update(sorted).digest('hex');
}

export class InventoryCache {
  constructor(private backend: CacheBackend = new MemoryCache(), private prefix = 'inventory') {}

  private key(steamId: string, appId: number, contextId: number): string {
    return `${this.prefix}:${steamId}:${appId}:${contextId}`;
  }

  async set(
    steamId: string,
    appId: number,
    contextId: number,
    items: InventoryItem[],
    ttlSeconds: number,
    profile?: SteamProfile,
  ): Promise<CachedInventory> {
    const now = Date.now();
    const entry: CachedInventory = {
      steamId,
      appId,
      contextId,
      items,
      fingerprint: inventoryFingerprint(items),
      itemCount: items.length,
      fetchedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      ...(profile ? { profile } : {}),
    };
    await this.backend.setex(this.key(steamId, appId, contextId), ttlSeconds, JSON.stringify(entry));
    return entry;
  }

  async get(steamId: string, appId: number, contextId: number): Promise<CachedInventory | null> {
    const raw = await this.backend.get(this.key(steamId, appId, contextId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedInventory;
    } catch {
      return null;
    }
  }

  async delete(steamId: string, appId: number, contextId: number): Promise<void> {
    await this.backend.del(this.key(steamId, appId, contextId));
  }
}
