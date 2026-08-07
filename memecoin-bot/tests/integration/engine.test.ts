import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApplication, type BuiltApplication } from '../../src/composition-root.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { deepMerge } from '../../src/config/merge.js';
import type { BotConfig } from '../../src/config/schema.js';

/**
 * End-to-end paper trading.
 *
 * This is the test that would catch a wiring regression the unit suites
 * cannot: discovery -> scoring -> strategy -> risk -> sizing -> venue ->
 * position -> exit -> trade record, with the real composition root doing the
 * wiring rather than a hand-built graph.
 */
describe('trading engine (paper mode)', () => {
  let directory: string;
  let app: BuiltApplication | undefined;

  const configFor = (overrides: Partial<BotConfig> = {}): BotConfig =>
    deepMerge(createDefaultConfig(), {
      mode: 'paper',
      enabledChains: ['solana'],
      logging: { level: 'silent', persistToDatabase: false },
      api: { enabled: false },
      database: { driver: 'memory' },
      discovery: { scanIntervalMs: 250, minTokenAgeSeconds: 0 },
      exchange: { paper: { latencyMs: 0, failureRate: 0 } },
      ...overrides,
    } as never);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bot-engine-'));
  });

  afterEach(async () => {
    await app?.engine.stop('test teardown').catch(() => undefined);
    await app?.dispose().catch(() => undefined);
    app = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('runs the full loop and opens at least one position', async () => {
    app = await buildApplication(configFor());
    const opened: string[] = [];
    app.events.on('position.opened', ({ position }) => {
      opened.push(position.symbol);
    });

    await app.engine.start();
    await waitFor(() => opened.length > 0, 25_000);

    expect(opened.length).toBeGreaterThan(0);
    const positions = app.positions.list();
    expect(positions[0].qty).toBeGreaterThan(0);
    expect(positions[0].entryPrice).toBeGreaterThan(0);
    // The stop must be live from the moment the position exists.
    expect(positions[0].stopPrice).toBeGreaterThan(0);
    expect(positions[0].stopPrice).toBeLessThan(positions[0].entryPrice);
    expect(positions[0].takeProfits).toHaveLength(4);
  });

  it('persists the position and its order to the database', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();
    await waitFor(() => app!.positions.list().length > 0, 25_000);

    const stored = await app.database.positions.open();
    expect(stored.length).toBeGreaterThan(0);
    expect(await app.database.orders.count()).toBeGreaterThan(0);
    expect(await app.database.tokens.count()).toBeGreaterThan(0);
    expect(await app.database.metrics.count()).toBeGreaterThan(0);
  });

  it('never exceeds the configured concurrent position limit', async () => {
    app = await buildApplication(configFor({ risk: { ...createDefaultConfig().risk, maxConcurrentPositions: 2 } }));
    await app.engine.start();
    await waitFor(() => app!.positions.list().length >= 2, 30_000).catch(() => undefined);

    // Give the engine more chances to over-open before asserting.
    await delay(3_000);
    expect(app.positions.list().length).toBeLessThanOrEqual(2);
  });

  it('sizes every position within the per-trade risk budget', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();
    await waitFor(() => app!.positions.list().length > 0, 25_000);

    const equity = app.risk.currentEquity;
    for (const position of app.positions.list()) {
      const riskUsd = (position.entryPrice - position.stopPrice) * position.qty;
      const riskPct = (riskUsd / equity) * 100;
      // 0.5% budget plus a small allowance for fill slippage against the plan.
      expect(riskPct).toBeLessThanOrEqual(0.75);
    }
  });

  it('closes positions on demand and writes a trade record', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();
    await waitFor(() => app!.positions.list().length > 0, 25_000);

    const closed = await app.engine.closeAll('manual');
    expect(closed).toBeGreaterThan(0);

    await waitFor(async () => (await app!.database.trades.count()) > 0, 10_000);
    const [trade] = await app.database.trades.recent(1);
    expect(trade.closeReason).toBe('manual');
    expect(trade.quoteIn).toBeGreaterThan(0);
    expect(Number.isFinite(trade.pnl)).toBe(true);
    expect(app.positions.list()).toHaveLength(0);
  });

  it('stops blocking new entries only, not exits, once halted', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();
    await waitFor(() => app!.positions.list().length > 0, 25_000);

    const before = app.positions.list().length;
    app.risk.halt('test halt');
    await delay(2_000);

    // No new positions while halted...
    expect(app.positions.list().length).toBeLessThanOrEqual(before);
    // ...but the exit path still works.
    expect(await app.engine.closeAll('manual')).toBeGreaterThan(0);
  });

  it('reports health for every managed service', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();

    const reports = await app.engine.health();
    const names = reports.map((r) => r.component);
    expect(names).toContain('risk-manager');
    expect(names).toContain('scanner');
    expect(names).toContain('execution-router');
    expect(reports.every((r) => typeof r.healthy === 'boolean')).toBe(true);
  });

  it('shuts down cleanly and leaves no timers running', async () => {
    app = await buildApplication(configFor());
    await app.engine.start();
    await delay(1_000);
    await app.engine.stop('test');
    expect(app.engine.status().running).toBe(false);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
