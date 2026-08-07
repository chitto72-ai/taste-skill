import type { ChainId } from './chain.js';

export type WalletTag = 'smart_money' | 'whale' | 'kol' | 'insider' | 'developer' | 'sniper' | 'bot';

export interface TrackedWallet {
  readonly address: string;
  readonly chain: ChainId;
  readonly label: string;
  readonly tags: readonly WalletTag[];
  readonly stats: WalletStats;
  /** Whether the copy-trading module is allowed to mirror this wallet. */
  copyEnabled: boolean;
  readonly firstSeen: number;
  updatedAt: number;
}

export interface WalletStats {
  readonly trades: number;
  readonly wins: number;
  readonly winRate: number;
  readonly roi: number;
  readonly pnlUsd: number;
  readonly avgHoldMs: number;
  readonly medianPnlPct: number;
  readonly maxDrawdownPct: number;
  readonly walletAgeDays: number;
  readonly lastTradeAt: number;
  /** Share of trades that ended in a token that later rugged, 0..1. */
  readonly rugRate: number;
}

export interface WalletActivity {
  readonly wallet: string;
  readonly chain: ChainId;
  readonly tokenAddress: string;
  readonly side: 'buy' | 'sell';
  readonly amountUsd: number;
  readonly price: number;
  readonly txHash: string;
  readonly at: number;
}

/** A signing account owned by the bot. */
export interface ManagedWallet {
  readonly id: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly family: 'evm' | 'svm';
  readonly label: string;
}
