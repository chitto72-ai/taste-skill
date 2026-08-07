import { getChain } from './chains.config.js';
import type { BotConfig } from './schema.js';

export interface ConfigIssue {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Cross-field invariants that a per-field schema cannot express. Errors block
 * startup; warnings are logged once and the bot continues.
 *
 * These are the checks that would otherwise be discovered at 3am with capital
 * at risk: a live run with no keystore, take-profit fractions summing past
 * 100%, a stop wider than the position sizer assumes.
 */
export function validateConfig(config: BotConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ severity: 'warning', path, message });

  // --- chains ---------------------------------------------------------------
  if (config.enabledChains.length === 0) error('enabledChains', 'At least one chain must be enabled');
  for (const chainId of config.enabledChains) {
    const runtime = config.chains[chainId];
    if (!runtime) {
      error(`chains.${chainId}`, `Chain "${chainId}" is enabled but has no runtime configuration`);
      continue;
    }
    if (!runtime.enabled) warn(`chains.${chainId}.enabled`, `Chain "${chainId}" is listed in enabledChains but disabled`);
    if (runtime.rpcUrls.length === 0) {
      error(`chains.${chainId}.rpcUrls`, `Chain "${chainId}" has no RPC endpoint configured`);
    } else if (runtime.rpcUrls.length === 1) {
      warn(
        `chains.${chainId}.rpcUrls`,
        `Chain "${chainId}" has a single RPC endpoint — failover is unavailable`,
      );
    }
    // Throws for unknown ids; the schema already restricts the set.
    getChain(chainId);
  }

  // --- take profit ----------------------------------------------------------
  const tpTotal = config.exit.takeProfitLevels.reduce((acc, l) => acc + l.sellFraction, 0);
  if (tpTotal > 1.0000001) {
    error('exit.takeProfitLevels', `Take-profit fractions sum to ${tpTotal.toFixed(3)}, which exceeds 100%`);
  }
  if (tpTotal < 0.999) {
    warn(
      'exit.takeProfitLevels',
      `Take-profit fractions sum to ${tpTotal.toFixed(3)}; the remainder rides the final trailing stop`,
    );
  }
  const multiples = config.exit.takeProfitLevels.map((l) => l.triggerMultiple);
  if (multiples.some((m, i) => i > 0 && m <= multiples[i - 1])) {
    error('exit.takeProfitLevels', 'Take-profit trigger multiples must be strictly increasing');
  }

  // --- exits vs risk --------------------------------------------------------
  if (config.exit.breakEvenTriggerPct >= config.exit.trailingActivationPct) {
    warn(
      'exit.breakEvenTriggerPct',
      'Break-even triggers at or after the trailing stop activates, making it redundant',
    );
  }
  if (config.exit.trailingDistancePct >= config.exit.trailingActivationPct) {
    warn(
      'exit.trailingDistancePct',
      'Trailing distance is wider than its activation threshold; the trail can arm below entry',
    );
  }

  // --- sizing ---------------------------------------------------------------
  const maxTheoretical = config.risk.riskPerTradePct / 100 / (config.exit.stopLossPct / 100);
  if (maxTheoretical > config.risk.maxPositionPctOfEquity) {
    warn(
      'risk.maxPositionPctOfEquity',
      `Risk/stop implies positions up to ${(maxTheoretical * 100).toFixed(1)}% of equity, ` +
        `capped at ${(config.risk.maxPositionPctOfEquity * 100).toFixed(1)}%`,
    );
  }
  if (config.risk.kellyFraction > 0.5) {
    warn('risk.kellyFraction', 'Kelly fractions above 0.5 are aggressive for memecoin edge estimates');
  }
  if (config.risk.maxDailyDrawdownPct >= config.risk.maxTotalDrawdownPct) {
    error('risk.maxDailyDrawdownPct', 'Daily drawdown limit must be below the total drawdown limit');
  }

  // --- live-mode hard requirements -----------------------------------------
  if (config.mode === 'live') {
    if (config.exchange.primary === 'paper') {
      error('exchange.primary', 'Live mode requires a real execution venue, not the paper venue');
    }
    if (config.exchange.primary === 'axiom') {
      if (!config.exchange.axiom.enabled) error('exchange.axiom.enabled', 'Axiom venue selected but not enabled');
      if (!config.exchange.axiom.apiKey) error('exchange.axiom.apiKey', 'Missing Axiom API key');
      if (!config.exchange.axiom.apiSecret) error('exchange.axiom.apiSecret', 'Missing Axiom API secret');
    }
    if (!config.wallets.passphrase) {
      error('wallets.passphrase', 'Live mode requires KEYSTORE_PASSPHRASE to unseal signing keys');
    }
    if (config.database.driver === 'memory') {
      error('database.driver', 'Live mode requires durable storage (file or sqlite)');
    }
  }

  // --- api ------------------------------------------------------------------
  if (config.api.enabled && !LOOPBACK.has(config.api.host) && !config.api.token) {
    error('api.token', 'API_TOKEN is required when the dashboard binds to a non-loopback interface');
  }

  // --- discovery ------------------------------------------------------------
  if (config.discovery.minLiquidityUsd > config.discovery.maxLiquidityUsd) {
    error('discovery.minLiquidityUsd', 'Minimum liquidity exceeds the configured maximum');
  }
  if (config.discovery.minMarketCapUsd > config.discovery.maxMarketCapUsd) {
    error('discovery.minMarketCapUsd', 'Minimum market cap exceeds the configured maximum');
  }
  if (config.entry.minLiquidityUsd < config.discovery.minLiquidityUsd) {
    warn('entry.minLiquidityUsd', 'Entry liquidity floor is below the discovery floor and has no effect');
  }
  if (config.scoring.minScore < 80) {
    warn('scoring.minScore', 'Score threshold below 80 admits materially riskier tokens');
  }

  return issues;
}

export function formatIssues(issues: readonly ConfigIssue[]): string {
  return issues.map((i) => `  [${i.severity}] ${i.path}: ${i.message}`).join('\n');
}
