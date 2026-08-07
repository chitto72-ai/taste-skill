import type { TokenProfile } from '../core/domain/token.js';
import type { Logger } from '../logger/logger.js';
import type { Database } from '../database/database.js';
import { TokenRepository } from '../database/repositories/token-repository.js';
import type { DeveloperHistory, DeveloperHistorySource } from './enrichment/developer-enricher.js';

interface WalletRecord {
  launched: Set<string>;
  rugged: Set<string>;
  successful: Set<string>;
  firstSeen: number;
}

/**
 * Developer reputation built from the bot's own observations.
 *
 * There is no public "has this wallet rugged before" API, so the bot builds
 * one: every token it has ever scored is attributed to its deployer, and a
 * token whose liquidity later collapsed below a quarter of its launch depth is
 * counted as a rug. That is a heuristic, but it is a heuristic computed from
 * first-hand data, and it improves the longer the bot runs — which is exactly
 * the property you want from a reputation signal.
 */
export class DeveloperHistoryService implements DeveloperHistorySource {
  private readonly index = new Map<string, WalletRecord>();
  private readonly logger: Logger;
  private loadedAt = 0;
  private loading: Promise<void> | undefined;

  constructor(
    private readonly database: Database,
    logger: Logger,
    private readonly refreshMs = 5 * 60_000,
  ) {
    this.logger = logger.child('developer-history');
  }

  async lookup(chain: string, wallet: string): Promise<DeveloperHistory | undefined> {
    await this.ensureLoaded();
    const record = this.index.get(this.key(chain, wallet));
    if (!record) return undefined;
    return {
      wallet,
      walletAgeDays: Math.max(0, (Date.now() - record.firstSeen) / 86_400_000),
      tokensLaunched: record.launched.size,
      ruggedTokens: record.rugged.size,
      successfulTokens: record.successful.size,
    };
  }

  async observe(chain: string, wallet: string, tokenAddress: string, rugged: boolean): Promise<void> {
    if (!wallet) return;
    const key = this.key(chain, wallet);
    const record = this.index.get(key) ?? {
      launched: new Set<string>(),
      rugged: new Set<string>(),
      successful: new Set<string>(),
      firstSeen: Date.now(),
    };
    record.launched.add(tokenAddress);
    if (rugged) record.rugged.add(tokenAddress);
    else record.successful.add(tokenAddress);
    this.index.set(key, record);
  }

  /** Rebuilds the index from the token table. */
  private async ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < this.refreshMs) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const rows = await this.database.tokens.find({ limit: 20_000 });
        this.index.clear();
        for (const row of rows) {
          let profile: TokenProfile;
          try {
            profile = TokenRepository.fromRow(row);
          } catch {
            continue;
          }
          const wallet = profile.developer.wallet;
          if (!wallet) continue;

          const key = this.key(row.chain, wallet);
          const record = this.index.get(key) ?? {
            launched: new Set<string>(),
            rugged: new Set<string>(),
            successful: new Set<string>(),
            firstSeen: row.firstSeenAt,
          };
          record.firstSeen = Math.min(record.firstSeen, row.firstSeenAt);
          record.launched.add(row.address);

          const launchLiquidity = profile.pool.liquidityUsd;
          const rugged =
            profile.security.isHoneypot ||
            (launchLiquidity > 0 && row.liquidityUsd < launchLiquidity * 0.25);
          if (rugged) record.rugged.add(row.address);
          else if (row.lastSeenAt - row.firstSeenAt > 6 * 60 * 60_000) record.successful.add(row.address);

          this.index.set(key, record);
        }
        this.loadedAt = Date.now();
        this.logger.debug({ wallets: this.index.size, tokens: rows.length }, 'developer index rebuilt');
      } catch (error) {
        this.logger.warn({ err: error }, 'failed to rebuild developer index');
      } finally {
        this.loading = undefined;
      }
    })();

    return this.loading;
  }

  private key(chain: string, wallet: string): string {
    return `${chain}:${wallet.toLowerCase()}`;
  }
}
