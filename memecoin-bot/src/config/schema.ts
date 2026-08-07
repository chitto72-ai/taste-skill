import { z } from 'zod';
import { SUPPORTED_CHAIN_IDS } from './chains.config.js';

const pct = (min: number, max: number) => z.number().min(min).max(max);

export const chainRuntimeSchema = z.object({
  enabled: z.boolean().default(true),
  rpcUrls: z.array(z.string().url()).default([]),
  wsUrls: z.array(z.string()).default([]),
  /** Per-endpoint request budget. */
  maxRps: z.number().positive().default(20),
  timeoutMs: z.number().int().positive().default(8_000),
  maxRetries: z.number().int().min(0).max(10).default(3),
  /** Endpoint is parked after this many consecutive failures. */
  failoverThreshold: z.number().int().positive().default(3),
  healthCheckIntervalMs: z.number().int().positive().default(30_000),
  /** Multiplier applied on top of the network's suggested fee. */
  gasMultiplier: z.number().min(1).max(5).default(1.25),
  maxGasUsdPerTx: z.number().positive().default(5),
  /** Solana: micro-lamports per compute unit ceiling. EVM: gwei ceiling. */
  maxPriorityFee: z.number().positive().default(2_000_000),
});

export const exchangeSchema = z.object({
  /** Venue used for live execution. `paper` simulates fills locally. */
  primary: z.enum(['axiom', 'paper']).default('paper'),
  axiom: z
    .object({
      enabled: z.boolean().default(false),
      restUrl: z.string().url().default('https://api.axiom.trade'),
      wsUrl: z.string().default('wss://api.axiom.trade/ws'),
      apiKey: z.string().default(''),
      apiSecret: z.string().default(''),
      timeoutMs: z.number().int().positive().default(10_000),
      maxRps: z.number().positive().default(8),
      /** Reconnect backoff ceiling for the market-data socket. */
      reconnectMaxMs: z.number().int().positive().default(30_000),
      /** Route through the venue's private/anti-MEV relay when available. */
      privateTx: z.boolean().default(true),
    })
    .default({}),
  paper: z
    .object({
      /** Fixed slippage floor applied to every simulated fill, in bps. */
      baseSlippageBps: z.number().min(0).default(50),
      /** Additional slippage per 1% of pool liquidity consumed, in bps. */
      impactBpsPerPct: z.number().min(0).default(120),
      feeBps: z.number().min(0).default(100),
      gasUsdPerTrade: z.number().min(0).default(0.75),
      latencyMs: z.number().int().min(0).default(400),
      /** Probability a simulated transaction fails outright. */
      failureRate: pct(0, 1).default(0.02),
    })
    .default({}),
});

export const discoverySchema = z.object({
  enabled: z.boolean().default(true),
  scanIntervalMs: z.number().int().min(250).default(3_000),
  /** Parallel enrichment workers. */
  concurrency: z.number().int().positive().default(8),
  maxCandidatesPerScan: z.number().int().positive().default(50),
  minLiquidityUsd: z.number().min(0).default(25_000),
  maxLiquidityUsd: z.number().min(0).default(5_000_000),
  minMarketCapUsd: z.number().min(0).default(30_000),
  maxMarketCapUsd: z.number().min(0).default(20_000_000),
  minHolders: z.number().int().min(0).default(80),
  minVolume5mUsd: z.number().min(0).default(15_000),
  maxTokenAgeMinutes: z.number().int().positive().default(1_440),
  minTokenAgeSeconds: z.number().int().min(0).default(60),
  /** Profiles older than this are dropped from the working set. */
  profileTtlMs: z.number().int().positive().default(15 * 60_000),
  denyListTokens: z.array(z.string()).default([]),
  denyListDevWallets: z.array(z.string()).default([]),
});

export const scoringSchema = z.object({
  minScore: z.number().min(0).max(100).default(80),
  /** Group weights; normalized internally, so relative magnitude is what counts. */
  weights: z
    .object({
      liquidity: z.number().min(0).default(1.0),
      momentum: z.number().min(0).default(1.2),
      holders: z.number().min(0).default(1.0),
      whales: z.number().min(0).default(1.1),
      community: z.number().min(0).default(0.6),
      developer: z.number().min(0).default(0.9),
      security: z.number().min(0).default(1.6),
    })
    .default({}),
  maxRugProbability: pct(0, 1).default(0.2),
  minPumpProbability: pct(0, 1).default(0.35),
  maxDumpProbability: pct(0, 1).default(0.55),
  /** Reject when too many metrics had to be imputed. */
  minConfidence: pct(0, 1).default(0.6),
});

export const entrySchema = z.object({
  requireVolumeGrowth: z.boolean().default(true),
  requireHolderGrowth: z.boolean().default(true),
  requireSmartMoney: z.boolean().default(true),
  requireWhaleBuying: z.boolean().default(true),
  requirePositiveMomentum: z.boolean().default(true),
  minVolumeGrowth5m: z.number().min(0).default(0.25),
  minHolderGrowth5m: z.number().min(0).default(0.05),
  minSmartWalletsBuying: z.number().int().min(0).default(2),
  minWhaleNetFlowUsd: z.number().default(5_000),
  minLiquidityUsd: z.number().min(0).default(25_000),
  maxTop10HolderPct: pct(0, 1).default(0.35),
  maxBundledPct: pct(0, 1).default(0.15),
  maxDevHoldingPct: pct(0, 1).default(0.1),
  maxBuyTaxPct: z.number().min(0).default(5),
  maxSellTaxPct: z.number().min(0).default(5),
  /** Minimum ratio of buys to sells over 5m. */
  minBuySellRatio: z.number().min(0).default(1.4),
  maxSlippageBps: z.number().int().positive().default(300),
  /** Cap on the share of pool liquidity a single entry may consume. */
  maxPoolImpactPct: pct(0, 1).default(0.02),
});

export const riskSchema = z.object({
  baseCapital: z.number().positive().default(10_000),
  riskPerTradePct: z.number().min(0.01).max(10).default(0.5),
  maxConcurrentPositions: z.number().int().positive().default(5),
  maxPositionPctOfEquity: pct(0.001, 1).default(0.15),
  minPositionUsd: z.number().positive().default(20),
  /** Modified-Kelly damping: 1 = full Kelly (never advisable here). */
  kellyFraction: pct(0.01, 1).default(0.25),
  kellyCap: pct(0.01, 1).default(0.1),
  maxConsecutiveStops: z.number().int().positive().default(3),
  maxDailyDrawdownPct: z.number().min(0.1).max(100).default(5),
  maxTotalDrawdownPct: z.number().min(0.1).max(100).default(20),
  /** Realized-volatility ceiling on the equity curve before halting. */
  maxEquityVolatility: z.number().min(0).default(0.08),
  haltCooldownMs: z.number().int().positive().default(60 * 60_000),
  maxExposurePerChainPct: pct(0.01, 1).default(0.5),
  maxDailyTrades: z.number().int().positive().default(60),
  /** Refuse new entries when gas cost exceeds this share of position size. */
  maxGasPctOfPosition: pct(0.001, 1).default(0.05),
});

export const exitSchema = z.object({
  stopLossPct: z.number().min(0.5).max(95).default(25),
  /** Volatility-scaled stop: multiple of realized vol, bounded by stopLossPct. */
  atrStopMultiplier: z.number().min(0.5).default(2.5),
  useDynamicStop: z.boolean().default(true),
  breakEvenTriggerPct: z.number().min(1).default(20),
  breakEvenOffsetPct: z.number().min(0).default(2),
  trailingActivationPct: z.number().min(1).default(35),
  trailingDistancePct: z.number().min(1).default(18),
  /** Final runner trail after all take-profit levels have executed. */
  finalTrailingDistancePct: z.number().min(1).default(30),
  timeStopMs: z.number().int().positive().default(4 * 60 * 60_000),
  /** Close early if the position has not moved beyond this band by half-time. */
  timeStopMinProgressPct: z.number().default(5),
  emergencyLiquidityDropPct: pct(0, 1).default(0.4),
  emergencyPriceDropPct: pct(0, 1).default(0.3),
  emergencySellTaxPct: z.number().min(0).default(20),
  takeProfitLevels: z
    .array(
      z.object({
        triggerMultiple: z.number().min(1.01),
        sellFraction: pct(0.01, 1),
      }),
    )
    .default([
      { triggerMultiple: 1.5, sellFraction: 0.25 },
      { triggerMultiple: 2.0, sellFraction: 0.25 },
      { triggerMultiple: 3.0, sellFraction: 0.25 },
      { triggerMultiple: 5.0, sellFraction: 0.25 },
    ]),
});

export const copyTradingSchema = z.object({
  enabled: z.boolean().default(false),
  minWinRate: pct(0, 1).default(0.7),
  minTrades: z.number().int().min(1).default(300),
  minRoi: z.number().default(0.5),
  minPnlUsd: z.number().default(50_000),
  minWalletAgeDays: z.number().int().min(1).default(90),
  maxRugRate: pct(0, 1).default(0.1),
  /** Fraction of our normal size used when mirroring. */
  sizeMultiplier: pct(0.01, 2).default(0.5),
  maxFollowedWallets: z.number().int().positive().default(25),
  /** Ignore copied entries older than this. */
  maxSignalAgeMs: z.number().int().positive().default(20_000),
  /** Copied tokens still have to clear the scorer, just with a lower bar. */
  minTokenScore: z.number().min(0).max(100).default(65),
  mirrorExits: z.boolean().default(true),
});

export const walletsSchema = z.object({
  keystoreDir: z.string().default('./keystore'),
  passphrase: z.string().default(''),
  /** Keep this much native currency unspent for gas, per chain, in USD. */
  gasReserveUsd: z.number().min(0).default(25),
  /** Refuse to run live if a hot wallet holds more than this. */
  maxHotWalletUsd: z.number().positive().default(50_000),
});

export const databaseSchema = z.object({
  driver: z.enum(['memory', 'file', 'sqlite']).default('file'),
  path: z.string().default('./data/bot.db'),
  /** File driver: snapshot cadence. */
  flushIntervalMs: z.number().int().positive().default(5_000),
  retentionDays: z.number().int().positive().default(90),
  /** Trim metric rows aggressively; they dominate row count. */
  metricRetentionDays: z.number().int().positive().default(14),
});

export const apiSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65_535).default(8_080),
  /** Bearer token; required when binding to a non-loopback host. */
  token: z.string().default(''),
  corsOrigins: z.array(z.string()).default([]),
  /** Dashboard push cadence over the websocket. */
  broadcastIntervalMs: z.number().int().positive().default(2_000),
});

export const backtestSchema = z.object({
  dataDir: z.string().default('./data/historical'),
  startingCapital: z.number().positive().default(10_000),
  /** Simulated fill latency; memecoin entries are latency-dominated. */
  latencyMs: z.number().int().min(0).default(600),
  slippageBps: z.number().min(0).default(80),
  feeBps: z.number().min(0).default(100),
  gasUsdPerTrade: z.number().min(0).default(0.75),
  /** Bar interval of the historical series, in ms. */
  barIntervalMs: z.number().int().positive().default(60_000),
  warmupBars: z.number().int().min(0).default(5),
});

export const loggingSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  format: z.enum(['pretty', 'json']).default('pretty'),
  file: z.string().default(''),
  persistToDatabase: z.boolean().default(true),
  /** Records below this level are never written to the database. */
  databaseMinLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const botConfigSchema = z.object({
  mode: z.enum(['live', 'paper', 'backtest']).default('paper'),
  env: z.enum(['development', 'staging', 'production']).default('development'),
  /** Chains the bot is allowed to trade this run. */
  enabledChains: z
    .array(z.string())
    .default(['solana', 'base', 'bsc'])
    .refine((ids) => ids.every((id) => SUPPORTED_CHAIN_IDS.includes(id)), {
      message: `enabledChains must be a subset of: ${SUPPORTED_CHAIN_IDS.join(', ')}`,
    }),
  chains: z.record(z.string(), chainRuntimeSchema).default({}),
  exchange: exchangeSchema.default({}),
  discovery: discoverySchema.default({}),
  scoring: scoringSchema.default({}),
  entry: entrySchema.default({}),
  risk: riskSchema.default({}),
  exit: exitSchema.default({}),
  copyTrading: copyTradingSchema.default({}),
  wallets: walletsSchema.default({}),
  database: databaseSchema.default({}),
  api: apiSchema.default({}),
  backtest: backtestSchema.default({}),
  logging: loggingSchema.default({}),
});

export type ChainRuntimeConfig = z.infer<typeof chainRuntimeSchema>;
export type ExchangeConfig = z.infer<typeof exchangeSchema>;
export type DiscoveryConfig = z.infer<typeof discoverySchema>;
export type ScoringConfig = z.infer<typeof scoringSchema>;
export type EntryConfig = z.infer<typeof entrySchema>;
export type RiskConfig = z.infer<typeof riskSchema>;
export type ExitConfig = z.infer<typeof exitSchema>;
export type CopyTradingConfig = z.infer<typeof copyTradingSchema>;
export type WalletsConfig = z.infer<typeof walletsSchema>;
export type DatabaseConfig = z.infer<typeof databaseSchema>;
export type ApiConfig = z.infer<typeof apiSchema>;
export type BacktestConfig = z.infer<typeof backtestSchema>;
export type LoggingConfig = z.infer<typeof loggingSchema>;
export type BotConfig = z.infer<typeof botConfigSchema>;
