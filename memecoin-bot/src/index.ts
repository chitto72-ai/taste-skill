/**
 * Public entry point.
 *
 * Import `buildApplication` to embed the bot in another process, or use the
 * CLI (`src/cli.ts`) to run it standalone.
 */
export { buildApplication, TOKENS } from './composition-root.js';
export type { BuiltApplication } from './composition-root.js';

export { loadConfig, createDefaultConfig, validateConfig } from './config/index.js';
export type { BotConfig } from './config/schema.js';
export { CHAIN_REGISTRY, SUPPORTED_CHAIN_IDS, getChain } from './config/chains.config.js';

export { TradingEngine } from './core/engine.js';
export { PositionManager } from './core/position-manager.js';
export { EventBus } from './core/event-bus.js';
export { Container, token } from './core/container.js';
export { SystemClock, VirtualClock } from './core/clock.js';
export * from './core/domain/index.js';
export * from './core/errors.js';

export { createLogger, createNullLogger, createTestLogger } from './logger/logger.js';
export type { Logger } from './logger/logger.js';

export { Database } from './database/database.js';
export { MemoryDriver, FileDriver, SqliteDriver } from './database/index.js';

export { ChainRegistry, RpcManager, GasManager, FeeOptimizer } from './blockchains/index.js';

export { TokenScorer, ALL_METRICS, METRIC_COUNT } from './scoring/index.js';
export { TokenScanner, EnrichmentPipeline, SyntheticTokenFeed } from './discovery/index.js';

export { ExecutionRouter, PaperExchange, AxiomExchange, AxiomTokenFeed } from './exchanges/index.js';

export { RiskManager, PositionSizer, DrawdownTracker } from './risk/index.js';
export {
  StrategyRegistry,
  SniperStrategy,
  MomentumStrategy,
  CopyTradingStrategy,
  ExitManager,
  StopLossEngine,
  TakeProfitEngine,
} from './strategies/index.js';

export { WalletManager, WalletTracker, Keystore } from './wallets/index.js';
export { AnalyticsService, computeMetrics, formatMetrics } from './analytics/index.js';
export { BacktestEngine, HistoricalDataLoader, StrategyOptimizer, generateDataset } from './backtesting/index.js';
export { ApiServer } from './api/index.js';
