import type { StorageDriver } from '../driver.js';
import { eq, gte, type EquityPointRow, type PerformanceRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class PerformanceRepository extends BaseRepository<PerformanceRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'performance');
  }

  /** One row per UTC day; the daily-drawdown guard reads today's row. */
  async upsertDay(day: string, patch: Partial<PerformanceRow>): Promise<PerformanceRow> {
    const existing = await this.byId(day);
    const row: PerformanceRow = {
      id: day,
      ts: Date.parse(`${day}T00:00:00Z`),
      day,
      equity: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      fees: 0,
      gas: 0,
      maxDrawdownPct: 0,
      peakEquity: 0,
      ...existing,
      ...patch,
    };
    await this.upsert(row);
    return row;
  }

  async today(): Promise<PerformanceRow | undefined> {
    return this.byId(utcDay(Date.now()));
  }

  async range(fromDay: string, toDay: string): Promise<PerformanceRow[]> {
    const rows = await this.find({ orderBy: { field: 'ts', dir: 'asc' } });
    return rows.filter((row) => row.day >= fromDay && row.day <= toDay);
  }
}

export class EquityRepository extends BaseRepository<EquityPointRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'equity');
  }

  async record(point: Omit<EquityPointRow, 'id'>): Promise<void> {
    await this.insert({ ...point, id: `eq_${point.ts}` });
  }

  async since(timestamp: number, limit = 5_000): Promise<EquityPointRow[]> {
    return this.find({
      where: [gte('ts', timestamp)],
      orderBy: { field: 'ts', dir: 'asc' },
      limit,
    });
  }

  async latest(): Promise<EquityPointRow | undefined> {
    const [row] = await this.find({ orderBy: { field: 'ts', dir: 'desc' }, limit: 1 });
    return row;
  }

  /** Down-samples to at most `points` samples for chart rendering. */
  async curve(sinceTs: number, points = 500): Promise<EquityPointRow[]> {
    const rows = await this.since(sinceTs);
    if (rows.length <= points) return rows;
    const step = Math.ceil(rows.length / points);
    const sampled = rows.filter((_, index) => index % step === 0);
    const last = rows[rows.length - 1];
    if (sampled[sampled.length - 1]?.id !== last.id) sampled.push(last);
    return sampled;
  }

  async peak(sinceTs = 0): Promise<number> {
    const rows = await this.since(sinceTs);
    return rows.reduce((max, row) => Math.max(max, row.equity), 0);
  }

  async atDay(day: string): Promise<EquityPointRow[]> {
    const start = Date.parse(`${day}T00:00:00Z`);
    const end = start + 24 * 60 * 60_000;
    return this.find({
      where: [gte('ts', start), { field: 'ts', op: 'lt', value: end }],
      orderBy: { field: 'ts', dir: 'asc' },
    });
  }

  async countForDay(day: string): Promise<number> {
    return (await this.atDay(day)).length;
  }

  async hasData(): Promise<boolean> {
    return (await this.count({ where: [eq('openPositions', 0)], limit: 1 })) > 0;
  }
}
