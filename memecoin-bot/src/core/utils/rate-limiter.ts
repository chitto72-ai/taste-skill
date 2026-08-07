import type { Clock } from '../clock.js';
import { SystemClock } from '../clock.js';
import { sleep } from './async.js';

export interface RateLimiterOptions {
  /** Sustained request rate. */
  readonly ratePerSecond: number;
  /** Burst allowance; defaults to one second worth of tokens. */
  readonly burst?: number;
  readonly clock?: Clock;
}

/**
 * Token-bucket limiter shared by every outbound client (RPC, venue REST,
 * social APIs). Bursty by design — memecoin entries are latency-sensitive and
 * a strictly-paced limiter would spend the edge waiting.
 */
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefill: number;
  private readonly clock: Clock;
  private waiting = 0;

  constructor(options: RateLimiterOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.capacity = Math.max(1, options.burst ?? Math.ceil(options.ratePerSecond));
    this.refillPerMs = options.ratePerSecond / 1000;
    this.tokens = this.capacity;
    this.lastRefill = this.clock.now();
  }

  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  get queueDepth(): number {
    return this.waiting;
  }

  /** Non-blocking attempt; returns false when the bucket is empty. */
  tryAcquire(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Blocks until `cost` tokens are available. */
  async acquire(cost = 1): Promise<void> {
    this.waiting++;
    try {
      for (;;) {
        this.refill();
        if (this.tokens >= cost) {
          this.tokens -= cost;
          return;
        }
        const deficit = cost - this.tokens;
        await sleep(Math.max(1, Math.ceil(deficit / this.refillPerMs)));
      }
    } finally {
      this.waiting--;
    }
  }

  async schedule<T>(fn: () => Promise<T>, cost = 1): Promise<T> {
    await this.acquire(cost);
    return fn();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}
