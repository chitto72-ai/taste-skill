import type { TokenScore } from './domain/scoring.js';
import type { StrategyContext } from './domain/signal.js';
import type { Position, TokenProfile } from './domain/index.js';
import type { EventBus } from './event-bus.js';
import { toAppError } from './errors.js';
import { ServiceSupervisor, type HealthReport, type Service } from './lifecycle.js';
import { realizedVolatility } from './utils/math.js';
import { PositionManager } from './position-manager.js';
import type { Logger } from '../logger/logger.js';
import type { BotConfig } from '../config/schema.js';
import type { Database } from '../database/database.js';
import type { TokenScanner } from '../discovery/scanner.js';
import type { ExecutionRouter } from '../exchanges/router.js';
import type { RiskManager } from '../risk/risk-manager.js';
import type { StrategyRegistry } from '../strategies/registry.js';
import type { ExitManager } from '../strategies/exits/exit-manager.js';
import type { AnalyticsService } from '../analytics/analytics-service.js';
import type { CopyTradingStrategy } from '../strategies/copy-trading-strategy.js';

export interface TradingEngineOptions {
  readonly config: BotConfig;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly database: Database;
  readonly scanner: TokenScanner;
  readonly strategies: StrategyRegistry;
  readonly risk: RiskManager;
  readonly router: ExecutionRouter;
  readonly exits: ExitManager;
  readonly positions: PositionManager;
  readonly analytics: AnalyticsService;
  /** Every managed service, started in order and stopped in reverse. */
  readonly services: readonly Service[];
  readonly copyTrading?: CopyTradingStrategy;
  readonly monitorIntervalMs?: number;
}

export interface EngineStatus {
  readonly running: boolean;
  readonly mode: string;
  readonly startedAt: number;
  readonly uptimeMs: number;
  readonly openPositions: number;
  readonly equity: number;
  readonly unrealizedPnl: number;
  readonly halted: boolean;
  readonly haltReason?: string;
  readonly signalsEvaluated: number;
  readonly positionsOpened: number;
  readonly entriesRejected: number;
  readonly monitorTicks: number;
}

/**
 * The orchestrator.
 *
 * Two loops, deliberately separate:
 *
 *  - **Entry** is event-driven, reacting to `token.scored` from the scanner.
 *    Entries are opportunistic and can afford to wait for the next scan.
 *  - **Exit** runs on its own fast timer over open positions. It must not
 *    share a cadence with discovery, because a slow enrichment pass would
 *    otherwise delay every stop in the book. This separation is the single
 *    most important structural decision in the engine.
 *
 * Exits are also never gated by the risk halt: a halt blocks new entries and
 * leaves position management fully operational.
 */
export class TradingEngine {
  readonly name = 'engine';

  private readonly supervisor: ServiceSupervisor;
  private readonly logger: Logger;
  private monitorTimer: NodeJS.Timeout | undefined;
  private subscriptions: (() => void)[] = [];
  private running = false;
  private startedAt = 0;
  private monitoring = false;

  private stats = {
    signalsEvaluated: 0,
    positionsOpened: 0,
    entriesRejected: 0,
    monitorTicks: 0,
    exitsExecuted: 0,
  };

  constructor(private readonly options: TradingEngineOptions) {
    this.logger = options.logger.child(this.name);
    this.supervisor = new ServiceSupervisor(options.services, this.logger);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.startedAt = Date.now();

    await this.supervisor.startAll();
    const restored = await this.options.positions.restore();
    if (restored.length > 0) {
      this.logger.warn({ count: restored.length }, 'managing positions restored from the previous session');
    }

    this.subscriptions.push(
      this.options.events.on('token.scored', ({ profile, score }) => {
        void this.onScoredToken(profile, score);
      }).unsubscribe,
      this.options.events.on('wallet.activity', ({ activity }) => {
        this.options.copyTrading?.observe(activity);
      }).unsubscribe,
      this.options.events.on('error.occurred', ({ error, component }) => {
        void this.options.database.errors.record(error, component).catch(() => undefined);
      }).unsubscribe,
    );

    const interval = this.options.monitorIntervalMs ?? 2_000;
    this.monitorTimer = setInterval(() => void this.monitor(), interval);
    this.monitorTimer.unref?.();

    this.running = true;
    this.options.events.emit('engine.started', { mode: this.options.config.mode, at: this.startedAt });
    this.logger.info(
      {
        mode: this.options.config.mode,
        chains: this.options.config.enabledChains,
        strategies: this.options.strategies.names(),
        venues: this.options.router.venues,
        monitorIntervalMs: interval,
      },
      'trading engine started',
    );
  }

  async stop(reason = 'shutdown'): Promise<void> {
    if (!this.running) return;
    this.options.events.emit('engine.stopping', { reason, at: Date.now() });
    this.running = false;

    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
    for (const off of this.subscriptions) off();
    this.subscriptions = [];

    // Run one final exit pass so anything already triggered is not stranded.
    await this.monitor().catch(() => undefined);
    await this.supervisor.stopAll();

    this.options.events.emit('engine.stopped', { at: Date.now() });
    this.logger.info({ ...this.stats, reason }, 'trading engine stopped');
  }

  status(): EngineStatus {
    const risk = this.options.risk.state();
    return {
      running: this.running,
      mode: this.options.config.mode,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt === 0 ? 0 : Date.now() - this.startedAt,
      openPositions: this.options.positions.openCount,
      equity: risk.equity,
      unrealizedPnl: this.options.positions.totalUnrealized(),
      halted: risk.halted,
      haltReason: risk.haltReason,
      ...this.stats,
    };
  }

  async health(): Promise<HealthReport[]> {
    return this.supervisor.healthAll();
  }

  /** Liquidates everything — used by the API's panic button and by operators. */
  async closeAll(reason: 'manual' | 'risk_halt' = 'manual'): Promise<number> {
    const open = this.options.positions.list().filter((position) => position.status === 'open');
    let closed = 0;
    for (const position of open) {
      const signal = this.options.exits.forceExit(position, reason, `bulk close (${reason})`, Date.now());
      try {
        await this.options.positions.exit(position, signal, this.liquidityOf(position));
        closed++;
      } catch (error) {
        this.logger.error({ position: position.id, err: error }, 'bulk close failed for position');
      }
    }
    this.logger.warn({ closed, requested: open.length, reason }, 'bulk close complete');
    return closed;
  }

  // --- entry path -----------------------------------------------------------

  private async onScoredToken(profile: TokenProfile, score: TokenScore): Promise<void> {
    if (!this.running) return;
    this.stats.signalsEvaluated++;

    try {
      await this.options.database.tokens.record(profile, score);
      await this.options.database.metrics.recordScore(score);

      if (this.options.positions.hasPositionIn(profile)) return;

      const context: StrategyContext = {
        now: Date.now(),
        openPositions: this.options.positions.list(),
        equity: this.options.risk.currentEquity,
        availableCapital: this.availableCapital(),
      };

      const { winner, evaluations } = this.options.strategies.evaluate(profile, score, context);
      for (const evaluation of evaluations) {
        this.options.events.emit('token.evaluated', { evaluation });
      }
      if (!winner?.signal) return;

      const signal = winner.signal;
      const sizing = this.options.risk.size(signal, context.availableCapital, profile.market.liquidityUsd);
      if (sizing.sizeUsd <= 0) {
        this.stats.entriesRejected++;
        this.options.events.emit('risk.rejected', {
          reason: sizing.rationale,
          context: { token: profile.metadata.symbol, cappedBy: sizing.cappedBy },
        });
        return;
      }

      const decision = this.options.risk.canOpen(signal, sizing.sizeUsd);
      if (!decision.allowed) {
        this.stats.entriesRejected++;
        this.options.events.emit('risk.rejected', {
          reason: decision.reason,
          context: { token: profile.metadata.symbol, ...decision.context },
        });
        this.logger.debug({ token: profile.metadata.symbol, reason: decision.reason }, 'entry blocked by risk');
        return;
      }

      this.options.events.emit('signal.entry', { signal });
      this.logger.info(
        {
          token: profile.metadata.symbol,
          strategy: signal.strategy,
          score: score.total,
          size: sizing.sizeUsd,
          sizing: sizing.rationale,
        },
        'entry signal accepted',
      );

      const position = await this.options.positions.open(signal, sizing.sizeUsd);
      if (position) {
        this.stats.positionsOpened++;
        this.options.risk.onPositionOpened(position);
      } else {
        this.stats.entriesRejected++;
      }
    } catch (error) {
      const appError = toAppError(error);
      this.logger.error({ token: profile.metadata.symbol, err: appError }, 'entry pipeline failed');
      this.options.events.emit('error.occurred', { error: appError, component: 'engine.entry' });
    }
  }

  // --- exit path ------------------------------------------------------------

  /** One pass over every open position. Never throws. */
  async monitor(): Promise<void> {
    if (this.monitoring) return;
    this.monitoring = true;
    this.stats.monitorTicks++;

    try {
      const open = this.options.positions.list().filter((position) => position.status === 'open');
      for (const position of open) {
        try {
          await this.monitorPosition(position);
        } catch (error) {
          const appError = toAppError(error);
          this.logger.error({ position: position.id, err: appError }, 'position monitoring failed');
          this.options.events.emit('error.occurred', { error: appError, component: 'engine.monitor' });
        }
      }

      const unrealized = this.options.positions.totalUnrealized();
      this.options.analytics.setUnrealized(unrealized);
      this.options.risk.markToMarket(unrealized);
    } finally {
      this.monitoring = false;
    }
  }

  private async monitorPosition(position: Position): Promise<void> {
    const profile = this.options.scanner.profileOf(position.token);
    const price = profile?.market.priceUsd ?? (await this.options.router.price(position.token));
    if (!price || price <= 0) {
      // No price means no informed decision; the time stop still protects us.
      this.logger.debug({ position: position.id }, 'no price available this tick');
      return;
    }

    this.options.positions.mark(position, price);

    const signal = this.options.exits.evaluate(position, {
      price,
      liquidityUsd: profile?.market.liquidityUsd ?? this.liquidityOf(position),
      volatility: profile ? realizedVolatility(profile.priceHistory.map((p) => p.priceUsd)) : 0.1,
      sellTaxPct: profile?.security.sellTaxPct ?? 0,
      entryLiquidityUsd: this.options.positions.entryLiquidityOf(position.id),
      now: Date.now(),
    });

    if (!signal) {
      await this.options.database.positions.save(position);
      return;
    }

    this.options.events.emit('signal.exit', { signal });
    const before = position.status;
    await this.options.positions.exit(position, signal, profile?.market.liquidityUsd ?? this.liquidityOf(position));
    this.stats.exitsExecuted++;

    if (before !== 'closed' && position.status === 'closed') {
      const trades = await this.options.database.trades.find({
        where: [{ field: 'positionId', op: 'eq', value: position.id }],
        limit: 1,
      });
      const trade = trades[0];
      if (trade) {
        this.options.risk.onPositionClosed(position, {
          ...trade,
          chain: position.chain,
          closeReason: trade.closeReason,
        });
      }
    }
  }

  // --- helpers --------------------------------------------------------------

  /**
   * Capital free for new entries: equity minus what is already deployed.
   * Deliberately conservative — it ignores unrealized gains, so a position
   * that is up 3x does not silently expand the rest of the book's sizing.
   */
  private availableCapital(): number {
    const deployed = this.options.positions
      .list()
      .reduce((acc, position) => acc + position.costBasis, 0);
    return Math.max(0, this.options.risk.currentEquity - deployed);
  }

  private liquidityOf(position: Position): number {
    return this.options.scanner.profileOf(position.token)?.market.liquidityUsd ?? Number(position.meta.entryLiquidityUsd ?? 0);
  }
}
