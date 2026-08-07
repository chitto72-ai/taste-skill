import type { SmartMoneyStats, TokenRef } from '../../core/domain/token.js';
import type { Logger } from '../../logger/logger.js';
import type { Enricher, EnrichmentResult, TokenCandidate } from '../types.js';

export interface SmartMoneyHoldings {
  readonly smartWallets: number;
  readonly whales: number;
  readonly insiders: number;
  readonly kolMentions: number;
}

export interface SmartMoneyFlows {
  readonly smartBuyers: number;
  readonly smartNetUsd: number;
  readonly whaleNetUsd: number;
}

/**
 * Implemented by the wallets module (`WalletTracker`). Kept as an interface so
 * discovery does not depend on wallet internals and can be tested with a stub.
 */
export interface SmartMoneySource {
  holdings(ref: TokenRef): Promise<SmartMoneyHoldings | undefined>;
  flows(ref: TokenRef, windowMs: number): Promise<SmartMoneyFlows | undefined>;
}

/**
 * Who is buying matters more than how much is being bought. A token with
 * $50k of volume from three wallets with a verified history is a different
 * asset from one with $50k from three hundred fresh wallets, and this stage is
 * what tells the scorer which one it is looking at.
 */
export class SmartMoneyEnricher implements Enricher {
  readonly name = 'smart-money';
  readonly slice = 'smartMoney' as const;

  private readonly logger: Logger;

  constructor(
    private readonly source: SmartMoneySource | undefined,
    logger: Logger,
    private readonly windowMs = 5 * 60_000,
  ) {
    this.logger = logger.child('enricher:smart-money');
  }

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    const feed = candidate.smartMoney ?? {};
    const missing: string[] = [];

    let holdings: SmartMoneyHoldings | undefined;
    let flows: SmartMoneyFlows | undefined;

    if (this.source) {
      try {
        [holdings, flows] = await Promise.all([
          this.source.holdings(candidate.ref),
          this.source.flows(candidate.ref, this.windowMs),
        ]);
      } catch (error) {
        this.logger.debug({ token: candidate.ref.address, err: error }, 'smart money lookup failed');
      }
    }

    const stats: Partial<SmartMoneyStats> = {
      smartWalletsHolding: feed.smartWalletsHolding ?? holdings?.smartWallets ?? 0,
      smartWalletsBuying5m: feed.smartWalletsBuying5m ?? flows?.smartBuyers ?? 0,
      smartNetFlowUsd5m: feed.smartNetFlowUsd5m ?? flows?.smartNetUsd ?? 0,
      whalesHolding: feed.whalesHolding ?? holdings?.whales ?? 0,
      whaleNetFlowUsd5m: feed.whaleNetFlowUsd5m ?? flows?.whaleNetUsd ?? 0,
      kolMentions: feed.kolMentions ?? holdings?.kolMentions ?? 0,
      insiderWallets: feed.insiderWallets ?? holdings?.insiders ?? 0,
    };

    if (feed.smartWalletsHolding === undefined && !holdings) missing.push('smartMoney.smartWalletsHolding');
    if (feed.smartWalletsBuying5m === undefined && !flows) missing.push('smartMoney.smartWalletsBuying5m');
    if (feed.whaleNetFlowUsd5m === undefined && !flows) missing.push('smartMoney.whaleNetFlowUsd5m');
    if (feed.kolMentions === undefined && !holdings) missing.push('smartMoney.kolMentions');

    return { smartMoney: stats, missing };
  }
}
