import type { ChainId } from '../../core/domain/chain.js';
import type { EventBus } from '../../core/event-bus.js';
import { AppError, RpcError, isRetryable, toAppError } from '../../core/errors.js';
import type { HealthReport, Service } from '../../core/lifecycle.js';
import { CircuitBreaker } from '../../core/utils/circuit-breaker.js';
import { RateLimiter } from '../../core/utils/rate-limiter.js';
import { backoffDelay, sleep } from '../../core/utils/async.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRuntimeConfig } from '../../config/schema.js';
import type { RpcCallOptions, RpcEndpointStats } from '../types.js';
import { JsonRpcClient } from './json-rpc.js';

interface Endpoint {
  readonly url: string;
  readonly client: JsonRpcClient;
  readonly breaker: CircuitBreaker;
  readonly limiter: RateLimiter;
  requests: number;
  failures: number;
  consecutiveFailures: number;
  latencyEwmaMs: number;
  lastErrorAt?: number;
  lastError?: string;
  healthy: boolean;
}

export interface RpcManagerOptions {
  readonly chainId: ChainId;
  readonly config: ChainRuntimeConfig;
  readonly logger: Logger;
  readonly events?: EventBus;
  /** Method used for periodic liveness probes (family-specific). */
  readonly healthCheckMethod: string;
  readonly healthCheckParams?: readonly unknown[];
}

/**
 * Multi-endpoint RPC pool with failover, per-endpoint circuit breakers, token
 * buckets and latency-aware ranking.
 *
 * The ranking matters more than it looks: on Solana especially, a "working"
 * endpoint that answers in 900ms instead of 90ms is the difference between
 * landing an entry and buying the top. Endpoints are therefore scored by an
 * EWMA of latency, and a failing one is parked by its breaker rather than
 * being retried into the ground.
 */
export class RpcManager implements Service {
  readonly name: string;
  private readonly endpoints: Endpoint[];
  private readonly logger: Logger;
  private healthTimer: NodeJS.Timeout | undefined;
  private totalCalls = 0;
  private totalFailovers = 0;

  constructor(private readonly options: RpcManagerOptions) {
    this.name = `rpc:${options.chainId}`;
    this.logger = options.logger.child(this.name, { chain: options.chainId });

    if (options.config.rpcUrls.length === 0) {
      throw new AppError(`No RPC endpoints configured for chain "${options.chainId}"`, {
        code: 'RPC_NO_ENDPOINTS',
        category: 'config',
        context: { chain: options.chainId },
      });
    }

    this.endpoints = options.config.rpcUrls.map((url) => ({
      url,
      client: new JsonRpcClient(url, { timeoutMs: options.config.timeoutMs }),
      breaker: new CircuitBreaker({
        name: `${options.chainId}:${hostOf(url)}`,
        failureThreshold: options.config.failoverThreshold,
        openMs: 20_000,
        onStateChange: (state, name) => {
          this.logger.warn({ endpoint: name, state }, 'rpc breaker state changed');
        },
      }),
      limiter: new RateLimiter({ ratePerSecond: options.config.maxRps }),
      requests: 0,
      failures: 0,
      consecutiveFailures: 0,
      latencyEwmaMs: 0,
      healthy: true,
    }));
  }

  async start(): Promise<void> {
    await this.probeAll();
    this.healthTimer = setInterval(() => {
      void this.probeAll();
    }, this.options.config.healthCheckIntervalMs);
    this.healthTimer.unref?.();
    this.logger.info({ endpoints: this.endpoints.length }, 'rpc manager started');
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
  }

  /**
   * Executes a JSON-RPC call, walking healthy endpoints in rank order and
   * retrying with backoff. Non-retryable errors (bad params, revert data)
   * short-circuit instead of being replayed against every endpoint.
   */
  async call<T>(method: string, params: readonly unknown[] = [], options: RpcCallOptions = {}): Promise<T> {
    this.totalCalls++;
    const candidates = this.rankedEndpoints();
    if (candidates.length === 0) {
      throw new RpcError(`All RPC endpoints for "${this.options.chainId}" are unavailable`, true, {
        chain: this.options.chainId,
        endpoints: this.endpoints.map((e) => e.url),
      });
    }

    const maxEndpoints = Math.min(options.maxEndpoints ?? candidates.length, candidates.length);
    const attemptsPerEndpoint = this.options.config.maxRetries;
    let lastError: unknown;

    for (let index = 0; index < maxEndpoints; index++) {
      const endpoint = candidates[index];
      if (index > 0) {
        this.totalFailovers++;
        this.options.events?.emit('chain.rpc_failover', {
          chain: String(this.options.chainId),
          from: candidates[index - 1].url,
          to: endpoint.url,
          reason: lastError instanceof Error ? lastError.message : 'unknown',
        });
      }

      for (let attempt = 1; attempt <= attemptsPerEndpoint; attempt++) {
        try {
          if (!options.bypassRateLimit) await endpoint.limiter.acquire();
          const started = Date.now();
          const result = await endpoint.breaker.execute(() =>
            endpoint.client.call<T>(method, params, options.timeoutMs),
          );
          this.recordSuccess(endpoint, Date.now() - started);
          return result;
        } catch (error) {
          lastError = error;
          this.recordFailure(endpoint, error);
          if (!isRetryable(error)) {
            // A deterministic error will fail identically everywhere.
            throw toAppError(error);
          }
          if (attempt < attemptsPerEndpoint) {
            await sleep(backoffDelay(attempt, { baseDelayMs: 120, maxDelayMs: 1_500 }));
          }
        }
      }
    }

    throw new RpcError(
      `RPC call "${method}" failed on all ${maxEndpoints} endpoint(s) for ${this.options.chainId}`,
      true,
      { chain: this.options.chainId, method, lastError: describe(lastError) },
    );
  }

  /** Batched variant; batching is a large win for holder/balance sweeps. */
  async batch<T extends unknown[]>(
    requests: readonly { method: string; params: readonly unknown[] }[],
    options: RpcCallOptions = {},
  ): Promise<T> {
    const candidates = this.rankedEndpoints();
    if (candidates.length === 0) {
      throw new RpcError(`All RPC endpoints for "${this.options.chainId}" are unavailable`, true, {
        chain: this.options.chainId,
      });
    }
    let lastError: unknown;
    for (const endpoint of candidates.slice(0, options.maxEndpoints ?? candidates.length)) {
      try {
        if (!options.bypassRateLimit) await endpoint.limiter.acquire(requests.length);
        const started = Date.now();
        const result = await endpoint.breaker.execute(() =>
          endpoint.client.batch<T>(requests, options.timeoutMs),
        );
        this.recordSuccess(endpoint, Date.now() - started);
        return result;
      } catch (error) {
        lastError = error;
        this.recordFailure(endpoint, error);
        if (!isRetryable(error)) throw toAppError(error);
      }
    }
    throw new RpcError(`Batched RPC call failed on all endpoints for ${this.options.chainId}`, true, {
      chain: this.options.chainId,
      lastError: describe(lastError),
    });
  }

  stats(): RpcEndpointStats[] {
    return this.endpoints.map((e) => ({
      url: redactUrl(e.url),
      healthy: e.healthy && e.breaker.isAvailable,
      breakerState: e.breaker.currentState,
      requests: e.requests,
      failures: e.failures,
      avgLatencyMs: Math.round(e.latencyEwmaMs),
      lastErrorAt: e.lastErrorAt,
      lastError: e.lastError,
      consecutiveFailures: e.consecutiveFailures,
    }));
  }

  health(): HealthReport {
    const available = this.endpoints.filter((e) => e.healthy && e.breaker.isAvailable);
    return {
      component: this.name,
      healthy: available.length > 0,
      detail:
        available.length > 0
          ? `${available.length}/${this.endpoints.length} endpoints available`
          : 'no RPC endpoint available',
      checkedAt: Date.now(),
      metrics: {
        endpoints: this.endpoints.length,
        available: available.length,
        calls: this.totalCalls,
        failovers: this.totalFailovers,
        bestLatencyMs: Math.round(Math.min(...this.endpoints.map((e) => e.latencyEwmaMs || Infinity))) || 0,
      },
    };
  }

  /** Healthy endpoints first, ordered by EWMA latency; unhealthy ones last. */
  private rankedEndpoints(): Endpoint[] {
    const usable = this.endpoints.filter((e) => e.breaker.isAvailable);
    const pool = usable.length > 0 ? usable : this.endpoints;
    return [...pool].sort((a, b) => {
      if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
      const latencyA = a.latencyEwmaMs || Number.MAX_SAFE_INTEGER;
      const latencyB = b.latencyEwmaMs || Number.MAX_SAFE_INTEGER;
      return latencyA - latencyB;
    });
  }

  private recordSuccess(endpoint: Endpoint, latencyMs: number): void {
    endpoint.requests++;
    endpoint.consecutiveFailures = 0;
    endpoint.healthy = true;
    // EWMA with alpha=0.3 — reacts within a few calls without flapping.
    endpoint.latencyEwmaMs =
      endpoint.latencyEwmaMs === 0 ? latencyMs : endpoint.latencyEwmaMs * 0.7 + latencyMs * 0.3;
  }

  private recordFailure(endpoint: Endpoint, error: unknown): void {
    endpoint.requests++;
    endpoint.failures++;
    endpoint.consecutiveFailures++;
    endpoint.lastErrorAt = Date.now();
    endpoint.lastError = describe(error);
    if (endpoint.consecutiveFailures >= this.options.config.failoverThreshold) {
      endpoint.healthy = false;
    }
    this.logger.debug(
      { endpoint: hostOf(endpoint.url), err: error, consecutive: endpoint.consecutiveFailures },
      'rpc endpoint call failed',
    );
  }

  private async probeAll(): Promise<void> {
    await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const wasHealthy = endpoint.healthy;
        try {
          const started = Date.now();
          await endpoint.client.call(
            this.options.healthCheckMethod,
            this.options.healthCheckParams ?? [],
            Math.min(this.options.config.timeoutMs, 5_000),
          );
          this.recordSuccess(endpoint, Date.now() - started);
          endpoint.breaker.recordSuccess();
          if (!wasHealthy) {
            this.logger.info({ endpoint: hostOf(endpoint.url) }, 'rpc endpoint recovered');
            this.options.events?.emit('health.changed', {
              component: `${this.name}:${hostOf(endpoint.url)}`,
              healthy: true,
              detail: 'endpoint recovered',
            });
          }
        } catch (error) {
          endpoint.healthy = false;
          endpoint.lastErrorAt = Date.now();
          endpoint.lastError = describe(error);
          if (wasHealthy) {
            this.logger.warn({ endpoint: hostOf(endpoint.url), err: error }, 'rpc endpoint unhealthy');
            this.options.events?.emit('health.changed', {
              component: `${this.name}:${hostOf(endpoint.url)}`,
              healthy: false,
              detail: describe(error),
            });
          }
        }
      }),
    );
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Endpoint URLs often embed API keys in the path. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.length > 1 ? '/…' : ''}`;
  } catch {
    return url;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
