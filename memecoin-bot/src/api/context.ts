import type { EventBus } from '../core/event-bus.js';
import type { TradingEngine } from '../core/engine.js';
import type { PositionManager } from '../core/position-manager.js';
import type { BotConfig } from '../config/schema.js';
import type { Database } from '../database/database.js';
import type { AnalyticsService } from '../analytics/analytics-service.js';
import type { RiskManager } from '../risk/risk-manager.js';
import type { TokenScanner } from '../discovery/scanner.js';
import type { WalletTracker } from '../wallets/tracker/wallet-tracker.js';
import type { ChainRegistry } from '../blockchains/registry.js';
import type { MemorySink } from '../logger/sinks.js';
import type { Logger } from '../logger/logger.js';

/** Everything the HTTP layer is allowed to touch, passed explicitly. */
export interface ApiContext {
  readonly config: BotConfig;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly database: Database;
  readonly engine: TradingEngine;
  readonly analytics: AnalyticsService;
  readonly risk: RiskManager;
  readonly positions: PositionManager;
  readonly scanner: TokenScanner;
  readonly tracker: WalletTracker;
  readonly logBuffer: MemorySink;
  readonly chains?: ChainRegistry;
}
