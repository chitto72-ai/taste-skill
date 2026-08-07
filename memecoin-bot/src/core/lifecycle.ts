import type { Logger } from '../logger/logger.js';

/** Anything with a managed start/stop, supervised by the engine. */
export interface Service {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface HealthReport {
  readonly component: string;
  readonly healthy: boolean;
  readonly detail: string;
  readonly checkedAt: number;
  readonly metrics?: Record<string, number | string | boolean>;
}

export interface HealthCheckable {
  health(): Promise<HealthReport> | HealthReport;
}

export function isHealthCheckable(value: unknown): value is HealthCheckable {
  return typeof (value as HealthCheckable)?.health === 'function';
}

/**
 * Starts services in declaration order and stops them in reverse, so that
 * (for example) the execution layer is torn down before the RPC pool it uses.
 * A failed start rolls back everything already started.
 */
export class ServiceSupervisor {
  private readonly started: Service[] = [];
  private running = false;

  constructor(
    private readonly services: readonly Service[],
    private readonly logger: Logger,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async startAll(): Promise<void> {
    for (const service of this.services) {
      try {
        this.logger.debug({ service: service.name }, 'starting service');
        await service.start();
        this.started.push(service);
      } catch (error) {
        this.logger.error({ service: service.name, err: error }, 'service failed to start');
        await this.stopAll();
        throw error;
      }
    }
    this.running = true;
  }

  async stopAll(): Promise<void> {
    for (const service of [...this.started].reverse()) {
      try {
        await service.stop();
      } catch (error) {
        this.logger.error({ service: service.name, err: error }, 'service failed to stop cleanly');
      }
    }
    this.started.length = 0;
    this.running = false;
  }

  async healthAll(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];
    for (const service of this.services) {
      if (!isHealthCheckable(service)) continue;
      try {
        reports.push(await service.health());
      } catch (error) {
        reports.push({
          component: service.name,
          healthy: false,
          detail: error instanceof Error ? error.message : String(error),
          checkedAt: Date.now(),
        });
      }
    }
    return reports;
  }
}
