import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, type BuiltApplication } from '../../src/composition-root.js';
import { ApiServer } from '../../src/api/server.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { deepMerge } from '../../src/config/merge.js';
import type { BotConfig } from '../../src/config/schema.js';

const PORT = 8_791;
const TOKEN = 'test-dashboard-token';

function configFor(): BotConfig {
  return deepMerge(createDefaultConfig(), {
    mode: 'paper',
    enabledChains: ['solana'],
    logging: { level: 'silent', persistToDatabase: false },
    database: { driver: 'memory' },
    discovery: { scanIntervalMs: 500, minTokenAgeSeconds: 0 },
    exchange: { paper: { latencyMs: 0, failureRate: 0 } },
    api: { enabled: true, host: '127.0.0.1', port: PORT, token: TOKEN, broadcastIntervalMs: 500 },
  } as never);
}

describe('dashboard API', () => {
  let app: BuiltApplication;
  let api: ApiServer;

  // `null` means "send no Authorization header at all"; omitting the argument
  // uses the valid token.
  const get = (path: string, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    app = await buildApplication(configFor());
    api = new ApiServer({
      config: app.config,
      logger: app.logger,
      events: app.events,
      database: app.database,
      engine: app.engine,
      analytics: app.analytics,
      risk: app.risk,
      positions: app.positions,
      scanner: app.scanner,
      tracker: app.tracker,
      logBuffer: app.logBuffer,
      chains: app.chains,
    });
    await app.engine.start();
    await api.start();
    // Let at least one scan land so the endpoints have something to report.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }, 60_000);

  afterAll(async () => {
    await api.stop().catch(() => undefined);
    await app.engine.stop('test').catch(() => undefined);
    await app.dispose().catch(() => undefined);
  });

  it('serves health without authentication', async () => {
    const response = await get('/health', null);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; components: unknown[] };
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body.components.length).toBeGreaterThan(0);
  });

  it('rejects API calls without the bearer token', async () => {
    expect((await get('/api/status', null)).status).toBe(401);
    expect((await get('/api/status', 'wrong-token')).status).toBe(401);
  });

  it('reports engine, risk and discovery state', async () => {
    const body = (await (await get('/api/status')).json()) as {
      engine: { running: boolean; mode: string };
      risk: { equity: number };
      discovery: { scans: number };
      config: { minScore: number };
    };
    expect(body.engine.running).toBe(true);
    expect(body.engine.mode).toBe('paper');
    expect(body.risk.equity).toBeGreaterThan(0);
    expect(body.discovery.scans).toBeGreaterThan(0);
    expect(body.config.minScore).toBe(80);
  });

  it('returns performance metrics and an equity curve', async () => {
    const performance = (await (await get('/api/performance')).json()) as {
      equity: number;
      metrics: { trades: number };
      curve: unknown[];
    };
    expect(performance.equity).toBeGreaterThan(0);
    expect(performance.metrics.trades).toBeGreaterThanOrEqual(0);

    const equity = (await (await get('/api/equity')).json()) as { points: unknown[]; stats: unknown };
    expect(Array.isArray(equity.points)).toBe(true);
    expect(equity.stats).toBeDefined();
  });

  it('lists positions, trades, tokens and candidates', async () => {
    for (const path of ['/api/positions', '/api/trades', '/api/tokens', '/api/candidates', '/api/wallets']) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(await response.json()).toBeTypeOf('object');
    }
  });

  it('omits the heavy profile blob from the token list', async () => {
    const body = (await (await get('/api/tokens?limit=5')).json()) as { tokens: Record<string, unknown>[] };
    for (const token of body.tokens) expect(token).not.toHaveProperty('profile');
  });

  it('exposes logs and infrastructure detail', async () => {
    const logs = (await (await get('/api/logs?limit=10')).json()) as { logs: unknown[] };
    expect(Array.isArray(logs.logs)).toBe(true);

    const infra = (await (await get('/api/infrastructure')).json()) as { events: { published: number } };
    expect(infra.events.published).toBeGreaterThan(0);
  });

  it('halts and resumes trading through the control endpoints', async () => {
    const halted = await fetch(`http://127.0.0.1:${PORT}/api/control/halt`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'integration test' }),
    });
    expect(halted.status).toBe(200);
    expect(app.risk.state().halted).toBe(true);

    const resumed = await fetch(`http://127.0.0.1:${PORT}/api/control/resume`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    expect(resumed.status).toBe(200);
    expect(app.risk.state().halted).toBe(false);
  });

  it('returns 404 for an unknown position rather than throwing', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/control/close/does-not-exist`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('serves the dashboard itself without a token', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Memecoin Bot');
  });
});
