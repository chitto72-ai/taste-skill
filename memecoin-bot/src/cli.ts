#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config/index.js';
import { formatIssues } from './config/validate.js';
import { buildApplication } from './composition-root.js';
import { ApiServer } from './api/server.js';
import { createLogger } from './logger/logger.js';
import { BacktestEngine } from './backtesting/backtest-engine.js';
import { HistoricalDataLoader } from './backtesting/data-loader.js';
import { generateDataset } from './backtesting/dataset-generator.js';
import { StrategyOptimizer } from './backtesting/optimizer.js';
import { formatCurve, formatGroups, formatMetrics, sparkline } from './analytics/reporting.js';
import { byChain, byCloseReason, byScoreBucket, byStrategy, computeMetrics } from './analytics/performance.js';
import { curveStats } from './analytics/equity-curve.js';
import { TradeRepository } from './database/repositories/trade-repository.js';
import { METRIC_COUNT } from './scoring/metrics/index.js';
import { Keystore } from './wallets/keystore.js';
import { EvmSigner } from './wallets/signers/evm-signer.js';
import { SolanaSigner } from './wallets/signers/solana-signer.js';
import { getChain } from './config/chains.config.js';
import { shortId } from './core/utils/id.js';
import type { DeepPartial } from './config/merge.js';
import type { BotConfig } from './config/schema.js';

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

interface CliArgs {
  readonly command: string;
  readonly flags: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const [command = 'run', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function overridesFrom(flags: Record<string, string | boolean>): DeepPartial<BotConfig> {
  const overrides: Record<string, unknown> = {};
  if (typeof flags.mode === 'string') overrides.mode = flags.mode;
  if (typeof flags.chains === 'string') overrides.enabledChains = flags.chains.split(',');
  if (typeof flags.capital === 'string') overrides.risk = { baseCapital: Number(flags.capital) };
  if (typeof flags['min-score'] === 'string') overrides.scoring = { minScore: Number(flags['min-score']) };
  if (flags['no-api']) overrides.api = { enabled: false };
  if (typeof flags.log === 'string') overrides.logging = { level: flags.log };
  return overrides as DeepPartial<BotConfig>;
}

const HELP = `
memecoin-bot — multi-chain memecoin trading bot

Usage: memecoin-bot <command> [options]

Commands
  run                 Start the trading engine and the dashboard
  scan                Run a single discovery pass and print the candidates
  backtest            Replay historical data through the full strategy stack
  optimize            Grid search + walk-forward validation over a parameter grid
  generate-data       Write a synthetic dataset for exercising the backtester
  report              Print performance from the stored trade history
  doctor              Validate configuration and report anything suspect
  wallet:import       Seal a private key into the encrypted keystore
  wallet:list         List keystore entries
  help                Show this message

Common options
  --mode <live|paper|backtest>   Override the run mode
  --chains <a,b,c>               Override the enabled chains
  --capital <usd>                Override the base capital
  --min-score <0-100>            Override the score threshold
  --config <path>                Path to a JSON config file
  --log <level>                  trace | debug | info | warn | error
  --no-api                       Do not start the dashboard

Backtest options
  --data <dir>                   Historical data directory
  --generate                     Generate a synthetic dataset first
  --tokens <n> --bars <n>        Synthetic dataset size
  --seed <n>                     Deterministic generator seed
`;

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || flags.help) {
    out(HELP);
    return;
  }

  switch (command) {
    case 'run':
      return runBot(flags);
    case 'scan':
      return runScan(flags);
    case 'backtest':
      return runBacktest(flags);
    case 'optimize':
      return runOptimize(flags);
    case 'generate-data':
      return runGenerateData(flags);
    case 'report':
      return runReport(flags);
    case 'doctor':
      return runDoctor(flags);
    case 'wallet:import':
      return runWalletImport(flags);
    case 'wallet:list':
      return runWalletList(flags);
    default:
      out(`Unknown command "${command}".`);
      out(HELP);
      process.exitCode = 1;
  }
}

async function runBot(flags: Record<string, string | boolean>): Promise<void> {
  const { config, issues } = loadConfig({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
    overrides: overridesFrom(flags),
  });

  const app = await buildApplication(config);
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (warnings.length > 0) {
    app.logger.warn({ count: warnings.length }, 'configuration warnings');
    out(formatIssues(warnings));
  }

  const api = new ApiServer({
    config,
    logger: app.logger,
    events: app.events,
    database: app.database,
    engine: app.engine,
    analytics: app.analytics,
    risk: app.risk,
    positions: app.positions,
    scanner: app.scanner,
    tracker: app.tracker,
    logBuffer: app.logBuffer,
    chains: app.chains,
  });

  await app.engine.start();
  await api.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.logger.warn({ signal }, 'shutdown requested');
    await api.stop().catch(() => undefined);
    await app.engine.stop(signal).catch(() => undefined);
    await app.dispose().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    app.logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    app.logger.fatal({ err: error }, 'uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });
}

async function runScan(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
    overrides: { ...overridesFrom(flags), api: { enabled: false } } as DeepPartial<BotConfig>,
  });

  const app = await buildApplication(config);
  await app.scanner.start();

  const passes = Number(flags.passes ?? 3);
  for (let i = 0; i < passes; i++) {
    await app.scanner.tick();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const candidates = app.scanner.candidates();
  const stats = app.scanner.snapshot();

  out('');
  out(`Discovery — ${stats.scans} scans, ${stats.candidates} candidates, ${stats.filtered} filtered, ${stats.accepted} accepted`);
  out('─'.repeat(96));
  out('SYMBOL      CHAIN     SCORE  RUG   PUMP  DUMP  CONF   LIQUIDITY   MCAP        HOLDERS');
  for (const entry of candidates.slice(0, 25)) {
    const s = entry.score;
    out(
      `${entry.profile.metadata.symbol.padEnd(11)} ${String(entry.profile.ref.chain).padEnd(9)} ` +
        `${String(s.total).padStart(5)}  ${pctCol(s.probabilities.rug)}  ${pctCol(s.probabilities.pump)}  ` +
        `${pctCol(s.probabilities.dump)}  ${pctCol(s.confidence)}  ` +
        `$${Math.round(entry.profile.market.liquidityUsd).toLocaleString().padStart(10)}  ` +
        `$${Math.round(entry.profile.market.marketCapUsd).toLocaleString().padStart(10)}  ` +
        `${entry.profile.holders.count}`,
    );
  }
  if (candidates.length === 0) out('  (no token cleared the score threshold in this window)');

  await app.scanner.stop();
  await app.dispose();
}

async function runBacktest(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
    overrides: { ...overridesFrom(flags), mode: 'backtest' } as DeepPartial<BotConfig>,
  });
  const logger = createLogger({ level: config.logging.level, format: config.logging.format, component: 'backtest' });

  const dataset = flags.generate
    ? generateDataset({
        tokens: Number(flags.tokens ?? 40),
        barsPerToken: Number(flags.bars ?? 240),
        seed: flags.seed ? Number(flags.seed) : undefined,
        chains: config.enabledChains,
      })
    : await new HistoricalDataLoader(
        typeof flags.data === 'string' ? flags.data : config.backtest.dataDir,
        logger,
      ).load();

  const engine = new BacktestEngine(config, {}, logger);
  const result = await engine.run(dataset);
  const rows = result.trades.map(TradeRepository.toRow);

  out('');
  out(formatMetrics(result.metrics, 'Backtest result'));
  out('');
  out(formatCurve(curveStats(result.equity)));
  out('');
  out(`Equity  ${sparkline(result.equity.map((p) => p.equity))}`);
  out('');
  out(formatGroups(byStrategy(rows, result.startingCapital), 'By strategy'));
  out('');
  out(formatGroups(byChain(rows, result.startingCapital), 'By chain'));
  out('');
  out(formatGroups(byCloseReason(rows, result.startingCapital), 'By exit reason'));
  out('');
  out(formatGroups(byScoreBucket(rows), 'By entry score'));
  out('');
  out(
    `Processed ${result.barsProcessed.toLocaleString()} bars across ${result.tokensEvaluated} tokens in ${result.durationMs}ms; ` +
      `${result.signalsGenerated} signals, ${result.entriesTaken} entries.`,
  );
  const rejections = Object.entries(result.entriesRejected);
  if (rejections.length > 0) {
    out(`Entries blocked: ${rejections.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (flags.generate) {
    out('');
    out('NOTE: this run used synthetic data. It validates the machinery — costs, risk limits,');
    out('exit logic — but says nothing about whether the strategy has edge. Use exported market');
    out('data for that.');
  }
}

async function runOptimize(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
    overrides: { ...overridesFrom(flags), mode: 'backtest' } as DeepPartial<BotConfig>,
  });
  const logger = createLogger({ level: config.logging.level, format: config.logging.format, component: 'optimize' });

  const dataset = flags.generate
    ? generateDataset({ tokens: Number(flags.tokens ?? 30), barsPerToken: Number(flags.bars ?? 200), chains: config.enabledChains })
    : await new HistoricalDataLoader(
        typeof flags.data === 'string' ? flags.data : config.backtest.dataDir,
        logger,
      ).load();

  const optimizer = new StrategyOptimizer({
    logger,
    grid: {
      'scoring.minScore': [75, 80, 85],
      'risk.kellyFraction': [0.15, 0.25, 0.4],
      'exit.stopLossPct': [18, 25, 32],
      'exit.trailingActivationPct': [25, 35, 50],
    },
  });

  const walkForward = await optimizer.walkForward(config, dataset, Number(flags.folds ?? 3));

  out('');
  out('Walk-forward validation (out-of-sample only)');
  out('─'.repeat(72));
  for (const [index, fold] of walkForward.folds.entries()) {
    out(
      `Fold ${index + 1}: ${JSON.stringify(fold.train.parameters)} -> ` +
        `${fold.test.metrics.trades} trades, PnL $${fold.test.metrics.netPnl.toFixed(2)}, ` +
        `PF ${fold.test.metrics.profitFactor.toFixed(2)}`,
    );
  }
  out('');
  out(
    `Aggregate: ${walkForward.aggregate.trades} trades, ` +
      `PnL $${walkForward.aggregate.netPnl.toFixed(2)}, ` +
      `win rate ${(walkForward.aggregate.winRate * 100).toFixed(1)}%, ` +
      `profit factor ${walkForward.aggregate.profitFactor.toFixed(2)}`,
  );
  out('');
  out('In-sample parameters that do not survive the out-of-sample fold are noise. Trust the aggregate.');
}

async function runGenerateData(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({ overrides: overridesFrom(flags) });
  const logger = createLogger({ level: 'info', format: config.logging.format, component: 'generate' });
  const directory = typeof flags.data === 'string' ? flags.data : config.backtest.dataDir;

  const dataset = generateDataset({
    tokens: Number(flags.tokens ?? 40),
    barsPerToken: Number(flags.bars ?? 240),
    seed: flags.seed ? Number(flags.seed) : undefined,
    chains: config.enabledChains,
  });

  await new HistoricalDataLoader(directory, logger).save(dataset);
  out(`Wrote ${dataset.length} synthetic series to ${directory}`);
}

async function runReport(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({
    configPath: typeof flags.config === 'string' ? flags.config : undefined,
    overrides: { ...overridesFrom(flags), api: { enabled: false } } as DeepPartial<BotConfig>,
  });
  const app = await buildApplication(config);

  const trades = await app.database.trades.all();
  if (trades.length === 0) {
    out('No closed trades recorded yet.');
    await app.dispose();
    return;
  }

  const metrics = computeMetrics(trades, config.risk.baseCapital);
  out('');
  out(formatMetrics(metrics, 'Recorded performance'));
  out('');
  out(formatGroups(byStrategy(trades, config.risk.baseCapital), 'By strategy'));
  out('');
  out(formatGroups(byCloseReason(trades, config.risk.baseCapital), 'By exit reason'));
  out('');
  out(formatGroups(byScoreBucket(trades), 'By entry score'));

  await app.dispose();
}

async function runDoctor(flags: Record<string, string | boolean>): Promise<void> {
  let exitCode = 0;
  try {
    const { config, issues, sources } = loadConfig({
      configPath: typeof flags.config === 'string' ? flags.config : undefined,
      overrides: overridesFrom(flags),
    });

    out('');
    out('Configuration');
    out('─'.repeat(72));
    out(`Sources         ${sources.join(' -> ')}`);
    out(`Mode            ${config.mode} (${config.env})`);
    out(`Chains          ${config.enabledChains.join(', ')}`);
    out(`Venue           ${config.exchange.primary}${config.exchange.axiom.enabled ? ' (axiom enabled)' : ''}`);
    out(`Storage         ${config.database.driver} at ${config.database.path}`);
    out(`Capital         $${config.risk.baseCapital.toLocaleString()}`);
    out(`Risk / trade    ${config.risk.riskPerTradePct}%  ·  max ${config.risk.maxConcurrentPositions} positions`);
    out(`Score threshold ${config.scoring.minScore} across ${METRIC_COUNT} metrics`);
    out(`Take profit     ${config.exit.takeProfitLevels.map((l) => `${l.triggerMultiple}x/${l.sellFraction * 100}%`).join('  ')}`);
    out(`Dashboard       ${config.api.enabled ? `http://${config.api.host}:${config.api.port}` : 'disabled'}`);

    for (const chainId of config.enabledChains) {
      const runtime = config.chains[chainId];
      const descriptor = getChain(chainId);
      out(
        `  ${chainId.padEnd(12)} ${descriptor.family}  ${runtime.rpcUrls.length} RPC endpoint(s)  ` +
          `gas cap $${runtime.maxGasUsdPerTx}`,
      );
    }

    if (issues.length > 0) {
      out('');
      out('Findings');
      out('─'.repeat(72));
      out(formatIssues(issues));
      if (issues.some((i) => i.severity === 'error')) exitCode = 1;
    } else {
      out('');
      out('No configuration issues found.');
    }
  } catch (error) {
    out(`Configuration is invalid:\n${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

async function runWalletImport(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({ overrides: overridesFrom(flags) });
  const chainId = typeof flags.chain === 'string' ? flags.chain : '';
  if (!chainId) {
    out('Usage: memecoin-bot wallet:import --chain <chainId> [--label <name>]');
    process.exitCode = 1;
    return;
  }

  const descriptor = getChain(chainId);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Read from a prompt rather than argv: shell history is not a keystore.
  const privateKey = (await rl.question('Private key (never echoed to logs): ')).trim();
  rl.close();

  if (!privateKey) {
    out('No key provided.');
    process.exitCode = 1;
    return;
  }

  const signer =
    descriptor.family === 'evm'
      ? await EvmSigner.create(chainId, privateKey)
      : await SolanaSigner.create(chainId, privateKey);

  const keystore = new Keystore(config.wallets.keystoreDir, config.wallets.passphrase);
  const id = shortId('wallet');
  await keystore.seal(
    {
      id,
      chain: chainId,
      family: descriptor.family,
      address: signer.address,
      label: typeof flags.label === 'string' ? flags.label : `${chainId}-hot`,
    },
    privateKey,
  );

  out(`Sealed ${signer.address} for ${chainId} as "${id}" in ${config.wallets.keystoreDir}`);
}

async function runWalletList(flags: Record<string, string | boolean>): Promise<void> {
  const { config } = loadConfig({ overrides: overridesFrom(flags) });
  const entries = await new Keystore(config.wallets.keystoreDir, config.wallets.passphrase).list();
  if (entries.length === 0) {
    out(`No wallets in ${config.wallets.keystoreDir}`);
    return;
  }
  out('');
  out('ID                    CHAIN        ADDRESS                                       LABEL');
  for (const entry of entries) {
    out(`${entry.id.padEnd(21)} ${entry.chain.padEnd(12)} ${entry.address.padEnd(45)} ${entry.label}`);
  }
}

function pctCol(value: number): string {
  return `${(value * 100).toFixed(0).padStart(3)}%`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
