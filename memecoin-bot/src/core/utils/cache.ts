import type { Clock } from '../clock.js';
import { SystemClock } from '../clock.js';

interface Entry<V> {
  value: V;
  expiresAt: number;
  hits: number;
}

export interface CacheOptions {
  readonly ttlMs: number;
  readonly maxEntries?: number;
  readonly clock?: Clock;
}

export interface CacheStats {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly hitRate: number;
}

/**
 * TTL + LRU cache. Insertion order of a Map is the LRU order once we re-insert
 * on every read, which avoids maintaining a separate linked list.
 */
export class TtlCache<K, V> {
  private readonly store = new Map<K, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: Clock;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.clock = options.clock ?? new SystemClock();
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= this.clock.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    entry.hits++;
    this.hits++;
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    if (this.store.has(key)) this.store.delete(key);
    else if (this.store.size >= this.maxEntries) this.evictOldest();
    this.store.set(key, { value, expiresAt: this.clock.now() + ttlMs, hits: 0 });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Reads through to `loader` on miss, caching the result. */
  async getOrLoad(key: K, loader: () => Promise<V>, ttlMs = this.ttlMs): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Drops expired entries; call periodically for long-lived caches. */
  prune(): number {
    const now = this.clock.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  keys(): K[] {
    return [...this.store.keys()];
  }

  values(): V[] {
    const now = this.clock.now();
    return [...this.store.values()].filter((e) => e.expiresAt > now).map((e) => e.value);
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  private evictOldest(): void {
    const oldest = this.store.keys().next();
    if (!oldest.done) {
      this.store.delete(oldest.value);
      this.evictions++;
    }
  }
}
