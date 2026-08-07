import type { FastifyInstance } from 'fastify';
import { TokenRepository } from '../database/repositories/token-repository.js';
import { WalletRepository } from '../database/repositories/wallet-repository.js';
import { equityFromSamples, curveStats } from '../analytics/equity-curve.js';
import type { ApiContext } from './context.js';

interface RangeQuery {
  limit?: string;
  since?: string;
  level?: string;
  strategy?: string;
  chain?: string;
}

/**
 * Read endpoints for the dashboard, plus a small set of control endpoints.
 *
 * Control actions are intentionally few and blunt — halt, resume, close all,
 * close one. Anything more expressive belongs in configuration, where it is
 * reviewable, rather than behind an HTTP call made under pressure.
 */
export function registerRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const limitOf = (query: RangeQuery, fallback = 100, max = 1_000): number => {
    const parsed = Number(query.limit ?? fallback);
    return Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), max) : fallback;
  };

  app.get('/health', async () => {
    const reports = await ctx.engine.health();
    const unhealthy = reports.filter((r) => !r.healthy);
    return {
      status: unhealthy.length === 0 ? 'ok' : 'degraded',
      uptimeMs: ctx.engine.status().uptimeMs,
      components: reports,
    };
  });

  app.get('/api/status', async () => ({
    engine: ctx.engine.status(),
    risk: ctx.risk.state(),
    discovery: ctx.scanner.snapshot(),
    config: {
      mode: ctx.config.mode,
      chains: ctx.config.enabledChains,
      minScore: ctx.config.scoring.minScore,
      maxPositions: ctx.config.risk.maxConcurrentPositions,
      riskPerTradePct: ctx.config.risk.riskPerTradePct,
      venue: ctx.config.exchange.primary,
      copyTrading: ctx.config.copyTrading.enabled,
    },
  }));

  app.get('/api/performance', async () => ctx.analytics.snapshot());

  app.get('/api/equity', async (request) => {
    const query = request.query as RangeQuery;
    const since = Number(query.since ?? Date.now() - 24 * 60 * 60_000);
    const rows = await ctx.database.equity.curve(since, 500);
    const points = equityFromSamples(rows);
    return { points, stats: curveStats(points) };
  });

  app.get('/api/positions', async () => {
    const open = ctx.positions.list();
    return {
      open: open.map((position) => ({
        id: position.id,
        symbol: position.symbol,
        chain: position.chain,
        token: position.token.address,
        strategy: position.strategy,
        status: position.status,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        qty: position.qty,
        costBasis: position.costBasis,
        unrealizedPnl: position.unrealizedPnl,
        realizedPnl: position.realizedPnl,
        pnlPct: position.entryPrice > 0 ? (position.currentPrice / position.entryPrice - 1) * 100 : 0,
        stopPrice: position.stopPrice,
        breakEvenArmed: position.breakEvenArmed,
        trailingArmed: position.trailingArmed,
        takeProfits: position.takeProfits,
        openedAt: position.openedAt,
        maxHoldUntil: position.maxHoldUntil,
        entryScore: position.entryScore,
      })),
      count: open.length,
    };
  });

  app.get('/api/trades', async (request) => {
    const query = request.query as RangeQuery;
    const where = [];
    if (query.strategy) where.push({ field: 'strategy', op: 'eq' as const, value: query.strategy });
    if (query.chain) where.push({ field: 'chain', op: 'eq' as const, value: query.chain });
    const trades = await ctx.database.trades.find({
      where: where.length > 0 ? where : undefined,
      orderBy: { field: 'ts', dir: 'desc' },
      limit: limitOf(query, 100),
    });
    return { trades, count: trades.length };
  });

  app.get('/api/tokens', async (request) => {
    const query = request.query as RangeQuery;
    const rows = await ctx.database.tokens.find({
      orderBy: { field: 'lastSeenAt', dir: 'desc' },
      limit: limitOf(query, 50, 500),
    });
    // The stored profile blob is large and the table view never needs it.
    return {
      tokens: rows.map(({ profile: _profile, ...rest }) => rest),
      tracked: ctx.scanner.snapshot().trackedTokens,
    };
  });

  app.get('/api/tokens/:chain/:address', async (request, reply) => {
    const { chain, address } = request.params as { chain: string; address: string };
    const row = await ctx.database.tokens.byId(TokenRepository.rowId(chain, address));
    if (!row) return reply.code(404).send({ error: 'token not found' });
    const score = ctx.scanner.scoreOf({ chain, address });
    return { token: { ...row, profile: JSON.parse(row.profile) }, score };
  });

  app.get('/api/candidates', async () => ({
    candidates: ctx.scanner.candidates().map((entry) => ({
      chain: entry.profile.ref.chain,
      address: entry.profile.ref.address,
      symbol: entry.profile.metadata.symbol,
      score: entry.score.total,
      sub: entry.score.sub,
      probabilities: entry.score.probabilities,
      confidence: entry.score.confidence,
      liquidityUsd: entry.profile.market.liquidityUsd,
      marketCapUsd: entry.profile.market.marketCapUsd,
      holders: entry.profile.holders.count,
    })),
  }));

  app.get('/api/wallets', async () => {
    const rows = await ctx.database.wallets.find({ orderBy: { field: 'pnlUsd', dir: 'desc' }, limit: 200 });
    return {
      wallets: rows.map((row) => ({ ...WalletRepository.fromRow(row), stats: WalletRepository.fromRow(row).stats })),
      copyable: ctx.tracker.copyable().length,
    };
  });

  app.get('/api/risk', async () => ({
    state: ctx.risk.state(),
    limits: {
      riskPerTradePct: ctx.config.risk.riskPerTradePct,
      maxConcurrentPositions: ctx.config.risk.maxConcurrentPositions,
      maxDailyDrawdownPct: ctx.config.risk.maxDailyDrawdownPct,
      maxTotalDrawdownPct: ctx.config.risk.maxTotalDrawdownPct,
      maxConsecutiveStops: ctx.config.risk.maxConsecutiveStops,
      maxEquityVolatility: ctx.config.risk.maxEquityVolatility,
    },
  }));

  app.get('/api/logs', async (request) => {
    const query = request.query as RangeQuery;
    return { logs: ctx.logBuffer.tail(limitOf(query, 100, 500)) };
  });

  app.get('/api/errors', async (request) => {
    const query = request.query as RangeQuery;
    const errors = await ctx.database.errors.recent(limitOf(query, 50, 200));
    return { errors, summary: await ctx.database.errors.summarySince(Date.now() - 24 * 60 * 60_000) };
  });

  app.get('/api/infrastructure', async () => ({
    chains: ctx.chains ? await ctx.chains.detailedHealth() : {},
    events: ctx.events.stats(),
  }));

  // --- control --------------------------------------------------------------

  app.post('/api/control/halt', async (request) => {
    const body = (request.body ?? {}) as { reason?: string };
    ctx.risk.halt(body.reason ?? 'halted from the dashboard');
    return { halted: true, state: ctx.risk.state() };
  });

  app.post('/api/control/resume', async (request) => {
    const body = (request.body ?? {}) as { force?: boolean };
    const resumed = ctx.risk.resume(body.force === true);
    return { resumed, state: ctx.risk.state() };
  });

  app.post('/api/control/close-all', async () => {
    const closed = await ctx.engine.closeAll('manual');
    return { closed };
  });

  app.post('/api/control/close/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const position = ctx.positions.get(id);
    if (!position) return reply.code(404).send({ error: 'position not found' });
    const signal = {
      positionId: id,
      reason: 'manual' as const,
      fraction: 1,
      urgency: 'fast' as const,
      note: 'closed from the dashboard',
      at: Date.now(),
    };
    await ctx.positions.exit(position, signal, Number(position.meta.entryLiquidityUsd ?? 0));
    return { closed: true, status: position.status };
  });
}
