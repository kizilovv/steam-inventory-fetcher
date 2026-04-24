export interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimitTimeoutError extends Error {
  constructor(public readonly key: string, public readonly waitedMs: number) {
    super(`Rate limit timeout for "${key}" after ${waitedMs}ms`);
    this.name = 'RateLimitTimeoutError';
  }
}

/**
 * Token-bucket rate limiter keyed by an arbitrary string (IP, proxy, bot id).
 * Tokens refill continuously at the configured rate.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.maxTokens = config?.maxTokens ?? 10;
    this.refillRate = config?.refillRate ?? 0.2; // 1 token per 5s
  }

  private getBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    if (elapsed <= 0) return;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;
  }

  private waitTimeMs(bucket: Bucket): number {
    if (bucket.tokens >= 1) return 0;
    return Math.ceil(((1 - bucket.tokens) / this.refillRate) * 1000);
  }

  async acquire(key: string, timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    const bucket = this.getBucket(key);

    while (true) {
      this.refill(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      const wait = this.waitTimeMs(bucket);
      if (Date.now() - start + wait > timeoutMs) {
        throw new RateLimitTimeoutError(key, Date.now() - start);
      }
      await new Promise((r) => setTimeout(r, Math.min(wait, 1000)));
    }
  }

  tryAcquire(key: string): boolean {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  getStatus(key: string) {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    return {
      tokens: bucket.tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      waitTimeMs: this.waitTimeMs(bucket),
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }
}
