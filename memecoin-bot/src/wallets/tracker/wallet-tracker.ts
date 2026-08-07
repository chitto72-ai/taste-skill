import type { TokenRef } from '../../core/domain/token.js';
import { tokenKey } from '../../core/domain/token.js';
import type { TrackedWallet, WalletActivity, WalletTag } from '../../core/domain/wallet.js';
import type { EventBus } from '../../core/event-bus.js';
import type { HealthReport, Service } from '../../core/lifecycle.js';
import type { Logger } from '../../logger/logger.js';
import type { CopyTradingConfig } from '../../config/schema.js';
import type { Database } from '../../database/database.js';
import { WalletRepository } from '../../database/repositories/wallet-repository.js';
import type {
  SmartMoneyFlows,
  SmartMoneyHoldings,
  SmartMoneySource,
} from '../../discovery/enrichment/smart-money-enricher.js';

/** Stream of on-chain wallet activity (venue websocket, indexer, mempool). */
export interface WalletActivityFeed {
  readonly name: string;
  poll(): Promise<WalletActivity[]>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface WalletTrackerOptions {
  readonly config: CopyTradingConfig;
  readonly database: Database;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly feeds?: readonly WalletActivityFeed[];
  readonly pollIntervalMs?: number;
  /** Activity older than this is dropped from the in-memory window. */
  readonly activityWindowMs?: number;
}

interface ActivityEntry extends WalletActivity {
  tags: readonly WalletTag[];
}

/**
 * Registry of third-party wallets worth watching, and the source of the
 * "smart money" dimension of the score.
 *
 * Qualification is deliberately strict and multi-factor. Win rate alone is
 * trivially gamed by a wallet that takes many tiny wins and one enormous loss,
 * so a wallet must clear win rate *and* ROI *and* absolute PnL *and* a minimum
 * sample of 300 trades *and* an age floor — and it is disqualified outright if
 * too many of its tokens later rugged, which is the signature of an insider
 * rather than a trader.
 */
export class WalletTracker implements Service, SmartMoneySource {
  readonly name = 'wallet-tracker';

  private readonly wallets = new Map<string, TrackedWallet>();
  private readonly activityByToken = new Map<string, ActivityEntry[]>();
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private readonly activityWindowMs: number;

  constructor(private readonly options: WalletTrackerOptions) {
    this.logger = options.logger.child(this.name);
    this.activityWindowMs = options.activityWindowMs ?? 30 * 60_000;
  }

  async start(): Promise<void> {
    const rows = await this.options.database.wallets.find({ limit: 5_000 });
    for (const row of rows) {
      const wallet = WalletRepository.fromRow(row);
      this.wallets.set(this.key(wallet.chain, wallet.address), wallet);
    }
    this.logger.info({ wallets: this.wallets.size }, 'wallet registry loaded');

    for (const feed of this.options.feeds ?? []) await feed.start?.();
    if ((this.options.feeds ?? []).length > 0) {
      const interval = this.options.pollIntervalMs ?? 5_000;
      this.timer = setInterval(() => void this.pollFeeds(), interval);
      this.timer.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const feed of this.options.feeds ?? []) await feed.stop?.();
  }

  /** Registers or updates a wallet and re-evaluates its copy eligibility. */
  async upsert(wallet: TrackedWallet): Promise<TrackedWallet> {
    const eligible = this.qualifies(wallet);
    const previous = this.wallets.get(this.key(wallet.chain, wallet.address));
    const next: TrackedWallet = { ...wallet, copyEnabled: eligible, updatedAt: Date.now() };

    this.wallets.set(this.key(wallet.chain, wallet.address), next);
    await this.options.database.wallets.save(next);

    if (previous?.copyEnabled !== eligible) {
      const payload = { address: wallet.address, chain: String(wallet.chain), reason: this.explain(wallet) };
      this.options.events.emit(eligible ? 'wallet.promoted' : 'wallet.demoted', payload);
      this.logger.info(payload, eligible ? 'wallet promoted to copy list' : 'wallet removed from copy list');
    }
    return next;
  }

  /**
   * Copy-trading eligibility. Every clause exists because its absence is a
   * known way to get copied into someone else's exit liquidity.
   */
  qualifies(wallet: TrackedWallet): boolean {
    const { config } = this.options;
    const s = wallet.stats;
    return (
      s.trades >= config.minTrades &&
      s.winRate >= config.minWinRate &&
      s.roi >= config.minRoi &&
      s.pnlUsd >= config.minPnlUsd &&
      s.walletAgeDays >= config.minWalletAgeDays &&
      s.rugRate <= config.maxRugRate &&
      !wallet.tags.includes('insider')
    );
  }

  explain(wallet: TrackedWallet): string {
    const { config } = this.options;
    const s = wallet.stats;
    const failures: string[] = [];
    if (s.trades < config.minTrades) failures.push(`${s.trades} trades < ${config.minTrades}`);
    if (s.winRate < config.minWinRate) failures.push(`win rate ${(s.winRate * 100).toFixed(1)}% < ${(config.minWinRate * 100).toFixed(0)}%`);
    if (s.roi < config.minRoi) failures.push(`roi ${(s.roi * 100).toFixed(0)}% < ${(config.minRoi * 100).toFixed(0)}%`);
    if (s.pnlUsd < config.minPnlUsd) failures.push(`pnl $${Math.round(s.pnlUsd)} < $${config.minPnlUsd}`);
    if (s.walletAgeDays < config.minWalletAgeDays) failures.push(`age ${s.walletAgeDays}d < ${config.minWalletAgeDays}d`);
    if (s.rugRate > config.maxRugRate) failures.push(`rug rate ${(s.rugRate * 100).toFixed(0)}% > ${(config.maxRugRate * 100).toFixed(0)}%`);
    if (wallet.tags.includes('insider')) failures.push('tagged as insider');
    return failures.length === 0 ? 'meets every copy-trading criterion' : failures.join('; ');
  }

  /** Wallets currently eligible for mirroring, best PnL first. */
  copyable(): TrackedWallet[] {
    return [...this.wallets.values()]
      .filter((wallet) => wallet.copyEnabled)
      .sort((a, b) => b.stats.pnlUsd - a.stats.pnlUsd)
      .slice(0, this.options.config.maxFollowedWallets);
  }

  get(chain: string, address: string): TrackedWallet | undefined {
    return this.wallets.get(this.key(chain, address));
  }

  size(): number {
    return this.wallets.size;
  }

  /** Ingests one observed trade by a tracked wallet. */
  record(activity: WalletActivity): void {
    const wallet = this.get(String(activity.chain), activity.wallet);
    if (!wallet) return;
    const key = tokenKey({ chain: activity.chain, address: activity.tokenAddress });
    const entries = this.activityByToken.get(key) ?? [];
    entries.push({ ...activity, tags: wallet.tags });
    this.activityByToken.set(key, this.prune(entries));
    this.options.events.emit('wallet.activity', { activity });
  }

  // --- SmartMoneySource -----------------------------------------------------

  async holdings(ref: TokenRef): Promise<SmartMoneyHoldings | undefined> {
    const entries = this.activityByToken.get(tokenKey(ref));
    if (!entries) return undefined;

    const net = new Map<string, { usd: number; tags: readonly WalletTag[] }>();
    for (const entry of entries) {
      const current = net.get(entry.wallet) ?? { usd: 0, tags: entry.tags };
      current.usd += entry.side === 'buy' ? entry.amountUsd : -entry.amountUsd;
      net.set(entry.wallet, current);
    }

    let smartWallets = 0;
    let whales = 0;
    let insiders = 0;
    let kolMentions = 0;
    for (const { usd, tags } of net.values()) {
      if (usd <= 0) continue;
      if (tags.includes('smart_money')) smartWallets++;
      if (tags.includes('whale')) whales++;
      if (tags.includes('insider')) insiders++;
      if (tags.includes('kol')) kolMentions++;
    }
    return { smartWallets, whales, insiders, kolMentions };
  }

  async flows(ref: TokenRef, windowMs: number): Promise<SmartMoneyFlows | undefined> {
    const entries = this.activityByToken.get(tokenKey(ref));
    if (!entries) return undefined;

    const cutoff = Date.now() - windowMs;
    const buyers = new Set<string>();
    let smartNetUsd = 0;
    let whaleNetUsd = 0;

    for (const entry of entries) {
      if (entry.at < cutoff) continue;
      const signed = entry.side === 'buy' ? entry.amountUsd : -entry.amountUsd;
      if (entry.tags.includes('smart_money')) {
        smartNetUsd += signed;
        if (entry.side === 'buy') buyers.add(entry.wallet);
      }
      if (entry.tags.includes('whale')) whaleNetUsd += signed;
    }
    return { smartBuyers: buyers.size, smartNetUsd, whaleNetUsd };
  }

  // --------------------------------------------------------------------------

  health(): HealthReport {
    return {
      component: this.name,
      healthy: true,
      detail: `${this.wallets.size} wallets tracked, ${this.copyable().length} copyable`,
      checkedAt: Date.now(),
      metrics: {
        tracked: this.wallets.size,
        copyable: this.copyable().length,
        tokensWithActivity: this.activityByToken.size,
      },
    };
  }

  private async pollFeeds(): Promise<void> {
    for (const feed of this.options.feeds ?? []) {
      try {
        for (const activity of await feed.poll()) this.record(activity);
      } catch (error) {
        this.logger.warn({ feed: feed.name, err: error }, 'wallet activity poll failed');
      }
    }
    this.sweep();
  }

  private prune(entries: ActivityEntry[]): ActivityEntry[] {
    const cutoff = Date.now() - this.activityWindowMs;
    return entries.filter((entry) => entry.at >= cutoff).slice(-500);
  }

  private sweep(): void {
    for (const [key, entries] of this.activityByToken) {
      const pruned = this.prune(entries);
      if (pruned.length === 0) this.activityByToken.delete(key);
      else this.activityByToken.set(key, pruned);
    }
  }

  private key(chain: string, address: string): string {
    return `${chain}:${address.toLowerCase()}`;
  }
}
