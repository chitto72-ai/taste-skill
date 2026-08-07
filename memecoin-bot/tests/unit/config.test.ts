import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/index.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { validateConfig } from '../../src/config/validate.js';
import { deepMerge } from '../../src/config/merge.js';
import { configFromEnv } from '../../src/config/env.js';
import { getChain, isSupportedChain, SUPPORTED_CHAIN_IDS } from '../../src/config/chains.config.js';
import { ConfigError } from '../../src/core/errors.js';
import { testConfig } from '../helpers/factories.js';

describe('chain registry', () => {
  it('describes every supported chain fully', () => {
    for (const id of SUPPORTED_CHAIN_IDS) {
      const chain = getChain(id);
      expect(chain.id).toBe(id);
      expect(['evm', 'svm']).toContain(chain.family);
      expect(chain.nativeCurrency.decimals).toBeGreaterThan(0);
      expect(chain.quoteToken.address).toBeTruthy();
      expect(chain.explorerTxUrl).toMatch(/^https:\/\//);
      if (chain.family === 'evm') expect(chain.evmChainId).toBeGreaterThan(0);
    }
  });

  it('rejects unknown chains', () => {
    expect(isSupportedChain('dogechain')).toBe(false);
    expect(() => getChain('dogechain')).toThrow(/Unknown chain/);
  });
});

describe('deepMerge', () => {
  it('replaces arrays instead of concatenating them', () => {
    const merged = deepMerge({ list: [1, 2, 3], nested: { a: 1, b: 2 } }, { list: [9], nested: { b: 5 } });
    expect(merged.list).toEqual([9]);
    expect(merged.nested).toEqual({ a: 1, b: 5 });
  });

  it('ignores undefined overrides', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});

describe('defaults', () => {
  it('produces a fully-populated config with the documented risk limits', () => {
    const config = createDefaultConfig();
    expect(config.risk.riskPerTradePct).toBe(0.5);
    expect(config.risk.maxConcurrentPositions).toBe(5);
    expect(config.risk.maxConsecutiveStops).toBe(3);
    expect(config.risk.maxDailyDrawdownPct).toBe(5);
    expect(config.scoring.minScore).toBe(80);
    expect(config.exit.takeProfitLevels.map((l) => l.sellFraction)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(config.copyTrading.minWinRate).toBe(0.7);
    expect(config.copyTrading.minTrades).toBe(300);
  });

  it('gives every supported chain a runtime block with endpoints', () => {
    const config = createDefaultConfig();
    for (const id of SUPPORTED_CHAIN_IDS) {
      expect(config.chains[id]?.rpcUrls.length).toBeGreaterThan(0);
    }
  });
});

describe('validateConfig', () => {
  it('accepts the defaults with at most warnings', () => {
    const issues = validateConfig(createDefaultConfig());
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects take-profit fractions summing past 100%', () => {
    const config = testConfig({
      exit: {
        takeProfitLevels: [
          { triggerMultiple: 1.5, sellFraction: 0.6 },
          { triggerMultiple: 2, sellFraction: 0.6 },
        ],
      },
    });
    const errors = validateConfig(config).filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('exceeds 100%'))).toBe(true);
  });

  it('rejects non-increasing take-profit triggers', () => {
    const config = testConfig({
      exit: {
        takeProfitLevels: [
          { triggerMultiple: 2, sellFraction: 0.5 },
          { triggerMultiple: 1.5, sellFraction: 0.5 },
        ],
      },
    });
    expect(validateConfig(config).some((i) => i.message.includes('strictly increasing'))).toBe(true);
  });

  it('requires credentials, a keystore and durable storage in live mode', () => {
    const config = testConfig({ mode: 'live', exchange: { primary: 'axiom' } });
    const errors = validateConfig(config).filter((i) => i.severity === 'error');
    const messages = errors.map((e) => e.path);
    expect(messages).toContain('exchange.axiom.apiKey');
    expect(messages).toContain('wallets.passphrase');
  });

  it('refuses the paper venue in live mode', () => {
    const config = testConfig({ mode: 'live', exchange: { primary: 'paper' } });
    expect(validateConfig(config).some((i) => i.path === 'exchange.primary')).toBe(true);
  });

  it('requires an API token when binding beyond loopback', () => {
    const config = testConfig({ api: { enabled: true, host: '0.0.0.0', token: '' } });
    expect(validateConfig(config).some((i) => i.path === 'api.token' && i.severity === 'error')).toBe(true);
  });

  it('rejects a daily drawdown limit at or above the total limit', () => {
    const config = testConfig({ risk: { maxDailyDrawdownPct: 25, maxTotalDrawdownPct: 20 } });
    expect(validateConfig(config).some((i) => i.path === 'risk.maxDailyDrawdownPct')).toBe(true);
  });

  it('warns about a single RPC endpoint', () => {
    const config = testConfig();
    config.chains.solana = { ...config.chains.solana, rpcUrls: ['https://only.example'] };
    const warnings = validateConfig(config).filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('failover'))).toBe(true);
  });
});

describe('loadConfig', () => {
  let directory: string;
  const saved = { ...process.env };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bot-config-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('loads defaults when nothing else is present', () => {
    const { config } = loadConfig({ ignoreEnv: true });
    expect(config.mode).toBe('paper');
    expect(config.scoring.minScore).toBe(80);
  });

  it('applies file, env and explicit overrides in priority order', async () => {
    const path = join(directory, 'config.json');
    await writeFile(path, JSON.stringify({ scoring: { minScore: 70 }, risk: { baseCapital: 5_000 } }));
    process.env.MIN_TOKEN_SCORE = '75';

    const { config } = loadConfig({
      configPath: path,
      overrides: { risk: { baseCapital: 1_234 } },
    });

    // env beats file, explicit overrides beat env
    expect(config.scoring.minScore).toBe(75);
    expect(config.risk.baseCapital).toBe(1_234);
  });

  it('applies the backtest mode preset', () => {
    const { config } = loadConfig({ ignoreEnv: true, overrides: { mode: 'backtest' } });
    expect(config.discovery.enabled).toBe(false);
    expect(config.api.enabled).toBe(false);
    expect(config.database.driver).toBe('memory');
  });

  it('throws with a readable message on an invalid config', () => {
    expect(() => loadConfig({ ignoreEnv: true, overrides: { enabledChains: ['not-a-chain'] } })).toThrow(ConfigError);
  });

  it('throws when a named config file is missing', () => {
    expect(() => loadConfig({ ignoreEnv: true, configPath: join(directory, 'nope.json') })).toThrow(/not found/);
  });
});

describe('configFromEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('parses numbers, booleans and lists', () => {
    process.env.CAPITAL_BASE = '25000';
    process.env.COPY_TRADING_ENABLED = 'true';
    process.env.ENABLED_CHAINS = 'solana, base';
    process.env.RPC_SOLANA = 'https://a.example,https://b.example';

    const overlay = configFromEnv();
    expect(overlay.risk?.baseCapital).toBe(25_000);
    expect(overlay.copyTrading?.enabled).toBe(true);
    expect(overlay.enabledChains).toEqual(['solana', 'base']);
    expect(overlay.chains?.solana?.rpcUrls).toHaveLength(2);
  });

  it('rejects a non-numeric numeric variable instead of silently defaulting', () => {
    process.env.CAPITAL_BASE = 'a lot';
    expect(() => configFromEnv()).toThrow(/numeric/);
  });

  it('omits keys that are not set at all', () => {
    delete process.env.CAPITAL_BASE;
    expect(configFromEnv().risk?.baseCapital).toBeUndefined();
  });
});
