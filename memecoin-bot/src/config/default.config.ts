import { DEFAULT_RPC_ENDPOINTS, SUPPORTED_CHAIN_IDS } from './chains.config.js';
import { botConfigSchema, chainRuntimeSchema, type BotConfig, type ChainRuntimeConfig } from './schema.js';

/** Chain-specific tuning that differs from the generic schema defaults. */
const CHAIN_OVERRIDES: Record<string, Partial<ChainRuntimeConfig>> = {
  // Solana priority fees are quoted in micro-lamports per compute unit.
  solana: { maxRps: 40, timeoutMs: 6_000, gasMultiplier: 1.5, maxPriorityFee: 3_000_000, maxGasUsdPerTx: 1.5 },
  // L1 gas is the dominant cost; keep the ceiling meaningful.
  ethereum: { maxRps: 12, timeoutMs: 12_000, gasMultiplier: 1.2, maxPriorityFee: 5, maxGasUsdPerTx: 25 },
  base: { maxRps: 25, timeoutMs: 8_000, gasMultiplier: 1.3, maxPriorityFee: 0.05, maxGasUsdPerTx: 1 },
  bsc: { maxRps: 25, timeoutMs: 8_000, gasMultiplier: 1.2, maxPriorityFee: 3, maxGasUsdPerTx: 2 },
  arbitrum: { maxRps: 25, timeoutMs: 8_000, gasMultiplier: 1.2, maxPriorityFee: 0.1, maxGasUsdPerTx: 1.5 },
  hyperliquid: { maxRps: 15, timeoutMs: 8_000, gasMultiplier: 1.3, maxPriorityFee: 1, maxGasUsdPerTx: 2 },
};

export function defaultChainRuntime(chainId: string): ChainRuntimeConfig {
  return chainRuntimeSchema.parse({
    enabled: true,
    rpcUrls: [...(DEFAULT_RPC_ENDPOINTS[chainId] ?? [])],
    ...(CHAIN_OVERRIDES[chainId] ?? {}),
  });
}

/** Fully-populated baseline; every loader path starts from this object. */
export function createDefaultConfig(): BotConfig {
  const chains: Record<string, ChainRuntimeConfig> = {};
  for (const id of SUPPORTED_CHAIN_IDS) chains[id] = defaultChainRuntime(id);
  return botConfigSchema.parse({ chains });
}

/**
 * Mode presets. `live` is deliberately stricter than the defaults: the bar for
 * risking real capital should not be the same as the bar for a dry run.
 */
export const MODE_PRESETS: Record<BotConfig['mode'], Partial<BotConfig>> = {
  paper: {},
  backtest: {
    discovery: { ...botConfigSchema.shape.discovery.parse({}), enabled: false },
    api: { ...botConfigSchema.shape.api.parse({}), enabled: false },
    database: { ...botConfigSchema.shape.database.parse({}), driver: 'memory' },
  },
  live: {
    scoring: { ...botConfigSchema.shape.scoring.parse({}), minScore: 85, maxRugProbability: 0.15 },
    risk: {
      ...botConfigSchema.shape.risk.parse({}),
      riskPerTradePct: 0.5,
      kellyFraction: 0.2,
      maxConcurrentPositions: 5,
    },
  },
};
