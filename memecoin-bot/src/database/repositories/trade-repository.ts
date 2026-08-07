import type { TradeRecord } from '../../core/domain/trading.js';
import type { StorageDriver } from '../driver.js';
import { eq, gte, type TradeRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export class TradeRepository extends BaseRepository<TradeRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'trades');
  }

  static toRow(trade: TradeRecord): TradeRow {
    return {
      id: trade.id,
      ts: trade.closedAt,
      positionId: trade.positionId,
      chain: String(trade.chain),
      tokenAddress: trade.tokenAddress,
      symbol: trade.symbol,
      strategy: trade.strategy,
      entryScore: trade.entryScore,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      qty: trade.qty,
      quoteIn: trade.quoteIn,
      quoteOut: trade.quoteOut,
      pnl: trade.pnl,
      pnlPct: trade.pnlPct,
      fees: trade.fees,
      gas: trade.gas,
      holdMs: trade.holdMs,
      maxFavorableExcursion: trade.maxFavorableExcursion,
      maxAdverseExcursion: trade.maxAdverseExcursion,
      closeReason: trade.closeReason,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
    };
  }

  async record(trade: TradeRecord): Promise<void> {
    await this.insert(TradeRepository.toRow(trade));
  }

  async since(timestamp: number): Promise<TradeRow[]> {
    return this.find({ where: [gte('ts', timestamp)], orderBy: { field: 'ts', dir: 'asc' } });
  }

  async byStrategy(strategy: string, limit = 500): Promise<TradeRow[]> {
    return this.find({
      where: [eq('strategy', strategy)],
      orderBy: { field: 'ts', dir: 'desc' },
      limit,
    });
  }

  async byToken(chain: string, tokenAddress: string): Promise<TradeRow[]> {
    return this.find({ where: [eq('chain', chain), eq('tokenAddress', tokenAddress)] });
  }

  /** Ordered oldest-first; the analytics layer replays this to build equity. */
  async all(limit = 10_000): Promise<TradeRow[]> {
    return this.find({ orderBy: { field: 'ts', dir: 'asc' }, limit });
  }

  /** Consecutive losing trades ending at the most recent one. */
  async consecutiveLosses(): Promise<number> {
    const recent = await this.find({ orderBy: { field: 'ts', dir: 'desc' }, limit: 50 });
    let streak = 0;
    for (const trade of recent) {
      if (trade.pnl >= 0) break;
      streak++;
    }
    return streak;
  }
}
