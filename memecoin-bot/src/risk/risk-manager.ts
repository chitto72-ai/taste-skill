import type { ChainId } from '../core/domain/chain.js';
import type { EntrySignal } from '../core/domain/signal.js';
import type { Position, TradeRecord } from '../core/domain/trading.js';
import type { EventBus } from '../core/event-bus.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import { safeDiv } from '../core/utils/math.js';
import type { Logger } from '../logger/logger.js';
import type { EntryConfig, RiskConfig } from '../config/schema.js';
import { DrawdownTracker } from './drawdown.js';
import { PositionSizer } from './position-sizer.js';
import type { RiskDecision, RiskState, SizingInput, SizingResult } from './types.js';

export interface RiskManagerOptions {
  readonly config: RiskConfig;
  readonly entry: EntryConfig;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly startingEquity?: number;
  readonly now?: () => number;
}

/**
 * The gatekeeper. Nothing opens a position without passing through here.
 *
 * Three circuit breakers, each answering a different failure mode:
 *
 *  - **Consecutive stops** catches a regime the strategy no longer fits — the
 *    signal is still firing, the market has changed underneath it.
 *  - **Daily drawdown** caps the damage of a single bad session, measured from
 *    the day's opening equity rather than the all-time peak.
 *  - **Equity volatility** catches the case both of the above miss: an account
 *    that is not down much yet but has started swinging violently, which
 *    historically precedes the drawdown rather than following it.
 *
 * A halt is time-boxed (`haltCooldownMs`) rather than permanent, and it blocks
 * *entries only*. Exits are never gated by risk state — refusing to sell
 * because the account is in drawdown is how a drawdown becomes a wipeout.
 */
export class RiskManager implements Service {
  readonly name = 'risk-manager';

  private readonly sizer: PositionSizer;
  private readonly drawdown: DrawdownTracker;
  private readonly logger: Logger;
  private readonly now: () => number;

  private equity: number;
  private consecutiveStops = 0;
  private dailyTrades = 0;
  private dailyPnl = 0;
  private dayKey: string;
  private openPositions = 0;
  private exposure = new Map<ChainId, number>();
  private halted = false;
  private haltReason: string | undefined;
  private haltUntil = 0;

  constructor(private readonly options: RiskManagerOptions) {
    this.logger = options.logger.child(this.name);
    this.now = options.now ?? (() => Date.now());
    this.equity = options.startingEquity ?? options.config.baseCapital;
    this.sizer = new PositionSizer(options.config, options.entry);
    this.drawdown = new DrawdownTracker(this.equity);
    this.dayKey = dayOf(this.now());
  }

  async start(): Promise<void> {
    this.logger.info(
      {
        equity: this.equity,
        riskPerTradePct: this.options.config.riskPerTradePct,
        maxPositions: this.options.config.maxConcurrentPositions,
      },
      'risk manager ready',
    );
  }

  async stop(): Promise<void> {
    this.logger.info({ ...this.state() }, 'risk manager stopped');
  }

  /** Full gate for a new entry. */
  canOpen(signal: EntrySignal, positionUsd: number): RiskDecision {
    this.rolloverDay();

    if (this.isHalted()) {
      return deny(`trading halted: ${this.haltReason}`, {
        until: this.haltUntil,
        remainingMs: this.haltUntil - this.now(),
      });
    }
    if (this.openPositions >= this.options.config.maxConcurrentPositions) {
      return deny(`already at the ${this.options.config.maxConcurrentPositions}-position limit`, {
        openPositions: this.openPositions,
      });
    }
    if (this.dailyTrades >= this.options.config.maxDailyTrades) {
      return deny(`daily trade cap of ${this.options.config.maxDailyTrades} reached`, {
        dailyTrades: this.dailyTrades,
      });
    }
    if (positionUsd <= 0) {
      return deny('position sizer returned zero', {});
    }

    const chainExposure = (this.exposure.get(signal.token.chain) ?? 0) + positionUsd;
    const chainLimit = this.equity * this.options.config.maxExposurePerChainPct;
    if (chainExposure > chainLimit) {
      return deny(
        `chain exposure $${chainExposure.toFixed(0)} would exceed the $${chainLimit.toFixed(0)} limit for ${signal.token.chain}`,
        { chain: signal.token.chain, chainExposure, chainLimit },
      );
    }

    const snapshot = this.drawdown.snapshot();
    if (snapshot.dailyDrawdownPct >= this.options.config.maxDailyDrawdownPct) {
      this.halt(`daily drawdown ${snapshot.dailyDrawdownPct.toFixed(2)}% hit the limit`);
      return deny(this.haltReason ?? 'daily drawdown limit', { drawdown: snapshot.dailyDrawdownPct });
    }
    if (snapshot.drawdownPct >= this.options.config.maxTotalDrawdownPct) {
      this.halt(`total drawdown ${snapshot.drawdownPct.toFixed(2)}% hit the limit`);
      return deny(this.haltReason ?? 'total drawdown limit', { drawdown: snapshot.drawdownPct });
    }

    return { allowed: true, reason: 'within all risk limits' };
  }

  /** Kelly-based sizing with the fixed-risk ceiling applied. */
  size(signal: EntrySignal, availableCapital: number, liquidityUsd: number): SizingResult {
    const input: SizingInput = {
      equity: this.equity,
      availableCapital,
      winProbability: signal.expectedWinRate,
      payoffRatio: signal.expectedPayoffRatio,
      stopPct: signal.suggestedStopPct,
      liquidityUsd,
      conviction: signal.conviction,
      openPositions: this.openPositions,
    };
    return this.sizer.size(input);
  }

  onPositionOpened(position: Position): void {
    this.openPositions++;
    this.dailyTrades++;
    const current = this.exposure.get(position.chain) ?? 0;
    this.exposure.set(position.chain, current + position.costBasis);
    this.publish();
  }

  onPositionClosed(position: Position, trade: TradeRecord): void {
    this.openPositions = Math.max(0, this.openPositions - 1);
    const current = this.exposure.get(position.chain) ?? 0;
    this.exposure.set(position.chain, Math.max(0, current - position.initialCost));

    this.dailyPnl += trade.pnl;
    this.equity += trade.pnl;
    this.drawdown.update(this.equity, this.now());

    const stoppedOut =
      trade.closeReason === 'stop_loss' ||
      trade.closeReason === 'trailing_stop' ||
      trade.closeReason === 'emergency_exit';

    if (trade.pnl < 0 && stoppedOut) {
      this.consecutiveStops++;
      if (this.consecutiveStops >= this.options.config.maxConsecutiveStops) {
        this.halt(`${this.consecutiveStops} consecutive stop-outs`);
      }
    } else if (trade.pnl > 0) {
      // Only a winner resets the streak; a flat scratch is not evidence the
      // regime has recovered.
      this.consecutiveStops = 0;
    }

    this.checkVolatility();
    this.publish();
  }

  /** Called on every mark-to-market so drawdown reflects open risk too. */
  markToMarket(unrealizedPnl: number): void {
    this.rolloverDay();
    const snapshot = this.drawdown.update(this.equity + unrealizedPnl, this.now());
    if (
      !this.halted &&
      snapshot.dailyDrawdownPct >= this.options.config.maxDailyDrawdownPct
    ) {
      this.halt(`daily drawdown ${snapshot.dailyDrawdownPct.toFixed(2)}% including open positions`);
    }
  }

  halt(reason: string): void {
    if (this.halted) return;
    this.halted = true;
    this.haltReason = reason;
    this.haltUntil = this.now() + this.options.config.haltCooldownMs;
    this.logger.error({ reason, until: new Date(this.haltUntil).toISOString() }, 'TRADING HALTED');
    this.options.events.emit('risk.halted', { reason, until: this.haltUntil });
  }

  resume(force = false): boolean {
    if (!this.halted) return true;
    if (!force && this.now() < this.haltUntil) return false;
    this.halted = false;
    this.haltReason = undefined;
    this.haltUntil = 0;
    this.consecutiveStops = 0;
    this.drawdown.resetDay(this.equity, this.now());
    this.logger.warn({ forced: force }, 'trading resumed');
    this.options.events.emit('risk.resumed', { at: this.now() });
    return true;
  }

  isHalted(): boolean {
    if (this.halted && this.now() >= this.haltUntil) {
      // Cooldown elapsed: come back with a clean streak but keep the drawdown
      // history, so a second breach halts again immediately.
      this.resume();
    }
    return this.halted;
  }

  state(): RiskState {
    const snapshot = this.drawdown.snapshot();
    return {
      equity: this.equity,
      peakEquity: this.drawdown.peakEquity,
      startOfDayEquity: this.drawdown.startOfDayEquity,
      dailyPnl: this.dailyPnl,
      dailyDrawdownPct: snapshot.dailyDrawdownPct,
      totalDrawdownPct: snapshot.drawdownPct,
      consecutiveStops: this.consecutiveStops,
      openPositions: this.openPositions,
      dailyTrades: this.dailyTrades,
      exposureByChain: Object.fromEntries(this.exposure),
      halted: this.halted,
      haltReason: this.haltReason,
      haltUntil: this.haltUntil || undefined,
      equityVolatility: snapshot.volatility,
    };
  }

  get currentEquity(): number {
    return this.equity;
  }

  /** Used at startup to rehydrate equity from persisted performance. */
  setEquity(equity: number): void {
    this.equity = equity;
    this.drawdown.update(equity, this.now());
  }

  health(): HealthReport {
    const state = this.state();
    return {
      component: this.name,
      healthy: !state.halted,
      detail: state.halted ? `halted: ${state.haltReason}` : 'accepting new positions',
      checkedAt: this.now(),
      metrics: {
        equity: Math.round(state.equity),
        dailyDrawdownPct: Number(state.dailyDrawdownPct.toFixed(2)),
        consecutiveStops: state.consecutiveStops,
        openPositions: state.openPositions,
      },
    };
  }

  private checkVolatility(): void {
    const snapshot = this.drawdown.snapshot();
    if (snapshot.volatility > this.options.config.maxEquityVolatility && this.dailyTrades >= 5) {
      this.halt(
        `equity volatility ${(snapshot.volatility * 100).toFixed(2)}% exceeds the ` +
          `${(this.options.config.maxEquityVolatility * 100).toFixed(2)}% ceiling`,
      );
    }
  }

  private rolloverDay(): void {
    const today = dayOf(this.now());
    if (today === this.dayKey) return;
    this.dayKey = today;
    this.dailyTrades = 0;
    this.dailyPnl = 0;
    this.drawdown.resetDay(this.equity, this.now());
    this.logger.info({ day: today, equity: this.equity }, 'new trading day');
  }

  private publish(): void {
    const snapshot = this.drawdown.snapshot();
    this.options.events.emit('risk.updated', {
      equity: this.equity,
      drawdownPct: snapshot.drawdownPct,
      openPositions: this.openPositions,
    });
  }
}

function deny(reason: string, context: Record<string, unknown>): RiskDecision {
  return { allowed: false, reason, context };
}

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export { safeDiv };
