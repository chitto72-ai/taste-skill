import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/event-bus.js';
import { VirtualClock } from '../../src/core/clock.js';
import { Container, token } from '../../src/core/container.js';
import { TtlCache } from '../../src/core/utils/cache.js';
import { RateLimiter } from '../../src/core/utils/rate-limiter.js';
import { CircuitBreaker } from '../../src/core/utils/circuit-breaker.js';
import { WorkQueue } from '../../src/core/utils/queue.js';
import { Semaphore, SingleFlight, mapConcurrent, retry, withTimeout } from '../../src/core/utils/async.js';
import { hhi, inverseScale, linearSlope, logScale, percentile, realizedVolatility, safeDiv } from '../../src/core/utils/math.js';
import { AppError, isRetryable, toAppError } from '../../src/core/errors.js';
import { redact } from '../../src/logger/redact.js';

describe('EventBus', () => {
  it('delivers typed payloads to subscribers', async () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on('engine.tick', ({ seq }) => {
      seen.push(seq);
    });
    await bus.emitAndWait('engine.tick', { seq: 1, at: 0 });
    await bus.emitAndWait('engine.tick', { seq: 2, at: 0 });
    expect(seen).toEqual([1, 2]);
  });

  it('isolates a throwing handler from the others', async () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onHandlerError: (_, error) => errors.push(error) });
    const seen: number[] = [];
    bus.on('engine.tick', () => {
      throw new Error('boom');
    });
    bus.on('engine.tick', ({ seq }) => {
      seen.push(seq);
    });

    await bus.emitAndWait('engine.tick', { seq: 7, at: 0 });
    expect(seen).toEqual([7]);
    expect(errors).toHaveLength(1);
    expect(bus.stats().handlerErrors).toBe(1);
  });

  it('unsubscribes cleanly and supports once()', async () => {
    const bus = new EventBus();
    let calls = 0;
    const sub = bus.on('engine.tick', () => {
      calls++;
    });
    bus.once('engine.tick', () => {
      calls++;
    });

    await bus.emitAndWait('engine.tick', { seq: 1, at: 0 });
    sub.unsubscribe();
    await bus.emitAndWait('engine.tick', { seq: 2, at: 0 });
    expect(calls).toBe(2);
  });

  it('waits for a matching event', async () => {
    const bus = new EventBus();
    const promise = bus.waitFor('engine.tick', ({ seq }) => seq === 5, 1_000);
    bus.emit('engine.tick', { seq: 4, at: 0 });
    bus.emit('engine.tick', { seq: 5, at: 0 });
    await expect(promise).resolves.toMatchObject({ seq: 5 });
  });
});

describe('VirtualClock', () => {
  it('fires timers in chronological order as time advances', async () => {
    const clock = new VirtualClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push('b'), 200);
    clock.setTimeout(() => order.push('a'), 100);

    await clock.advance(150);
    expect(order).toEqual(['a']);
    await clock.advance(100);
    expect(order).toEqual(['a', 'b']);
    expect(clock.now()).toBe(250);
  });

  it('reschedules intervals until disposed', async () => {
    const clock = new VirtualClock(0);
    let ticks = 0;
    const handle = clock.setInterval(() => ticks++, 50);
    await clock.advance(220);
    expect(ticks).toBe(4);
    handle.dispose();
    await clock.advance(500);
    expect(ticks).toBe(4);
  });
});

describe('Container', () => {
  it('resolves singletons once', async () => {
    const container = new Container();
    const t = token<{ id: number }>('thing');
    let built = 0;
    container.register(t, () => {
      built++;
      return { id: built };
    });
    const a = await container.resolve(t);
    const b = await container.resolve(t);
    expect(a).toBe(b);
    expect(built).toBe(1);
  });

  it('detects circular dependencies', async () => {
    const container = new Container();
    const a = token<string>('a');
    const b = token<string>('b');
    container.register(a, async (c) => `${await c.resolve(b)}a`);
    container.register(b, async (c) => `${await c.resolve(a)}b`);
    await expect(container.resolve(a)).rejects.toThrow(/circular/i);
  });

  it('reports an unregistered token clearly', async () => {
    const container = new Container();
    await expect(container.resolve(token<string>('missing'))).rejects.toThrow(/No provider/);
  });

  it('runs disposers in reverse order', async () => {
    const container = new Container();
    const order: number[] = [];
    container.onDispose(() => void order.push(1));
    container.onDispose(() => void order.push(2));
    await container.dispose();
    expect(order).toEqual([2, 1]);
  });
});

describe('TtlCache', () => {
  it('expires entries once the TTL elapses', () => {
    const clock = new VirtualClock(0);
    const cache = new TtlCache<string, number>({ ttlMs: 100, clock });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    void clock.advance(150);
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });

  it('tracks a hit rate', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 10_000 });
    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');
    expect(cache.stats().hitRate).toBeCloseTo(0.5, 6);
  });
});

describe('RateLimiter', () => {
  it('allows a burst and then refuses until refilled', () => {
    const clock = new VirtualClock(0);
    const limiter = new RateLimiter({ ratePerSecond: 10, burst: 3, clock });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    void clock.advance(200);
    expect(limiter.tryAcquire()).toBe(true);
  });
});

describe('CircuitBreaker', () => {
  it('opens after consecutive failures and rejects immediately', async () => {
    const clock = new VirtualClock(0);
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2, openMs: 1_000, clock });

    await expect(breaker.execute(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(breaker.execute(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(breaker.currentState).toBe('open');
    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(/circuit breaker/i);
  });

  it('half-opens after the cooldown and closes on success', async () => {
    const clock = new VirtualClock(0);
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      successThreshold: 1,
      openMs: 500,
      clock,
    });
    await expect(breaker.execute(() => Promise.reject(new Error('x')))).rejects.toThrow();
    await clock.advance(600);
    expect(breaker.currentState).toBe('half_open');
    await expect(breaker.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });
});

describe('WorkQueue', () => {
  it('respects the concurrency limit', async () => {
    const queue = new WorkQueue({ name: 'test', concurrency: 2 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    };
    await Promise.all(Array.from({ length: 6 }, () => queue.push('t', task)));
    expect(peak).toBeLessThanOrEqual(2);
    expect(queue.stats().completed).toBe(6);
  });

  it('runs higher-priority work first once a slot frees up', async () => {
    const queue = new WorkQueue({ name: 'test', concurrency: 1 });
    const order: string[] = [];

    const block = queue.push('block', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('block');
    });
    // Let the blocking task claim the only slot before queueing the rest.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const low = queue.push('low', async () => void order.push('low'), 0);
    const high = queue.push('high', async () => void order.push('high'), 10);

    await Promise.all([block, low, high]);
    expect(order).toEqual(['block', 'high', 'low']);
  });

  it('rejects work above the backlog limit', async () => {
    const queue = new WorkQueue({ name: 'test', concurrency: 1, maxQueued: 2 });
    const slow = () => new Promise((resolve) => setTimeout(resolve, 30));
    // All three are pushed before the pump can dequeue any of them, so the
    // third sees a full backlog.
    const first = queue.push('a', slow);
    const second = queue.push('b', slow);
    await expect(queue.push('c', slow)).rejects.toThrow(/full/i);
    expect(queue.stats().rejected).toBe(1);
    await Promise.all([first, second]);
  });
});

describe('async helpers', () => {
  it('retries retryable failures with backoff and then succeeds', async () => {
    let attempts = 0;
    const value = await retry(
      async () => {
        attempts++;
        if (attempts < 3) throw new AppError('flaky', { code: 'X', category: 'network', retryable: true });
        return 'ok';
      },
      { attempts: 5, baseDelayMs: 1 },
    );
    expect(value).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    let attempts = 0;
    await expect(
      retry(
        async () => {
          attempts++;
          throw new AppError('fatal', { code: 'X', category: 'validation', retryable: false });
        },
        { attempts: 5, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fatal');
    expect(attempts).toBe(1);
  });

  it('times out a hanging promise', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'hang')).rejects.toThrow(/timed out/i);
  });

  it('bounds concurrency while preserving order', async () => {
    const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('collapses concurrent single-flight calls onto one execution', async () => {
    const flight = new SingleFlight<number>();
    const fn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 42;
    });
    const [a, b] = await Promise.all([flight.run('k', fn), flight.run('k', fn)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps in-flight work with a semaphore', async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];
    await Promise.all([
      semaphore.run(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('a');
      }),
      semaphore.run(async () => void order.push('b')),
    ]);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('math helpers', () => {
  it('never divides by zero', () => {
    expect(safeDiv(1, 0)).toBe(0);
    expect(safeDiv(1, 0, -1)).toBe(-1);
  });

  it('scales logarithmically between bounds', () => {
    expect(logScale(1_000, 1_000, 100_000)).toBe(0);
    expect(logScale(100_000, 1_000, 100_000)).toBe(1);
    expect(logScale(10_000, 1_000, 100_000)).toBeCloseTo(0.5, 6);
  });

  it('inverts a scale so lower is better', () => {
    expect(inverseScale(0, 0, 10)).toBe(1);
    expect(inverseScale(10, 0, 10)).toBe(0);
    expect(inverseScale(5, 0, 10)).toBeCloseTo(0.5, 6);
  });

  it('computes slope, percentile, volatility and HHI', () => {
    expect(linearSlope([1, 2, 3, 4])).toBeCloseTo(1, 6);
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
    expect(realizedVolatility([1, 1, 1, 1])).toBe(0);
    expect(realizedVolatility([1, 1.1, 0.9, 1.2])).toBeGreaterThan(0);
    expect(hhi([1, 1, 1, 1])).toBeCloseTo(0.25, 6);
    expect(hhi([1, 0, 0, 0])).toBeCloseTo(1, 6);
  });
});

describe('errors', () => {
  it('classifies retryable transport errors', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isRetryable(err)).toBe(true);
    expect(isRetryable(new Error('nope'))).toBe(false);
  });

  it('wraps unknown values without losing the message', () => {
    const wrapped = toAppError('something bad');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.message).toBe('something bad');
  });
});

describe('log redaction', () => {
  it('redacts secret-shaped keys but leaves trading fields intact', () => {
    const redacted = redact({
      token: 'BONK',
      apiKey: 'super-secret',
      nested: { privateKey: 'abc', amount: 12 },
    }) as Record<string, unknown>;

    expect(redacted.token).toBe('BONK');
    expect(redacted.apiKey).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).privateKey).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).amount).toBe(12);
  });

  it('redacts key-shaped strings anywhere in a message', () => {
    const hex = `0x${'a'.repeat(64)}`;
    expect(redact({ note: `leaked ${hex}` })).toEqual({ note: 'leaked [redacted]' });
  });
});
