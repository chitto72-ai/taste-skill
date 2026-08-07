import { Container, token } from './core/container.js';
import { EventBus } from './core/event-bus.js';
import { TradingEngine } from './core/engine.js';
import { PositionManager } from './core/position-manager.js';
import type { Service } from './core/lifecycle.js';
import { createLogger, type Logger } from './logger/logger.js';
import { CallbackSink, FileSink, MemorySink } from './logger/sinks.js';
import { LEVEL_ORDER } from './logger/types.js';
import type { BotConfig } from './config/schema.js';
import { Database } from './database/database.js';
import { ChainRegistry } from './blockchains/registry.js';
import { HttpPriceOracle } from './blockchains/price-oracle.js';
import { FeeOptimizer } from './blockchains/gas/fee-optimizer.js';
import type { PriceOracle } from './blockchains/types.js';
import { TokenScorer } from './scoring/scorer.js';
import { EnrichmentPipeline } from './discovery/pipeline.js';
import { TokenScanner } from './discovery/scanner.js';
import { SyntheticTokenFeed } from './discovery/sources/synthetic-feed.js';
import { HoldersEnricher } from './discovery/enrichment/holders-enricher.js';
import { SecurityEnricher } from './discovery/enrichment/security-enricher.js';
import { SmartMoneyEnricher } from './discovery/enrichment/smart-money-enricher.js';
import { SocialEnricher } from './discovery/enrichment/social-enricher.js';
import { DeveloperEnricher } from './discovery/enrichment/developer-enricher.js';
import type { Enricher, TokenFeed } from './discovery/types.js';
import { PaperExchange } from './exchanges/paper/paper-exchange.js';
import { AxiomClient } from './exchanges/axiom/axiom-client.js';
import { AxiomExchange } from './exchanges/axiom/axiom-exchange.js';
import { AxiomTokenFeed } from './exchanges/axiom/axiom-feed.js';
import { ExecutionRouter } from './exchanges/router.js';
import type { ExchangeAdapter, MarketDataSource } from './exchanges/types.js';
import { RiskManager } from './risk/risk-manager.js';
import { StrategyRegistry } from './strategies/registry.js';
import { SniperStrategy } from './strategies/sniper-strategy.js';
import { MomentumStrategy } from './strategies/momentum-strategy.js';
import { CopyTradingStrategy } from './strategies/copy-trading-strategy.js';
import { ExitManager } from './strategies/exits/exit-manager.js';
import { WalletManager } from './wallets/wallet-manager.js';
import { WalletTracker } from './wallets/tracker/wallet-tracker.js';
import { AnalyticsService } from './analytics/analytics-service.js';
import { DeveloperHistoryService } from './discovery/developer-history.js';
import { ScannerMarketData } from './discovery/scanner-market-data.js';

export const TOKENS = {
  config: token<BotConfig>('config'),
  logger: token<Logger>('logger'),
  events: token<EventBus>('events'),
  database: token<Database>('database'),
  priceOracle: token<PriceOracle>('priceOracle'),
  chains: token<ChainRegistry | undefined>('chains'),
  scorer: token<TokenScorer>('scorer'),
  scanner: token<TokenScanner>('scanner'),
  router: token<ExecutionRouter>('router'),
  risk: token<RiskManager>('risk'),
  strategies: token<StrategyRegistry>('strategies'),
  exits: token<ExitManager>('exits'),
  positions: token<PositionManager>('positions'),
  analytics: token<AnalyticsService>('analytics'),
  wallets: token<WalletManager | undefined>('wallets'),
  tracker: token<WalletTracker>('tracker'),
  engine: token<TradingEngine>('engine'),
} as const;

export interface BuiltApplication {
  readonly container: Container;
  readonly config: BotConfig;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly database: Database;
  readonly engine: TradingEngine;
  readonly scanner: TokenScanner;
  readonly risk: RiskManager;
  readonly analytics: AnalyticsService;
  readonly positions: PositionManager;
  readonly router: ExecutionRouter;
  readonly tracker: WalletTracker;
  readonly chains?: ChainRegistry;
  readonly logBuffer: MemorySink;
  dispose(): Promise<void>;
}

/**
 * The composition root: the single place where concrete implementations are
 * chosen and wired.
 *
 * Everything above this file depends on interfaces, which is what allows the
 * same engine to run three very different configurations:
 *
 *  - **live**   — real chains, real venue, real signers.
 *  - **paper**  — synthetic feed + simulated venue, no keys, no network.
 *  - **backtest** — driven entirely by the backtest module.
 *
 * The mode decides the implementations; no downstream module branches on it.
 */
export async function buildApplication(config: BotConfig): Promise<BuiltApplication> {
  const container = new Container();
  const logBuffer = new MemorySink(500);

  // --- logging --------------------------------------------------------------
  const logger = createLogger({
    level: config.logging.level,
    format: config.logging.format,
    component: 'bot',
  });
  logger.addSink(logBuffer);
  if (config.logging.file) logger.addSink(new FileSink(config.logging.file));

  const events = new EventBus({
    onHandlerError: (name, error) => logger.error({ event: name, err: error }, 'event handler failed'),
    slowHandlerMs: 500,
    onSlowHandler: (name, ms) => logger.warn({ event: name, ms }, 'slow event handler'),
  });

  // --- persistence ----------------------------------------------------------
  const database = await Database.create(config.database, logger);
  if (config.logging.persistToDatabase) {
    const minLevel = LEVEL_ORDER[config.logging.databaseMinLevel];
    logger.addSink(
      new CallbackSink('database', (record) => {
        if (LEVEL_ORDER[record.level] < minLevel) return;
        void database.logs.record(record).catch(() => undefined);
      }),
    );
  }

  container.registerValue(TOKENS.config, config);
  container.registerValue(TOKENS.logger, logger);
  container.registerValue(TOKENS.events, events);
  container.registerValue(TOKENS.database, database);

  const priceOracle = new HttpPriceOracle({ logger });
  container.registerValue(TOKENS.priceOracle, priceOracle);

  // --- chains (live only; paper and backtest never touch an RPC) ------------
  let chains: ChainRegistry | undefined;
  if (config.mode === 'live') {
    chains = new ChainRegistry({ config, logger, events, priceOracle });
  }
  container.registerValue(TOKENS.chains, chains);

  // --- wallets --------------------------------------------------------------
  const walletManager =
    config.mode === 'live' && chains
      ? new WalletManager({
          config: config.wallets,
          chains,
          priceOracle,
          logger,
          requireSigners: true,
        })
      : undefined;
  container.registerValue(TOKENS.wallets, walletManager);

  const tracker = new WalletTracker({
    config: config.copyTrading,
    database,
    events,
    logger,
  });
  container.registerValue(TOKENS.tracker, tracker);

  // --- scoring --------------------------------------------------------------
  const scorer = new TokenScorer({ config: config.scoring });
  container.registerValue(TOKENS.scorer, scorer);

  // --- feeds and venues -----------------------------------------------------
  const useAxiom = config.exchange.primary === 'axiom' && config.exchange.axiom.enabled;
  const syntheticFeed = new SyntheticTokenFeed({ chains: config.enabledChains });

  const feeds: TokenFeed[] = [];
  const adapters: ExchangeAdapter[] = [];

  if (useAxiom) {
    const axiomClient = new AxiomClient(config.exchange.axiom, logger);
    feeds.push(new AxiomTokenFeed({ client: axiomClient, chains: config.enabledChains, logger }));
    adapters.push(new AxiomExchange({ config: config.exchange.axiom, chains: config.enabledChains, logger }));
  } else {
    feeds.push(syntheticFeed);
  }

  // --- discovery ------------------------------------------------------------
  const developerHistory = new DeveloperHistoryService(database, logger);
  const enrichers: Enricher[] = [
    new HoldersEnricher(chains, logger),
    new SecurityEnricher(chains, config.discovery, logger),
    new SmartMoneyEnricher(tracker, logger),
    new SocialEnricher(undefined, logger),
    new DeveloperEnricher(developerHistory, logger),
  ];

  const pipeline = new EnrichmentPipeline({ enrichers, logger });
  const scanner = new TokenScanner({
    feeds,
    pipeline,
    scorer,
    config: config.discovery,
    minScore: config.scoring.minScore,
    events,
    logger,
  });
  container.registerValue(TOKENS.scanner, scanner);

  // The paper venue prices from whatever the scanner most recently saw, which
  // keeps simulated fills consistent with the data the strategy acted on.
  const marketData: MarketDataSource = useAxiom
    ? new ScannerMarketData(scanner)
    : new ScannerMarketData(scanner, syntheticFeed);

  if (!useAxiom) {
    adapters.push(
      new PaperExchange({
        config: config.exchange.paper,
        market: marketData,
        startingCash: config.risk.baseCapital,
        chains: config.enabledChains,
        logger,
      }),
    );
  }

  const router = new ExecutionRouter({ adapters, events, logger, database });
  container.registerValue(TOKENS.router, router);

  // --- risk, strategies, exits ---------------------------------------------
  const risk = new RiskManager({
    config: config.risk,
    entry: config.entry,
    events,
    logger,
  });
  container.registerValue(TOKENS.risk, risk);

  const exits = new ExitManager({ config: config.exit, logger });
  container.registerValue(TOKENS.exits, exits);

  const copyTrading = new CopyTradingStrategy({ config: config.copyTrading, exit: config.exit, tracker });
  const strategies = new StrategyRegistry(
    [
      new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
      new MomentumStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
      copyTrading,
    ],
    logger,
  );
  container.registerValue(TOKENS.strategies, strategies);

  const feeOptimizer = new FeeOptimizer({ entry: config.entry, risk: config.risk });
  const positions = new PositionManager({
    router,
    exits,
    feeOptimizer,
    database,
    events,
    logger,
  });
  container.registerValue(TOKENS.positions, positions);

  const analytics = new AnalyticsService({
    database,
    events,
    risk,
    logger,
    startingCapital: config.risk.baseCapital,
  });
  container.registerValue(TOKENS.analytics, analytics);

  // Startup order matters: storage and chains first, then market access,
  // then the loops that consume them.
  const services: Service[] = [];
  if (chains) services.push(chains);
  if (walletManager) services.push(walletManager);
  services.push(tracker, router, risk, analytics, scanner);

  const engine = new TradingEngine({
    config,
    events,
    logger,
    database,
    scanner,
    strategies,
    risk,
    router,
    exits,
    positions,
    analytics,
    services,
    copyTrading,
  });
  container.registerValue(TOKENS.engine, engine);

  container.onDispose(async () => {
    await engine.stop('container dispose').catch(() => undefined);
    await database.stop().catch(() => undefined);
    await logger.close().catch(() => undefined);
  });

  return {
    container,
    config,
    logger,
    events,
    database,
    engine,
    scanner,
    risk,
    analytics,
    positions,
    router,
    tracker,
    chains,
    logBuffer,
    dispose: () => container.dispose(),
  };
}
