import type { TokenProfile } from '../../core/domain/token.js';
import type { TokenScore } from '../../core/domain/scoring.js';
import type { StorageDriver } from '../driver.js';
import { eq, gte, type MetricRow, type TokenRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export class TokenRepository extends BaseRepository<TokenRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'tokens');
  }

  static rowId(chain: string, address: string): string {
    return `${chain}:${address.toLowerCase()}`;
  }

  static toRow(profile: TokenProfile, score?: TokenScore): TokenRow {
    return {
      id: TokenRepository.rowId(String(profile.ref.chain), profile.ref.address),
      ts: profile.updatedAt,
      chain: String(profile.ref.chain),
      address: profile.ref.address,
      symbol: profile.metadata.symbol,
      name: profile.metadata.name,
      poolAddress: profile.pool.address,
      dex: profile.pool.dex,
      firstSeenAt: profile.discoveredAt,
      lastSeenAt: profile.updatedAt,
      score: score?.total ?? 0,
      rugProbability: score?.probabilities.rug ?? 0,
      pumpProbability: score?.probabilities.pump ?? 0,
      liquidityUsd: profile.market.liquidityUsd,
      marketCapUsd: profile.market.marketCapUsd,
      holders: profile.holders.count,
      traded: false,
      profile: JSON.stringify(profile),
    };
  }

  static fromRow(row: TokenRow): TokenProfile {
    return JSON.parse(row.profile) as TokenProfile;
  }

  async record(profile: TokenProfile, score?: TokenScore): Promise<void> {
    const row = TokenRepository.toRow(profile, score);
    const existing = await this.byId(row.id);
    await this.upsert(existing ? { ...row, firstSeenAt: existing.firstSeenAt, traded: existing.traded } : row);
  }

  async markTraded(chain: string, address: string): Promise<void> {
    await this.update(TokenRepository.rowId(chain, address), { traded: true });
  }

  async topScored(minScore: number, limit = 50): Promise<TokenRow[]> {
    return this.find({
      where: [gte('score', minScore)],
      orderBy: { field: 'score', dir: 'desc' },
      limit,
    });
  }

  async seenSince(timestamp: number, limit = 500): Promise<TokenRow[]> {
    return this.find({
      where: [gte('lastSeenAt', timestamp)],
      orderBy: { field: 'lastSeenAt', dir: 'desc' },
      limit,
    });
  }
}

/**
 * Metric history. Every scored token writes one row per metric, which is what
 * makes offline re-weighting possible: the backtester can recompute scores
 * from stored raw values without re-fetching the world.
 */
export class MetricRepository extends BaseRepository<MetricRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'metrics');
  }

  async recordScore(score: TokenScore): Promise<void> {
    const rows: MetricRow[] = score.metrics.map((metric) => ({
      id: `${score.token.chain}:${score.token.address}:${metric.id}:${score.at}`,
      ts: score.at,
      chain: String(score.token.chain),
      tokenAddress: score.token.address,
      metricId: metric.id,
      group: metric.group,
      raw: metric.raw,
      normalized: metric.normalized,
      weight: metric.weight,
      imputed: metric.imputed,
      scoreTotal: score.total,
    }));
    await this.insertMany(rows);
  }

  async forToken(chain: string, tokenAddress: string, limit = 500): Promise<MetricRow[]> {
    return this.find({
      where: [eq('chain', chain), eq('tokenAddress', tokenAddress)],
      orderBy: { field: 'ts', dir: 'desc' },
      limit,
    });
  }

  /** Mean normalized value per metric — used to spot metrics that never vary. */
  async averages(sinceTs: number): Promise<Record<string, number>> {
    const rows = await this.find({ where: [gte('ts', sinceTs)] });
    const totals = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const entry = totals.get(row.metricId) ?? { sum: 0, n: 0 };
      entry.sum += row.normalized;
      entry.n++;
      totals.set(row.metricId, entry);
    }
    return Object.fromEntries([...totals].map(([id, { sum, n }]) => [id, sum / n]));
  }
}
