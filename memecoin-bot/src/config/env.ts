import type { DeepPartial } from './merge.js';
import type { BotConfig } from './schema.js';

function str(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function num(name: string): number | undefined {
  const raw = str(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Env var ${name} must be numeric, got "${raw}"`);
  return parsed;
}

function bool(name: string): boolean | undefined {
  const raw = str(name)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Env var ${name} must be boolean-ish, got "${raw}"`);
}

function list(name: string): string[] | undefined {
  const raw = str(name);
  if (raw === undefined) return undefined;
  const items = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Drops undefined keys so the merge layer never overwrites defaults with holes. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = compact(value as Record<string, unknown>);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out as Partial<T>;
}

const RPC_ENV_BY_CHAIN: Record<string, string> = {
  solana: 'RPC_SOLANA',
  ethereum: 'RPC_ETHEREUM',
  base: 'RPC_BASE',
  bsc: 'RPC_BSC',
  arbitrum: 'RPC_ARBITRUM',
  hyperliquid: 'RPC_HYPERLIQUID',
};

/**
 * Environment overlay. Env is the highest-priority source because that is what
 * container orchestrators and CI can set; the JSON config file carries the
 * bulk of the tuning.
 */
export function configFromEnv(): DeepPartial<BotConfig> {
  const chains: Record<string, unknown> = {};
  for (const [chainId, envName] of Object.entries(RPC_ENV_BY_CHAIN)) {
    const urls = list(envName);
    if (urls) chains[chainId] = { rpcUrls: urls };
  }

  // NODE_ENV carries values this config does not model ("test", "ci", …).
  // Mapping the unknown ones to development beats refusing to start.
  const nodeEnv = str('NODE_ENV');
  const env = nodeEnv === 'production' || nodeEnv === 'staging' ? nodeEnv : nodeEnv ? 'development' : undefined;

  const axiomEnabled = bool('AXIOM_ENABLED');
  const raw = {
    mode: str('BOT_MODE') as BotConfig['mode'] | undefined,
    env: env as BotConfig['env'] | undefined,
    enabledChains: list('ENABLED_CHAINS'),
    chains: Object.keys(chains).length > 0 ? chains : undefined,
    logging: {
      level: str('LOG_LEVEL') as BotConfig['logging']['level'] | undefined,
      format: str('LOG_FORMAT') as BotConfig['logging']['format'] | undefined,
      file: str('LOG_FILE'),
    },
    exchange: {
      primary: axiomEnabled === true ? ('axiom' as const) : axiomEnabled === false ? ('paper' as const) : undefined,
      axiom: {
        enabled: axiomEnabled,
        restUrl: str('AXIOM_REST_URL'),
        wsUrl: str('AXIOM_WS_URL'),
        apiKey: str('AXIOM_API_KEY'),
        apiSecret: str('AXIOM_API_SECRET'),
        timeoutMs: num('AXIOM_TIMEOUT_MS'),
        maxRps: num('AXIOM_MAX_RPS'),
      },
    },
    discovery: {
      scanIntervalMs: num('SCANNER_INTERVAL_MS'),
      minLiquidityUsd: num('MIN_LIQUIDITY_USD'),
      maxTokenAgeMinutes: num('MAX_TOKEN_AGE_MINUTES'),
    },
    scoring: {
      minScore: num('MIN_TOKEN_SCORE'),
    },
    risk: {
      baseCapital: num('CAPITAL_BASE'),
      riskPerTradePct: num('RISK_PER_TRADE_PCT'),
      maxConcurrentPositions: num('MAX_CONCURRENT_POSITIONS'),
      maxDailyDrawdownPct: num('MAX_DAILY_DRAWDOWN_PCT'),
      maxConsecutiveStops: num('MAX_CONSECUTIVE_STOPS'),
      kellyFraction: num('KELLY_FRACTION'),
    },
    copyTrading: {
      enabled: bool('COPY_TRADING_ENABLED'),
      minWinRate: num('COPY_MIN_WIN_RATE'),
      minTrades: num('COPY_MIN_TRADES'),
      minWalletAgeDays: num('COPY_MIN_WALLET_AGE_DAYS'),
    },
    wallets: {
      keystoreDir: str('KEYSTORE_DIR'),
      passphrase: str('KEYSTORE_PASSPHRASE'),
    },
    database: {
      driver: str('DB_DRIVER') as BotConfig['database']['driver'] | undefined,
      path: str('DB_PATH'),
    },
    api: {
      enabled: bool('API_ENABLED'),
      host: str('API_HOST'),
      port: num('API_PORT'),
      token: str('API_TOKEN'),
      corsOrigins: list('API_CORS_ORIGINS'),
    },
    backtest: {
      dataDir: str('BACKTEST_DATA_DIR'),
      startingCapital: num('BACKTEST_CAPITAL'),
    },
  };

  return compact(raw as Record<string, unknown>) as DeepPartial<BotConfig>;
}
