import { realizedVolatility, safeDiv } from '../core/utils/math.js';

export interface DrawdownSnapshot {
  readonly equity: number;
  readonly peak: number;
  readonly drawdownPct: number;
  readonly maxDrawdownPct: number;
  readonly dailyDrawdownPct: number;
  readonly volatility: number;
}

/**
 * Equity-curve bookkeeping: peak, current and max drawdown, plus realized
 * volatility of recent equity returns.
 *
 * Daily drawdown is measured from the start-of-day equity rather than from the
 * all-time peak. That matters: a bot down 4% on the day inside a 15% overall
 * drawdown should still be able to trade, while one that has given back 5%
 * today should stop regardless of where the peak is.
 */
export class DrawdownTracker {
  private peak: number;
  private startOfDay: number;
  private currentEquity: number;
  private maxDrawdown = 0;
  private dayKey: string;
  private readonly samples: number[] = [];

  constructor(
    startingEquity: number,
    private readonly sampleWindow = 60,
  ) {
    this.peak = startingEquity;
    this.startOfDay = startingEquity;
    this.currentEquity = startingEquity;
    this.dayKey = dayOf(Date.now());
  }

  update(equity: number, now = Date.now()): DrawdownSnapshot {
    const today = dayOf(now);
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.startOfDay = equity;
    }

    this.currentEquity = equity;
    if (equity > this.peak) this.peak = equity;

    this.samples.push(equity);
    if (this.samples.length > this.sampleWindow) this.samples.shift();

    const drawdownPct = safeDiv(this.peak - equity, this.peak) * 100;
    if (drawdownPct > this.maxDrawdown) this.maxDrawdown = drawdownPct;

    return this.snapshot();
  }

  snapshot(): DrawdownSnapshot {
    return {
      equity: this.currentEquity,
      peak: this.peak,
      drawdownPct: safeDiv(this.peak - this.currentEquity, this.peak) * 100,
      maxDrawdownPct: this.maxDrawdown,
      dailyDrawdownPct: safeDiv(this.startOfDay - this.currentEquity, this.startOfDay) * 100,
      volatility: realizedVolatility(this.samples),
    };
  }

  /** Called when a new trading day begins or after a manual reset. */
  resetDay(equity = this.currentEquity, now = Date.now()): void {
    this.startOfDay = equity;
    this.dayKey = dayOf(now);
  }

  get peakEquity(): number {
    return this.peak;
  }

  get startOfDayEquity(): number {
    return this.startOfDay;
  }
}

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
