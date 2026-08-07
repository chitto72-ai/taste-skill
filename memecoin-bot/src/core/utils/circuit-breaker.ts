import type { Clock } from '../clock.js';
import { SystemClock } from '../clock.js';
import { AppError } from '../errors.js';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly name: string;
  /** Consecutive failures that trip the breaker. */
  readonly failureThreshold?: number;
  /** Consecutive successes in half-open needed to close again. */
  readonly successThreshold?: number;
  readonly openMs?: number;
  readonly clock?: Clock;
  readonly onStateChange?: (state: BreakerState, name: string) => void;
}

/**
 * Guards every remote dependency. When an RPC endpoint or a venue starts
 * failing we stop hammering it immediately — in this domain a stuck endpoint
 * that eats a 10s timeout per call is worse than one that fails fast, because
 * open positions still need exits.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;
  private readonly clock: Clock;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openMs: number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.openMs = options.openMs ?? 30_000;
  }

  get currentState(): BreakerState {
    this.maybeHalfOpen();
    return this.state;
  }

  get isAvailable(): boolean {
    return this.currentState !== 'open';
  }

  get failureCount(): number {
    return this.failures;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === 'open') {
      throw new AppError(`Circuit breaker "${this.options.name}" is open`, {
        code: 'CIRCUIT_OPEN',
        category: 'network',
        retryable: true,
        context: { breaker: this.options.name, retryAfterMs: this.retryAfterMs() },
      });
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.successes++;
      if (this.successes >= this.successThreshold) this.transition('closed');
      return;
    }
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
      this.transition('open');
    }
  }

  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.transition('closed');
  }

  retryAfterMs(): number {
    if (this.state !== 'open') return 0;
    return Math.max(0, this.openedAt + this.openMs - this.clock.now());
  }

  private maybeHalfOpen(): void {
    if (this.state === 'open' && this.clock.now() - this.openedAt >= this.openMs) {
      this.transition('half_open');
    }
  }

  private transition(next: BreakerState): void {
    if (this.state === next) return;
    this.state = next;
    if (next === 'open') {
      this.openedAt = this.clock.now();
      this.successes = 0;
    }
    if (next === 'closed') {
      this.failures = 0;
      this.successes = 0;
    }
    if (next === 'half_open') this.successes = 0;
    this.options.onStateChange?.(next, this.options.name);
  }
}
