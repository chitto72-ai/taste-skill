import type { Service } from '../core/lifecycle.js';
import type { HealthReport } from '../core/lifecycle.js';
import type { DatabaseConfig } from '../config/schema.js';
import type { Logger } from '../logger/logger.js';
import type { StorageDriver } from './driver.js';
import { MemoryDriver } from './drivers/memory-driver.js';
import { FileDriver } from './drivers/file-driver.js';
import { SqliteDriver } from './drivers/sqlite-driver.js';
import { PositionRepository } from './repositories/position-repository.js';
import { TradeRepository } from './repositories/trade-repository.js';
import { MetricRepository, TokenRepository } from './repositories/token-repository.js';
import { WalletRepository } from './repositories/wallet-repository.js';
import { EquityRepository, PerformanceRepository } from './repositories/performance-repository.js';
import {
  ErrorRepository,
  LogRepository,
  OrderRepository,
} from './repositories/telemetry-repository.js';

export function createDriver(config: DatabaseConfig): StorageDriver {
  switch (config.driver) {
    case 'memory':
      return new MemoryDriver();
    case 'sqlite':
      return new SqliteDriver(config.path);
    case 'file':
    default:
      return new FileDriver(config.path, config.flushIntervalMs);
  }
}

/**
 * Repository aggregate root. Everything that persists goes through here, which
 * gives one place to swap drivers, one place to run retention, and one place
 * to flush before shutdown.
 */
export class Database implements Service {
  readonly name = 'database';

  readonly trades: TradeRepository;
  readonly positions: PositionRepository;
  readonly orders: OrderRepository;
  readonly tokens: TokenRepository;
  readonly metrics: MetricRepository;
  readonly wallets: WalletRepository;
  readonly performance: PerformanceRepository;
  readonly equity: EquityRepository;
  readonly errors: ErrorRepository;
  readonly logs: LogRepository;

  private retentionTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly driver: StorageDriver,
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
  ) {
    this.trades = new TradeRepository(driver);
    this.positions = new PositionRepository(driver);
    this.orders = new OrderRepository(driver);
    this.tokens = new TokenRepository(driver);
    this.metrics = new MetricRepository(driver);
    this.wallets = new WalletRepository(driver);
    this.performance = new PerformanceRepository(driver);
    this.equity = new EquityRepository(driver);
    this.errors = new ErrorRepository(driver);
    this.logs = new LogRepository(driver);
  }

  static async create(config: DatabaseConfig, logger: Logger): Promise<Database> {
    const driver = createDriver(config);
    const database = new Database(driver, config, logger.child('database'));
    await database.start();
    return database;
  }

  async start(): Promise<void> {
    await this.driver.init();
    // Hourly is frequent enough for day-granularity retention and cheap.
    this.retentionTimer = setInterval(() => void this.runRetention(), 60 * 60_000);
    this.retentionTimer.unref?.();
    this.logger.info({ driver: this.driver.name, path: this.config.path }, 'database ready');
  }

  async stop(): Promise<void> {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
    await this.driver.flush();
    await this.driver.close();
    this.logger.info('database closed');
  }

  async flush(): Promise<void> {
    await this.driver.flush();
  }

  /**
   * Retention. Metrics and logs dominate row count and age out fastest;
   * trades and performance rows are the audit trail and are kept longest.
   */
  async runRetention(): Promise<Record<string, number>> {
    const now = Date.now();
    const day = 24 * 60 * 60_000;
    const removed: Record<string, number> = {};
    try {
      removed.metrics = await this.metrics.pruneOlderThan(now - this.config.metricRetentionDays * day);
      removed.logs = await this.logs.pruneOlderThan(now - this.config.metricRetentionDays * day);
      removed.errors = await this.errors.pruneOlderThan(now - this.config.retentionDays * day);
      removed.tokens = await this.tokens.pruneOlderThan(now - this.config.retentionDays * day);
      removed.equity = await this.equity.pruneOlderThan(now - this.config.retentionDays * day);
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      if (total > 0) this.logger.info({ removed }, 'retention pruned rows');
    } catch (error) {
      this.logger.error({ err: error }, 'retention pass failed');
    }
    return removed;
  }

  async health(): Promise<HealthReport> {
    try {
      const trades = await this.trades.count();
      const positions = await this.positions.count();
      return {
        component: this.name,
        healthy: true,
        detail: `${this.driver.name} driver online`,
        checkedAt: Date.now(),
        metrics: { trades, positions, driver: this.driver.name },
      };
    } catch (error) {
      return {
        component: this.name,
        healthy: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      };
    }
  }
}
