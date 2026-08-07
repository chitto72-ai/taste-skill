import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/database/database.js';
import { MemoryDriver } from '../../src/database/drivers/memory-driver.js';
import { FileDriver } from '../../src/database/drivers/file-driver.js';
import { applyQuery } from '../../src/database/driver.js';
import { TokenRepository } from '../../src/database/repositories/token-repository.js';
import { PositionRepository } from '../../src/database/repositories/position-repository.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { healthyProfile, openPosition, tradeRow, TEST_NOW } from '../helpers/factories.js';
import type { TradeRow } from '../../src/database/types.js';

const dbConfig = createDefaultConfig().database;

describe('query engine', () => {
  const rows: TradeRow[] = [
    tradeRow({ pnl: 100, strategy: 'sniper' }, 0),
    tradeRow({ pnl: -50, strategy: 'momentum' }, 1),
    tradeRow({ pnl: 300, strategy: 'sniper' }, 2),
  ];

  it('filters, sorts, offsets and limits consistently', () => {
    expect(applyQuery(rows, { where: [{ field: 'strategy', op: 'eq', value: 'sniper' }] })).toHaveLength(2);
    expect(applyQuery(rows, { where: [{ field: 'pnl', op: 'gt', value: 0 }] })).toHaveLength(2);
    expect(applyQuery(rows, { orderBy: { field: 'pnl', dir: 'desc' } })[0].pnl).toBe(300);
    expect(applyQuery(rows, { limit: 1, offset: 1 })[0].id).toBe('trd_1');
    expect(applyQuery(rows, { where: [{ field: 'strategy', op: 'in', value: ['momentum'] }] })).toHaveLength(1);
  });
});

describe('MemoryDriver', () => {
  it('stores copies rather than references', async () => {
    const driver = new MemoryDriver();
    await driver.init();
    const row = tradeRow({}, 0);
    await driver.insert('trades', row);
    (row as { pnl: number }).pnl = 99_999;
    const stored = await driver.get<TradeRow>('trades', row.id);
    expect(stored?.pnl).toBe(100);
  });

  it('updates, counts and deletes by predicate', async () => {
    const driver = new MemoryDriver();
    await driver.init();
    await driver.insertMany('trades', [tradeRow({ pnl: 10 }, 0), tradeRow({ pnl: -10 }, 1)]);

    expect(await driver.count('trades')).toBe(2);
    expect(await driver.count('trades', { where: [{ field: 'pnl', op: 'gt', value: 0 }] })).toBe(1);
    expect(await driver.update<TradeRow>('trades', 'trd_0', { pnl: 55 })).toBe(true);
    expect((await driver.get<TradeRow>('trades', 'trd_0'))?.pnl).toBe(55);
    expect(await driver.deleteWhere('trades', { where: [{ field: 'pnl', op: 'lt', value: 0 }] })).toBe(1);
    expect(await driver.count('trades')).toBe(1);
  });
});

describe('FileDriver', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bot-db-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('survives a restart', async () => {
    const path = join(directory, 'bot.db');
    const first = new FileDriver(path, 10);
    await first.init();
    await first.insert('trades', tradeRow({ pnl: 42 }, 0));
    await first.flush();
    await first.close();

    const second = new FileDriver(path, 10);
    await second.init();
    const restored = await second.get<TradeRow>('trades', 'trd_0');
    expect(restored?.pnl).toBe(42);
    await second.close();
  });
});

describe('Database repositories', () => {
  let database: Database;

  beforeEach(async () => {
    database = new Database(new MemoryDriver(), { ...dbConfig, driver: 'memory' }, createNullLogger());
    await database.start();
  });

  afterEach(async () => {
    await database.stop();
  });

  it('records trades and computes a losing streak', async () => {
    await database.trades.record({
      ...tradeRow({ pnl: 50 }, 0),
      chain: 'solana',
      positionId: 'pos_0',
    } as never);
    for (let i = 1; i <= 3; i++) {
      await database.trades.insert(tradeRow({ pnl: -10 }, i));
    }
    expect(await database.trades.consecutiveLosses()).toBe(3);
  });

  it('round-trips a position through its snapshot', async () => {
    const position = openPosition({ id: 'pos_round' });
    await database.positions.save(position);
    const [restored] = await database.positions.open();
    expect(restored.id).toBe('pos_round');
    expect(restored.takeProfits).toHaveLength(4);
    expect(restored.stopPrice).toBeCloseTo(position.stopPrice, 12);
  });

  it('keeps the first-seen timestamp when a token is re-observed', async () => {
    const profile = healthyProfile();
    await database.tokens.record(profile);
    await database.tokens.record({ ...profile, discoveredAt: profile.discoveredAt + 60_000, updatedAt: TEST_NOW + 60_000 });

    const row = await database.tokens.byId(TokenRepository.rowId(String(profile.ref.chain), profile.ref.address));
    expect(row?.firstSeenAt).toBe(profile.discoveredAt);
    expect(row?.lastSeenAt).toBe(TEST_NOW + 60_000);
  });

  it('stores one metric row per metric of a score', async () => {
    const score = {
      token: healthyProfile().ref,
      total: 85,
      sub: { risk: 90, momentum: 70, liquidity: 80, community: 60, whale: 70, developer: 80 },
      probabilities: { rug: 0.05, pump: 0.5, dump: 0.2 },
      metrics: [
        { id: 'a', group: 'liquidity' as const, raw: 1, normalized: 0.5, weight: 1, imputed: false },
        { id: 'b', group: 'momentum' as const, raw: 2, normalized: 0.7, weight: 1, imputed: true },
      ],
      vetoes: [],
      confidence: 0.9,
      at: TEST_NOW,
    };
    await database.metrics.recordScore(score);
    expect(await database.metrics.count()).toBe(2);
    const averages = await database.metrics.averages(0);
    expect(averages.a).toBeCloseTo(0.5, 6);
  });

  it('aggregates a daily performance row', async () => {
    await database.performance.upsertDay('2024-01-01', { trades: 2, wins: 1, realizedPnl: 25 });
    await database.performance.upsertDay('2024-01-01', { trades: 3, wins: 2 });
    const row = await database.performance.byId('2024-01-01');
    expect(row?.trades).toBe(3);
    // Fields not in the patch are preserved.
    expect(row?.realizedPnl).toBe(25);
  });

  it('down-samples an equity curve for charting', async () => {
    for (let i = 0; i < 1_000; i++) {
      await database.equity.record({
        ts: TEST_NOW + i * 1_000,
        equity: 10_000 + i,
        realizedPnl: i,
        unrealizedPnl: 0,
        openPositions: 1,
        drawdownPct: 0,
      });
    }
    const curve = await database.equity.curve(0, 100);
    expect(curve.length).toBeLessThanOrEqual(101);
    expect(curve[curve.length - 1].equity).toBe(10_999);
  });

  it('prunes rows past the retention window', async () => {
    const old = TEST_NOW - 400 * 24 * 60 * 60_000;
    await database.errors.insert({
      id: 'err_old',
      ts: old,
      code: 'X',
      category: 'internal',
      component: 'test',
      message: 'old',
      retryable: false,
      context: '{}',
    });
    await database.errors.record(new Error('recent'), 'test');

    const removed = await database.runRetention();
    expect(removed.errors).toBe(1);
    expect(await database.errors.count()).toBe(1);
  });

  it('serializes an error with its code and context', async () => {
    await database.errors.record(new Error('kaboom'), 'engine');
    const [row] = await database.errors.recent(1);
    expect(row.message).toBe('kaboom');
    expect(row.component).toBe('engine');
    expect(await database.errors.summarySince(0)).toHaveProperty(row.code);
  });
});

describe('PositionRepository serialization', () => {
  it('preserves take-profit state across a round trip', () => {
    const position = openPosition();
    position.takeProfits[0].executed = true;
    position.takeProfits[0].executedPrice = 0.0015;
    const restored = PositionRepository.fromRow(PositionRepository.toRow(position));
    expect(restored.takeProfits[0].executed).toBe(true);
    expect(restored.takeProfits[0].executedPrice).toBe(0.0015);
  });
});
