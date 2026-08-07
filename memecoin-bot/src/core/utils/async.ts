import { TimeoutError, isRetryable, toAppError } from '../errors.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

export interface RetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
  /** Full jitter (AWS style) avoids retry storms across parallel workers. */
  readonly jitter?: boolean;
  readonly retryOn?: (error: unknown, attempt: number) => boolean;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<RetryOptions, 'retryOn' | 'onRetry' | 'signal'>> = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: true,
};

export function backoffDelay(attempt: number, options: RetryOptions = {}): number {
  const { baseDelayMs, maxDelayMs, factor, jitter } = { ...DEFAULTS, ...options };
  const exponential = Math.min(maxDelayMs, baseDelayMs * factor ** (attempt - 1));
  return jitter ? Math.random() * exponential : exponential;
}

/** Retries with exponential backoff. Non-retryable errors abort immediately. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const shouldRetry = options.retryOn ?? ((error: unknown) => isRetryable(error));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw toAppError(options.signal.reason ?? new Error('aborted'));
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error, attempt)) break;
      const delay = backoffDelay(attempt, options);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw toAppError(lastError);
}

/** Rejects with TimeoutError if the promise does not settle in time. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(operation, ms)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolves with the first successful promise; rejects only if all fail. */
export async function firstSuccessful<T>(
  factories: readonly (() => Promise<T>)[],
  operation = 'firstSuccessful',
): Promise<T> {
  const errors: unknown[] = [];
  for (const factory of factories) {
    try {
      return await factory();
    } catch (error) {
      errors.push(error);
    }
  }
  throw toAppError(
    new Error(`${operation}: all ${factories.length} candidates failed`),
    'ALL_CANDIDATES_FAILED',
  );
}

/** Bounded-concurrency map that preserves input order in the output. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Counting semaphore for capping in-flight RPC / venue calls. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  get free(): number {
    return this.available;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return this.releaseOnce();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.releaseOnce();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available++;
    };
  }
}

/**
 * Collapses concurrent calls for the same key onto one in-flight promise.
 * Used heavily by the price oracle and holder providers, where twenty
 * strategies asking for the same token at once must not become twenty requests.
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
