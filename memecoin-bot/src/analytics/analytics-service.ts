import type { EventBus } from '../core/event-bus.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import { safeDiv } from '../core/utils/math.js';
import type { Logger } from '../logger/logger.js';
import type { Database } from '../database/database.js';
import { utcDay } from '../database/repositories/performance-repository.js';
import type { RiskManager } from '../risk/risk-manager.js';
import { equityFromTrades, curveStats, type EquityPoint } from './equity-curve.js';
import { byChain, byCloseReason, byScoreBucket, byStrategy, computeMetrics, type PerformanceMetrics } from './performance.js';

export interface AnalyticsServiceOptions {
  readonly database: Database;
  readonly events: EventBus;
  readonly risk: RiskManager;
  readonly logger: Logger;
  readonly startingCapital: number;
  /** Equity sampling cadence. */
  readonly sampleIntervalMs?: number;
}

export interface AnalyticsSnapshot {
  readonly equity: number;
  readonly startingCapital: number;
  readonly openPositions: number;
  readonly metrics: PerformanceMetrics;
  readonly today: PerformanceMetrics;
  readonly byStrategy: ReturnType<typeof byStrategy>;
  readonly byChain: ReturnType<typeof byChain>;
  readonly byCloseReason: ReturnType<typeof byCloseReason>;
  readonly byScoreBucket: ReturnType<typeof byScoreBucket>;
  readonly curve: readonly EquityPoint[];
  readonly curveStats: ReturnType<typeof curveStats>;
  readonly generatedAt: number;
}

/**
 * Owns performance reporting and the equity time series.
 *
 * Equity is sampled on a timer *and* on every close, because a curve built
 * only from closes hides intra-position drawdown — which is exactly the risk
 * an operator watching the dashboard needs to see.
 */
export class AnalyticsService implements Service {
  readonly name = 'analytics';

  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void)[] = [];
  private unrealized = 0;

  constructor(private readonly options: AnalyticsServiceOptions) {
    this.logger = options.logger.child(this.name);
  }

  async start(): Promise<void> {
    this.unsubscribe.push(
      this.options.events.on('position.closed', ({ trade }) => {
        void this.onTradeClosed(trade.pnl, trade.fees, trade.gas);
      }).unsubscribe,
      this.options.events.on('risk.updated', ({ equity }) => {
        void this.sample(equity);
      }).unsubscribe,
    );

    const interval = this.options.sampleIntervalMs ?? 30_000;
    this.timer = setInterval(() => void this.sample(), interval);
    this.timer.unref?.();
    this.logger.info({ sampleIntervalMs: interval }, 'analytics ready');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    await this.sample();
  }

  /** Called by the engine on each mark-to-market pass. */
  setUnrealized(unrealizedPnl: number): void {
    this.unrealized = unrealizedPnl;
  }

  async sample(equityOverride?: number): Promise<void> {
    try {
      const state = this.options.risk.state();
      const equity = (equityOverride ?? state.equity) + this.unrealized;
      await this.options.database.equity.record({
        ts: Date.now(),
        equity,
        realizedPnl: state.equity - this.options.startingCapital,
        unrealizedPnl: this.unrealized,
        openPositions: state.openPositions,
        drawdownPct: state.totalDrawdownPct,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'equity sample failed');
    }
  }

  async snapshot(): Promise<AnalyticsSnapshot> {
    const trades = await this.options.database.trades.all();
    const startOfDay = Date.parse(`${utcDay(Date.now())}T00:00:00Z`);
    const todayTrades = trades.filter((trade) => trade.closedAt >= startOfDay);
    const state = this.options.risk.state();
    const curve = equityFromTrades(trades, this.options.startingCapital);

    return {
      equity: state.equity + this.unrealized,
      startingCapital: this.options.startingCapital,
      openPositions: state.openPositions,
      metrics: computeMetrics(trades, this.options.startingCapital),
      today: computeMetrics(todayTrades, this.options.startingCapital),
      byStrategy: byStrategy(trades, this.options.startingCapital),
      byChain: byChain(trades, this.options.startingCapital),
      byCloseReason: byCloseReason(trades, this.options.startingCapital),
      byScoreBucket: byScoreBucket(trades),
      curve,
      curveStats: curveStats(curve),
      generatedAt: Date.now(),
    };
  }

  health(): HealthReport {
    return {
      component: this.name,
      healthy: true,
      detail: 'collecting',
      checkedAt: Date.now(),
      metrics: { unrealized: Number(this.unrealized.toFixed(2)) },
    };
  }

  private async onTradeClosed(pnl: number, fees: number, gas: number): Promise<void> {
    const day = utcDay(Date.now());
    try {
      const existing = await this.options.database.performance.byId(day);
      const trades = (existing?.trades ?? 0) + 1;
      const wins = (existing?.wins ?? 0) + (pnl > 0 ? 1 : 0);
      const losses = (existing?.losses ?? 0) + (pnl <= 0 ? 1 : 0);
      const state = this.options.risk.state();

      await this.options.database.performance.upsertDay(day, {
        equity: state.equity,
        realizedPnl: (existing?.realizedPnl ?? 0) + pnl,
        unrealizedPnl: this.unrealized,
        trades,
        wins,
        losses,
        winRate: safeDiv(wins, trades),
        fees: (existing?.fees ?? 0) + fees,
        gas: (existing?.gas ?? 0) + gas,
        maxDrawdownPct: Math.max(existing?.maxDrawdownPct ?? 0, state.totalDrawdownPct),
        peakEquity: Math.max(existing?.peakEquity ?? 0, state.peakEquity),
      });
      await this.sample();
    } catch (error) {
      this.logger.warn({ err: error }, 'daily performance update failed');
    }
  }
}
