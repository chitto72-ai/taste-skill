import type { Position } from '../../core/domain/trading.js';
import type { StorageDriver } from '../driver.js';
import { eq, inList, type PositionRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export class PositionRepository extends BaseRepository<PositionRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'positions');
  }

  static toRow(position: Position): PositionRow {
    return {
      id: position.id,
      ts: position.openedAt,
      chain: String(position.chain),
      tokenAddress: position.token.address,
      symbol: position.symbol,
      strategy: position.strategy,
      status: position.status,
      entryPrice: position.entryPrice,
      qty: position.qty,
      costBasis: position.costBasis,
      realizedPnl: position.realizedPnl,
      unrealizedPnl: position.unrealizedPnl,
      currentPrice: position.currentPrice,
      stopPrice: position.stopPrice,
      openedAt: position.openedAt,
      closedAt: position.closedAt,
      closeReason: position.closeReason,
      // The snapshot is what makes crash recovery exact rather than approximate.
      snapshot: JSON.stringify(position),
    };
  }

  static fromRow(row: PositionRow): Position {
    return JSON.parse(row.snapshot) as Position;
  }

  async save(position: Position): Promise<void> {
    await this.upsert(PositionRepository.toRow(position));
  }

  async open(): Promise<Position[]> {
    const rows = await this.find({
      where: [inList('status', ['opening', 'open', 'closing'])],
      orderBy: { field: 'ts', dir: 'asc' },
    });
    return rows.map(PositionRepository.fromRow);
  }

  async byToken(chain: string, tokenAddress: string): Promise<PositionRow[]> {
    return this.find({ where: [eq('chain', chain), eq('tokenAddress', tokenAddress)] });
  }

  async closedSince(timestamp: number): Promise<PositionRow[]> {
    return this.find({
      where: [
        eq('status', 'closed'),
        { field: 'closedAt', op: 'gte', value: timestamp },
      ],
      orderBy: { field: 'closedAt', dir: 'asc' },
    });
  }
}
