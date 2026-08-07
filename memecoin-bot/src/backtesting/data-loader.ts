import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChainId } from '../core/domain/chain.js';
import { AppError } from '../core/errors.js';
import type { Logger } from '../logger/logger.js';
import type { HistoricalBar, HistoricalSeries } from './types.js';

/**
 * Loads historical token series from disk.
 *
 * The on-disk format is one JSON file per token, which is deliberately simple:
 * exporting from a data provider is then a small script, not an ETL project.
 * Anything missing from a file is filled with conservative defaults so a
 * partial export still produces a usable backtest — with the caveat that
 * missing security data will score as imputed, exactly as it does live.
 */
export class HistoricalDataLoader {
  constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<HistoricalSeries[]> {
    if (!existsSync(this.directory)) {
      throw new AppError(
        `Historical data directory not found: ${this.directory}. ` +
          'Generate a sample dataset with `memecoin-bot generate-data` or point BACKTEST_DATA_DIR at your export.',
        { code: 'BACKTEST_NO_DATA', category: 'config', context: { directory: this.directory } },
      );
    }

    const files = (await readdir(this.directory)).filter((f) => f.endsWith('.json'));
    const series: HistoricalSeries[] = [];

    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Partial<HistoricalSeries>;
        const normalized = normalizeSeries(raw, file);
        if (normalized.bars.length >= 2) series.push(normalized);
        else this.logger.warn({ file }, 'series has fewer than two bars, skipping');
      } catch (error) {
        this.logger.error({ file, err: error }, 'failed to load historical series');
      }
    }

    if (series.length === 0) {
      throw new AppError(`No usable series found in ${this.directory}`, {
        code: 'BACKTEST_NO_DATA',
        category: 'config',
      });
    }

    this.logger.info(
      { series: series.length, bars: series.reduce((acc, s) => acc + s.bars.length, 0) },
      'historical data loaded',
    );
    return series;
  }

  async save(series: readonly HistoricalSeries[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const entry of series) {
      const name = `${entry.chain}-${entry.metadata.symbol}-${entry.address.slice(0, 8)}.json`;
      await writeFile(join(this.directory, name), JSON.stringify(entry, null, 2), 'utf8');
    }
    this.logger.info({ directory: this.directory, series: series.length }, 'historical data written');
  }
}

function normalizeSeries(raw: Partial<HistoricalSeries>, file: string): HistoricalSeries {
  if (!raw.address || !raw.bars) {
    throw new AppError(`Series ${file} is missing "address" or "bars"`, {
      code: 'BACKTEST_BAD_SERIES',
      category: 'validation',
    });
  }

  const bars = [...raw.bars].sort((a, b) => a.t - b.t);
  const first = bars[0];

  return {
    chain: (raw.chain ?? 'solana') as ChainId,
    address: raw.address,
    metadata: {
      name: raw.metadata?.name ?? raw.metadata?.symbol ?? raw.address.slice(0, 8),
      symbol: raw.metadata?.symbol ?? '???',
      decimals: raw.metadata?.decimals ?? 9,
      createdAt: raw.metadata?.createdAt ?? first.t,
      totalSupply: raw.metadata?.totalSupply ?? 1_000_000_000,
      twitter: raw.metadata?.twitter,
      telegram: raw.metadata?.telegram,
    },
    pool: {
      address: raw.pool?.address ?? raw.address,
      dex: raw.pool?.dex ?? 'unknown',
      createdAt: raw.pool?.createdAt ?? first.t,
      lpLockedPct: raw.pool?.lpLockedPct ?? 0,
    },
    security: {
      mintAuthorityRevoked: raw.security?.mintAuthorityRevoked ?? false,
      freezeAuthorityRevoked: raw.security?.freezeAuthorityRevoked ?? false,
      ownershipRenounced: raw.security?.ownershipRenounced ?? false,
      lpLocked: raw.security?.lpLocked ?? (raw.pool?.lpLockedPct ?? 0) >= 0.9,
      lpBurned: raw.security?.lpBurned ?? (raw.pool?.lpLockedPct ?? 0) >= 0.99,
      isHoneypot: raw.security?.isHoneypot ?? false,
      hasTransferTax: raw.security?.hasTransferTax ?? false,
      buyTaxPct: raw.security?.buyTaxPct ?? 0,
      sellTaxPct: raw.security?.sellTaxPct ?? 0,
      hasBlacklistFn: raw.security?.hasBlacklistFn ?? false,
      isProxyUpgradable: raw.security?.isProxyUpgradable ?? false,
      bundleDetected: raw.security?.bundleDetected ?? false,
      bundleWallets: raw.security?.bundleWallets ?? 0,
      onDenyList: false,
    },
    developer: {
      wallet: raw.developer?.wallet ?? '',
      walletAgeDays: raw.developer?.walletAgeDays ?? 0,
      tokensLaunched: raw.developer?.tokensLaunched ?? 0,
      ruggedTokens: raw.developer?.ruggedTokens ?? 0,
      successfulTokens: raw.developer?.successfulTokens ?? 0,
      devSoldPct: raw.developer?.devSoldPct ?? 0,
      devBalancePct: raw.developer?.devBalancePct ?? 0,
    },
    social: {
      twitterFollowers: raw.social?.twitterFollowers ?? 0,
      twitterMentions1h: raw.social?.twitterMentions1h ?? 0,
      twitterGrowth1h: raw.social?.twitterGrowth1h ?? 0,
      telegramMembers: raw.social?.telegramMembers ?? 0,
      telegramGrowth1h: raw.social?.telegramGrowth1h ?? 0,
      hasVerifiedSocials: raw.social?.hasVerifiedSocials ?? false,
      sentiment: raw.social?.sentiment ?? 0,
    },
    holdersBase: {
      top10Pct: raw.holdersBase?.top10Pct ?? 0.3,
      top25Pct: raw.holdersBase?.top25Pct ?? 0.45,
      concentrationHhi: raw.holdersBase?.concentrationHhi ?? 0.15,
      devHoldingPct: raw.holdersBase?.devHoldingPct ?? 0.02,
      snipersPct: raw.holdersBase?.snipersPct ?? 0.05,
      insidersPct: raw.holdersBase?.insidersPct ?? 0.03,
      bundledPct: raw.holdersBase?.bundledPct ?? 0.02,
    },
    smartMoneyBase: {
      smartWalletsHolding: raw.smartMoneyBase?.smartWalletsHolding ?? 0,
      whalesHolding: raw.smartMoneyBase?.whalesHolding ?? 0,
      kolMentions: raw.smartMoneyBase?.kolMentions ?? 0,
      insiderWallets: raw.smartMoneyBase?.insiderWallets ?? 0,
    },
    bars: bars.map(normalizeBar),
  };
}

function normalizeBar(bar: HistoricalBar): HistoricalBar {
  return {
    t: bar.t,
    priceUsd: bar.priceUsd,
    liquidityUsd: bar.liquidityUsd ?? 0,
    marketCapUsd: bar.marketCapUsd ?? 0,
    volume5mUsd: bar.volume5mUsd ?? 0,
    volume1hUsd: bar.volume1hUsd ?? (bar.volume5mUsd ?? 0) * 12,
    buys5m: bar.buys5m ?? 0,
    sells5m: bar.sells5m ?? 0,
    holders: bar.holders ?? 0,
    smartBuys5m: bar.smartBuys5m,
    smartNetFlowUsd: bar.smartNetFlowUsd,
    whaleNetFlowUsd: bar.whaleNetFlowUsd,
    holderGrowth5m: bar.holderGrowth5m,
  };
}
