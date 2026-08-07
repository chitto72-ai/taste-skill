import { describe, expect, it } from 'vitest';
import { TokenScanner } from '../../src/discovery/scanner.js';
import { EnrichmentPipeline } from '../../src/discovery/pipeline.js';
import { TokenScorer } from '../../src/scoring/scorer.js';
import { EventBus } from '../../src/core/event-bus.js';
import { WorkQueue } from '../../src/core/utils/queue.js';
import { TtlCache } from '../../src/core/utils/cache.js';
import { RateLimiter } from '../../src/core/utils/rate-limiter.js';
import { MemoryDriver } from '../../src/database/drivers/memory-driver.js';
import { Database } from '../../src/database/database.js';
import { BacktestEngine } from '../../src/backtesting/backtest-engine.js';
import { generateDataset } from '../../src/backtesting/dataset-generator.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { deepMerge } from '../../src/config/merge.js';
import type { TokenFeed } from '../../src/discovery/types.js';
import { candidateFrom, healthyProfile, tradeRow } from '../helpers/factories.js';

const config = createDefaultConfig();
const logger = createNullLogger();

/**
 * Load characteristics.
 *
 * These are not micro-benchmarks — they assert that the system degrades
 * gracefully rather than that it hits a specific number. The thresholds are
 * loose on purpose so the suite is not flaky on shared CI hardware; what they
 * catch is a change that makes something quadratic, unbounded or leaky.
 */
describe('scoring throughput', () => {
  it('scores thousands of tokens per second', () => {
    const scorer = new TokenScorer({ config: config.scoring });
    const profiles = Array.from({ length: 2_000 }, (_, i) =>
      healthyProfile({ market: { priceUsd: 0.001 * (1 + i / 1_000) } }),
    );

    const started = Date.now();
    for (const profile of profiles) scorer.score(profile);
    const elapsed = Date.now() - started;

    const perSecond = (profiles.length / elapsed) * 1_000;
    expect(perSecond).toBeGreaterThan(500);
  });
});

describe('scanner under a firehose', () => {
  it('processes a large batch within the per-scan cap and stays bounded', async () => {
    const now = Date.now();
    const candidates = Array.from({ length: 500 }, (_, i) =>
      candidateFrom(
        healthyProfile(
          {
            ref: { chain: 'solana', address: `So1Stress${i.toString().padStart(30, '0')}` },
            metadata: { symbol: `S${i}` },
          },
          now,
        ),
      ),
    );

    const feed: TokenFeed = {
      name: 'firehose',
      chains: ['solana'],
      poll: async () => candidates,
      refresh: async () => new Map(),
    };

    const scanner = new TokenScanner({
      feeds: [feed],
      pipeline: new EnrichmentPipeline({ enrichers: [], logger }),
      scorer: new TokenScorer({ config: config.scoring }),
      config: { ...config.discovery, maxCandidatesPerScan: 50, concurrency: 8 },
      minScore: config.scoring.minScore,
      events: new EventBus(),
      logger,
    });

    await scanner.start();
    const started = Date.now();
    await scanner.tick();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const elapsed = Date.now() - started;

    const snapshot = scanner.snapshot();
    // The per-scan cap is what stops a firehose from becoming unbounded work.
    expect(snapshot.enriched).toBeLessThanOrEqual(50 * 2);
    expect(snapshot.errors).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
    await scanner.stop();
  });
});

describe('event bus under load', () => {
  it('delivers 50k events across many subscribers without loss', async () => {
    const bus = new EventBus();
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < counts.length; i++) {
      bus.on('engine.tick', () => {
        counts[i]++;
      });
    }

    const started = Date.now();
    for (let i = 0; i < 50_000; i++) bus.emit('engine.tick', { seq: i, at: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const elapsed = Date.now() - started;

    for (const count of counts) expect(count).toBe(50_000);
    expect(bus.stats().handlerErrors).toBe(0);
    expect(elapsed).toBeLessThan(15_000);
  });
});

describe('work queue backpressure', () => {
  it('sheds load instead of growing without bound', async () => {
    const queue = new WorkQueue({ name: 'stress', concurrency: 4, maxQueued: 100 });
    const work = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

    const results = await Promise.allSettled(
      Array.from({ length: 1_000 }, (_, i) => queue.push(`task-${i}`, work)),
    );

    const rejected = results.filter((r) => r.status === 'rejected').length;
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;

    expect(rejected).toBeGreaterThan(0);
    expect(fulfilled).toBeGreaterThan(0);
    expect(queue.size).toBeLessThanOrEqual(100);
    // Every task must resolve one way or the other — no silent drops.
    expect(rejected + fulfilled).toBe(1_000);
  });
});

describe('cache and limiter memory bounds', () => {
  it('caps cache size under sustained inserts', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 60_000, maxEntries: 1_000 });
    for (let i = 0; i < 100_000; i++) cache.set(`key-${i}`, i);
    expect(cache.stats().size).toBeLessThanOrEqual(1_000);
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });

  it('paces a burst of acquisitions to the configured rate', async () => {
    const limiter = new RateLimiter({ ratePerSecond: 200, burst: 20 });
    const started = Date.now();
    for (let i = 0; i < 60; i++) await limiter.acquire();
    const elapsed = Date.now() - started;
    // 20 free, 40 more at 200/s => at least ~200ms.
    expect(elapsed).toBeGreaterThan(120);
  });
});

describe('storage under load', () => {
  it('writes and queries tens of thousands of rows', async () => {
    const database = new Database(new MemoryDriver(), { ...config.database, driver: 'memory' }, logger);
    await database.start();

    const rows = Array.from({ length: 20_000 }, (_, i) => tradeRow({ pnl: i % 3 === 0 ? -50 : 100 }, i));
    const writeStarted = Date.now();
    await database.trades.insertMany(rows);
    const writeMs = Date.now() - writeStarted;

    const queryStarted = Date.now();
    const winners = await database.trades.find({ where: [{ field: 'pnl', op: 'gt', value: 0 }] });
    const queryMs = Date.now() - queryStarted;

    expect(await database.trades.count()).toBe(20_000);
    expect(winners.length).toBeGreaterThan(10_000);
    expect(writeMs).toBeLessThan(20_000);
    expect(queryMs).toBeLessThan(20_000);

    await database.stop();
  });
});

describe('backtest scale', () => {
  it('replays a hundred thousand bars in reasonable time', async () => {
    const dataset = generateDataset({ tokens: 100, barsPerToken: 1_000, seed: 99 });
    const backtestConfig = deepMerge(config, { mode: 'backtest', logging: { level: 'silent' } } as never);

    const started = Date.now();
    const result = await new BacktestEngine(backtestConfig, {}, logger).run(dataset);
    const elapsed = Date.now() - started;

    expect(result.barsProcessed).toBe(100_000);
    expect(elapsed).toBeLessThan(120_000);
    // Sanity: accounting must still balance at scale.
    expect(result.endingCapital).toBeCloseTo(result.startingCapital + result.metrics.netPnl, 4);
  });
});
