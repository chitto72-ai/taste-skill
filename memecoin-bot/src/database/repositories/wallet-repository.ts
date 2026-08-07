import type { TrackedWallet, WalletTag } from '../../core/domain/wallet.js';
import type { StorageDriver } from '../driver.js';
import { eq, gte, type WalletRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export class WalletRepository extends BaseRepository<WalletRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'wallets');
  }

  static rowId(chain: string, address: string): string {
    return `${chain}:${address.toLowerCase()}`;
  }

  static toRow(wallet: TrackedWallet): WalletRow {
    return {
      id: WalletRepository.rowId(String(wallet.chain), wallet.address),
      ts: wallet.updatedAt,
      address: wallet.address,
      chain: String(wallet.chain),
      label: wallet.label,
      tags: wallet.tags.join(','),
      trades: wallet.stats.trades,
      wins: wallet.stats.wins,
      winRate: wallet.stats.winRate,
      roi: wallet.stats.roi,
      pnlUsd: wallet.stats.pnlUsd,
      walletAgeDays: wallet.stats.walletAgeDays,
      rugRate: wallet.stats.rugRate,
      copyEnabled: wallet.copyEnabled,
      lastTradeAt: wallet.stats.lastTradeAt,
    };
  }

  static fromRow(row: WalletRow): TrackedWallet {
    return {
      address: row.address,
      chain: row.chain,
      label: row.label,
      tags: (row.tags ? row.tags.split(',') : []).filter(Boolean) as WalletTag[],
      copyEnabled: row.copyEnabled,
      firstSeen: row.ts,
      updatedAt: row.ts,
      stats: {
        trades: row.trades,
        wins: row.wins,
        winRate: row.winRate,
        roi: row.roi,
        pnlUsd: row.pnlUsd,
        avgHoldMs: 0,
        medianPnlPct: 0,
        maxDrawdownPct: 0,
        walletAgeDays: row.walletAgeDays,
        lastTradeAt: row.lastTradeAt,
        rugRate: row.rugRate,
      },
    };
  }

  async save(wallet: TrackedWallet): Promise<void> {
    await this.upsert(WalletRepository.toRow(wallet));
  }

  async copyable(): Promise<WalletRow[]> {
    return this.find({
      where: [eq('copyEnabled', true)],
      orderBy: { field: 'pnlUsd', dir: 'desc' },
    });
  }

  async byTag(tag: WalletTag, limit = 200): Promise<WalletRow[]> {
    return this.find({
      where: [{ field: 'tags', op: 'contains', value: tag }],
      orderBy: { field: 'pnlUsd', dir: 'desc' },
      limit,
    });
  }

  async activeSince(timestamp: number): Promise<WalletRow[]> {
    return this.find({ where: [gte('lastTradeAt', timestamp)] });
  }
}
