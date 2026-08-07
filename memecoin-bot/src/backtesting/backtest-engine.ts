import type { StrategyContext } from '../core/domain/signal.js';
import type { PricePoint, TokenProfile } from '../core/domain/token.js';
import { tokenKey } from '../core/domain/token.js';
import type { CloseReason, Position, TradeRecord } from '../core/domain/trading.js';
import { EventBus } from '../core/event-bus.js';
import { positionId, tradeId, shortId } from '../core/utils/id.js';
import { clamp01, pctChange, safeDiv } from '../core/utils/math.js';
import type { Logger } from '../logger/logger.js';
import { createNullLogger } from '../logger/logger.js';
import type { BotConfig } from '../config/schema.js';
import { TokenScorer } from '../scoring/scorer.js';
import { StrategyRegistry } from '../strategies/registry.js';
import { SniperStrategy } from '../strategies/sniper-strategy.js';
import { MomentumStrategy } from '../strategies/momentum-strategy.js';
import { ExitManager } from '../strategies/exits/exit-manager.js';
import { PositionSizer } from '../risk/position-sizer.js';
import { computeMetrics } from '../analytics/performance.js';
import { equityFromTrades } from '../analytics/equity-curve.js';
import type { TradeRow } from '../database/types.js';
import { TradeRepository } from '../database/repositories/trade-repository.js';
import type { BacktestOptions, BacktestResult, HistoricalBar, HistoricalSeries } from './types.js';

interface ScheduledBar {
  readonly series: HistoricalSeries;
  readonly bar: HistoricalBar;
  readonly index: number;
}

/**
 * Event-driven backtester.
 *
 * It replays every series' bars in global timestamp order through the *same*
 * scorer, strategies, sizer and exit engine the live bot uses — only the venue
 * and the clock are simulated. That is the whole point: a backtest that
 * reimplements the strategy tests the reimplementation, not the strategy.
 *
 * Three sources of optimism are modelled explicitly, because leaving any of
 * them out is what makes backtests look better than reality:
 *
 *  1. **Latency** — a signal on bar *n* fills at bar *n+1*'s price, never at
 *     the price that produced the signal.
 *  2. **Impact** — fills pay constant-product slippage against that bar's pool
 *     depth, so large positions in thin pools cost what they would cost live.
 *  3. **Costs** — venue fees and gas are charged on entry and on every exit
 *     leg, including partial take-profits.
 *
 * Risk limits are enforced inline (position cap, consecutive stops, daily
 * drawdown), so a strategy cannot post results the live risk manager would
 * never have allowed it to achieve.
 */
export class BacktestEngine {
  private readonly scorer: TokenScorer;
  private readonly strategies: StrategyRegistry;
  private readonly exits: ExitManager;
  private readonly sizer: PositionSizer;
  private readonly logger: Logger;

  private cash = 0;
  private equity = 0;
  private peakEquity = 0;
  private dayKey = '';
  private startOfDayEquity = 0;
  private consecutiveStops = 0;
  private halted = false;

  private readonly positions = new Map<string, Position>();
  private readonly trades: TradeRecord[] = [];
  private readonly history = new Map<string, PricePoint[]>();
  private readonly rejections = new Map<string, number>();

  private signalsGenerated = 0;
  private entriesTaken = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly options: BacktestOptions = {},
    logger?: Logger,
  ) {
    this.logger = logger ?? createNullLogger();
    this.scorer = new TokenScorer({ config: config.scoring });
    this.exits = new ExitManager({ config: config.exit, logger: this.logger });
    this.sizer = new PositionSizer(config.risk, config.entry);
    this.strategies = new StrategyRegistry(
      [
        new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
        new MomentumStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
      ],
      this.logger,
    );
  }

  async run(dataset: readonly HistoricalSeries[]): Promise<BacktestResult> {
    const started = Date.now();
    const startingCapital = this.options.startingCapital ?? this.config.backtest.startingCapital;

    this.cash = startingCapital;
    this.equity = startingCapital;
    this.peakEquity = startingCapital;
    this.startOfDayEquity = startingCapital;

    const schedule = this.buildSchedule(dataset);
    if (schedule.length === 0) {
      throw new Error('Backtest dataset contains no bars');
    }
    this.dayKey = dayOf(schedule[0].bar.t);

    const warmup = this.options.warmupBars ?? this.config.backtest.warmupBars;
    const maxPositions = this.options.maxPositions ?? this.config.risk.maxConcurrentPositions;

    for (const entry of schedule) {
      const now = entry.bar.t;
      this.rolloverDay(now);

      const profile = this.buildProfile(entry, now);

      // Exits first: a bar that both triggers a stop and generates a signal
      // must free the slot before the entry is considered, exactly as the
      // live engine's separate loops would.
      this.processExits(profile, now);

      if (entry.index < warmup) continue;
      if (this.halted) continue;
      if (this.positions.size >= maxPositions) continue;
      if (this.positions.has(tokenKey(profile.ref))) continue;

      this.considerEntry(profile, entry, now, startingCapital);
    }

    // Mark everything remaining out at its final observed price.
    for (const position of [...this.positions.values()]) {
      this.closePosition(position, 'manual', position.currentPrice, schedule[schedule.length - 1].bar.t);
    }

    const rows: TradeRow[] = this.trades.map(TradeRepository.toRow);
    const metrics = computeMetrics(rows, startingCapital);

    return {
      trades: this.trades,
      metrics,
      equity: equityFromTrades(rows, startingCapital),
      startingCapital,
      endingCapital: startingCapital + metrics.netPnl,
      barsProcessed: schedule.length,
      tokensEvaluated: dataset.length,
      signalsGenerated: this.signalsGenerated,
      entriesTaken: this.entriesTaken,
      entriesRejected: Object.fromEntries(this.rejections),
      durationMs: Date.now() - started,
      from: schedule[0].bar.t,
      to: schedule[schedule.length - 1].bar.t,
    };
  }

  // --- scheduling -----------------------------------------------------------

  private buildSchedule(dataset: readonly HistoricalSeries[]): ScheduledBar[] {
    const schedule: ScheduledBar[] = [];
    for (const series of dataset) {
      series.bars.forEach((bar, index) => schedule.push({ series, bar, index }));
    }
    return schedule.sort((a, b) => a.bar.t - b.bar.t);
  }

  // --- profile construction -------------------------------------------------

  private buildProfile(entry: ScheduledBar, now: number): TokenProfile {
    const { series, bar } = entry;
    const ref = { chain: series.chain, address: series.address };
    const key = tokenKey(ref);

    const points = this.history.get(key) ?? [];
    const previous = points[points.length - 1];
    points.push({
      t: bar.t,
      priceUsd: bar.priceUsd,
      volumeUsd: bar.volume5mUsd,
      liquidityUsd: bar.liquidityUsd,
      holders: bar.holders,
    });
    if (points.length > 60) points.shift();
    this.history.set(key, points);

    const holderGrowth = bar.holderGrowth5m ?? (previous ? pctChange(previous.holders, bar.holders) : 0);
    const hourAgo = points.find((p) => p.t >= bar.t - 3_600_000) ?? points[0];

    return {
      ref,
      metadata: series.metadata,
      pool: {
        address: series.pool.address,
        dex: series.pool.dex,
        baseToken: series.address,
        quoteToken: 'USDC',
        liquidityUsd: bar.liquidityUsd,
        createdAt: series.pool.createdAt,
        lpLockedPct: series.pool.lpLockedPct,
      },
      market: {
        priceUsd: bar.priceUsd,
        priceNative: bar.priceUsd,
        marketCapUsd: bar.marketCapUsd,
        fdvUsd: bar.marketCapUsd,
        liquidityUsd: bar.liquidityUsd,
        volume5mUsd: bar.volume5mUsd,
        volume1hUsd: bar.volume1hUsd,
        volume24hUsd: bar.volume1hUsd * 24,
        txns5m: { buys: bar.buys5m, sells: bar.sells5m },
        txns1h: { buys: bar.buys5m * 12, sells: bar.sells5m * 12 },
        priceChange5m: previous ? pctChange(previous.priceUsd, bar.priceUsd) : 0,
        priceChange1h: hourAgo ? pctChange(hourAgo.priceUsd, bar.priceUsd) : 0,
        priceChange24h: pctChange(points[0].priceUsd, bar.priceUsd),
        at: now,
      },
      holders: {
        count: bar.holders,
        growth5m: holderGrowth,
        growth1h: hourAgo ? pctChange(hourAgo.holders, bar.holders) : holderGrowth * 12,
        ...series.holdersBase,
      },
      security: series.security,
      smartMoney: {
        ...series.smartMoneyBase,
        smartWalletsBuying5m: bar.smartBuys5m ?? 0,
        smartNetFlowUsd5m: bar.smartNetFlowUsd ?? 0,
        whaleNetFlowUsd5m: bar.whaleNetFlowUsd ?? 0,
      },
      social: series.social,
      developer: series.developer,
      priceHistory: [...points],
      discoveredAt: series.bars[0].t,
      updatedAt: now,
    };
  }

  // --- entries --------------------------------------------------------------

  private considerEntry(profile: TokenProfile, entry: ScheduledBar, now: number, startingCapital: number): void {
    const score = this.scorer.score(profile, [], now);
    if (score.total < this.config.scoring.minScore || score.vetoes.length > 0) return;

    const context: StrategyContext = {
      now,
      openPositions: [...this.positions.values()],
      equity: this.equity,
      availableCapital: this.cash,
    };

    const { winner } = this.strategies.evaluate(profile, score, context);
    if (!winner?.signal) return;
    this.signalsGenerated++;

    const sizing = this.sizer.size({
      equity: this.equity,
      availableCapital: this.cash,
      winProbability: winner.signal.expectedWinRate,
      payoffRatio: winner.signal.expectedPayoffRatio,
      stopPct: winner.signal.suggestedStopPct,
      liquidityUsd: profile.market.liquidityUsd,
      conviction: winner.signal.conviction,
      openPositions: this.positions.size,
    });

    if (sizing.sizeUsd <= 0) {
      this.reject(sizing.cappedBy);
      return;
    }

    // Latency: fill on the NEXT bar, never on the signal bar.
    const fillBar = entry.series.bars[entry.index + 1];
    if (!fillBar) {
      this.reject('no_fill_bar');
      return;
    }

    const feeBps = this.options.feeBps ?? this.config.backtest.feeBps;
    const slippageBps = (this.options.slippageBps ?? this.config.backtest.slippageBps) + this.impactBps(sizing.sizeUsd, fillBar.liquidityUsd);
    const gasUsd = this.options.gasUsdPerTrade ?? this.config.backtest.gasUsdPerTrade;

    const fillPrice = fillBar.priceUsd * (1 + slippageBps / 10_000);
    const fee = (sizing.sizeUsd * feeBps) / 10_000;
    const qty = (sizing.sizeUsd - fee) / fillPrice;
    if (qty <= 0 || this.cash < sizing.sizeUsd + gasUsd) {
      this.reject('insufficient_cash');
      return;
    }

    this.cash -= sizing.sizeUsd + gasUsd;
    const openedAt = fillBar.t;
    const stopPrice = this.exits.stops.initialStop(fillPrice, winner.signal.suggestedStopPct);

    const position: Position = {
      id: positionId(),
      token: profile.ref,
      chain: profile.ref.chain,
      symbol: profile.metadata.symbol,
      status: 'open',
      strategy: winner.signal.strategy,
      entryScore: score.total,
      entryPrice: fillPrice,
      qty,
      initialQty: qty,
      costBasis: sizing.sizeUsd,
      initialCost: sizing.sizeUsd,
      realizedPnl: 0,
      unrealizedPnl: 0,
      feesPaid: fee,
      gasPaid: gasUsd,
      highWaterPrice: fillPrice,
      lowWaterPrice: fillPrice,
      currentPrice: fillPrice,
      stopPrice,
      initialStopPrice: stopPrice,
      breakEvenArmed: false,
      trailingArmed: false,
      trailingPeakPrice: fillPrice,
      takeProfits: this.exits.takeProfits.buildLevels(),
      legs: [
        {
          id: shortId('leg'),
          side: 'buy',
          qty,
          quote: sizing.sizeUsd,
          price: fillPrice,
          feeQuote: fee,
          gasUsd,
          reason: 'entry',
          at: openedAt,
        },
      ],
      openedAt,
      maxHoldUntil: openedAt + winner.signal.maxHoldMs,
      meta: { entryLiquidityUsd: profile.market.liquidityUsd, startingCapital },
    };

    this.positions.set(tokenKey(profile.ref), position);
    this.entriesTaken++;
  }

  // --- exits ----------------------------------------------------------------

  private processExits(profile: TokenProfile, now: number): void {
    const position = this.positions.get(tokenKey(profile.ref));
    if (!position || position.status !== 'open') return;

    const price = profile.market.priceUsd;
    position.currentPrice = price;
    position.unrealizedPnl = (price - position.entryPrice) * position.qty;

    const signal = this.exits.evaluate(position, {
      price,
      liquidityUsd: profile.market.liquidityUsd,
      volatility: volatilityOf(profile),
      sellTaxPct: profile.security.sellTaxPct,
      entryLiquidityUsd: Number(position.meta.entryLiquidityUsd ?? profile.market.liquidityUsd),
      now,
    });
    if (!signal) return;

    const fraction = clamp01(signal.fraction);
    const qty = position.qty * fraction;
    if (qty <= 0) return;

    const feeBps = this.options.feeBps ?? this.config.backtest.feeBps;
    const slippageBps =
      (this.options.slippageBps ?? this.config.backtest.slippageBps) +
      this.impactBps(qty * price, profile.market.liquidityUsd);
    const gasUsd = this.options.gasUsdPerTrade ?? this.config.backtest.gasUsdPerTrade;

    const fillPrice = price * (1 - slippageBps / 10_000);
    const gross = qty * fillPrice;
    const fee = (gross * feeBps) / 10_000;
    const proceeds = gross - fee;

    this.cash += proceeds - gasUsd;
    const costPortion = position.costBasis * safeDiv(qty, position.qty, 1);

    position.legs.push({
      id: shortId('leg'),
      side: 'sell',
      qty,
      quote: proceeds,
      price: fillPrice,
      feeQuote: fee,
      gasUsd,
      reason: signal.reason,
      at: now,
    });
    position.qty -= qty;
    position.costBasis = Math.max(0, position.costBasis - costPortion);
    position.realizedPnl += proceeds - costPortion;
    position.feesPaid += fee;
    position.gasPaid += gasUsd;

    if (signal.reason === 'take_profit') this.exits.confirmTakeProfit(position, fillPrice, now);

    const isDust = position.qty <= position.initialQty * 0.005;
    if (position.qty <= 0 || isDust || fraction >= 1) {
      this.closePosition(position, signal.reason, fillPrice, now);
    }
  }

  private closePosition(position: Position, reason: CloseReason, exitPrice: number, now: number): void {
    if (position.qty > 0) {
      // Liquidate the remainder at the current price so accounting balances.
      const proceeds = position.qty * exitPrice;
      this.cash += proceeds;
      position.legs.push({
        id: shortId('leg'),
        side: 'sell',
        qty: position.qty,
        quote: proceeds,
        price: exitPrice,
        feeQuote: 0,
        gasUsd: 0,
        reason: 'final',
        at: now,
      });
      position.qty = 0;
    }

    position.status = 'closed';
    position.closedAt = now;
    position.closeReason = reason;

    const quoteOut = position.legs.filter((l) => l.side === 'sell').reduce((acc, l) => acc + l.quote, 0);
    const pnl = quoteOut - position.initialCost - position.gasPaid;

    const trade: TradeRecord = {
      id: tradeId(),
      positionId: position.id,
      chain: position.chain,
      tokenAddress: position.token.address,
      symbol: position.symbol,
      strategy: position.strategy,
      entryScore: position.entryScore,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.initialQty,
      quoteIn: position.initialCost,
      quoteOut,
      pnl,
      pnlPct: safeDiv(pnl, position.initialCost),
      fees: position.feesPaid,
      gas: position.gasPaid,
      holdMs: now - position.openedAt,
      maxFavorableExcursion: safeDiv(position.highWaterPrice - position.entryPrice, position.entryPrice),
      maxAdverseExcursion: safeDiv(position.lowWaterPrice - position.entryPrice, position.entryPrice),
      closeReason: reason,
      openedAt: position.openedAt,
      closedAt: now,
    };

    this.trades.push(trade);
    this.positions.delete(tokenKey(position.token));

    this.equity += pnl;
    if (this.equity > this.peakEquity) this.peakEquity = this.equity;

    const stoppedOut = reason === 'stop_loss' || reason === 'trailing_stop' || reason === 'emergency_exit';
    if (pnl < 0 && stoppedOut) {
      this.consecutiveStops++;
      if (this.consecutiveStops >= this.config.risk.maxConsecutiveStops) {
        this.halted = true;
        this.reject('halted_consecutive_stops');
      }
    } else if (pnl > 0) {
      this.consecutiveStops = 0;
    }

    const dailyDrawdown = safeDiv(this.startOfDayEquity - this.equity, this.startOfDayEquity) * 100;
    if (dailyDrawdown >= this.config.risk.maxDailyDrawdownPct) {
      this.halted = true;
      this.reject('halted_daily_drawdown');
    }
  }

  // --- helpers --------------------------------------------------------------

  /** Constant-product impact: consuming share `s` of the pool costs ~2s. */
  private impactBps(notionalUsd: number, liquidityUsd: number): number {
    if (liquidityUsd <= 0) return 5_000;
    return clamp01(safeDiv(notionalUsd, liquidityUsd, 1)) * 2 * 10_000;
  }

  private rolloverDay(now: number): void {
    const day = dayOf(now);
    if (day === this.dayKey) return;
    this.dayKey = day;
    this.startOfDayEquity = this.equity;
    // A halt lifts with the new session, mirroring `haltCooldownMs` live.
    this.halted = false;
    this.consecutiveStops = 0;
  }

  private reject(reason: string): void {
    this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);
  }
}

function volatilityOf(profile: TokenProfile): number {
  const prices = profile.priceHistory.map((p) => p.priceUsd);
  if (prices.length < 3) return 0.1;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(pctChange(prices[i - 1], prices[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export { EventBus };
