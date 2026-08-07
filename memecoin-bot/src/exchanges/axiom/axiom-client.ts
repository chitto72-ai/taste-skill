import { createHmac } from 'node:crypto';
import { ExchangeError, NetworkError } from '../../core/errors.js';
import { CircuitBreaker } from '../../core/utils/circuit-breaker.js';
import { RateLimiter } from '../../core/utils/rate-limiter.js';
import { retry, withTimeout } from '../../core/utils/async.js';
import type { Logger } from '../../logger/logger.js';
import type { ExchangeConfig } from '../../config/schema.js';

export interface AxiomRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly signed?: boolean;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
}

/**
 * HTTP client for an Axiom Pro-compatible trading API.
 *
 * Axiom does not publish a stable public API contract, so every part of the
 * wire format that could differ between deployments — base URL, auth scheme,
 * paths — is configuration rather than code, and the response shapes are
 * mapped in `axiom-exchange.ts` behind a single translation layer. Swapping in
 * a different broker means editing that mapping, not the trading logic.
 *
 * Signing follows the near-universal convention for this class of API:
 * `HMAC-SHA256(timestamp + method + path + body)` with the secret, sent
 * alongside the key and timestamp. If a deployment differs, `signRequest` is
 * the single place to change.
 */
export class AxiomClient {
  private readonly limiter: RateLimiter;
  private readonly breaker: CircuitBreaker;
  private readonly logger: Logger;

  constructor(
    private readonly config: ExchangeConfig['axiom'],
    logger: Logger,
  ) {
    this.logger = logger.child('axiom:client');
    this.limiter = new RateLimiter({ ratePerSecond: config.maxRps });
    this.breaker = new CircuitBreaker({
      name: 'axiom-rest',
      failureThreshold: 5,
      openMs: 15_000,
      onStateChange: (state) => this.logger.warn({ state }, 'axiom rest breaker state changed'),
    });
  }

  get isAvailable(): boolean {
    return this.breaker.isAvailable;
  }

  async request<T>(request: AxiomRequest): Promise<T> {
    await this.limiter.acquire();
    return this.breaker.execute(() =>
      retry(
        async () => {
          const url = this.buildUrl(request);
          const bodyText = request.body === undefined ? '' : JSON.stringify(request.body);
          const headers = this.buildHeaders(request, bodyText);

          const response = await withTimeout(
            fetch(url, {
              method: request.method,
              headers,
              body: request.method === 'GET' ? undefined : bodyText || undefined,
            }).catch((error: unknown) => {
              throw new NetworkError(
                `Axiom transport failure: ${error instanceof Error ? error.message : String(error)}`,
                { path: request.path },
                error,
              );
            }),
            request.timeoutMs ?? this.config.timeoutMs,
            `axiom:${request.path}`,
          );

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            // 5xx and 429 are worth another attempt; 4xx means our request is wrong.
            const retryable = response.status >= 500 || response.status === 429;
            throw new ExchangeError(`Axiom HTTP ${response.status}: ${text.slice(0, 300)}`, retryable, {
              path: request.path,
              status: response.status,
            });
          }

          const text = await response.text();
          if (!text) return undefined as T;
          try {
            return JSON.parse(text) as T;
          } catch (error) {
            throw new ExchangeError('Axiom returned a non-JSON response', true, { path: request.path }, error);
          }
        },
        { attempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 },
      ),
    );
  }

  private buildUrl(request: AxiomRequest): string {
    const url = new URL(request.path, this.config.restUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private buildHeaders(request: AxiomRequest, bodyText: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'memecoin-bot/1.0',
    };
    if (bodyText) headers['content-type'] = 'application/json';
    if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;

    if (request.signed !== false && this.config.apiKey) {
      const timestamp = Date.now().toString();
      headers['x-api-key'] = this.config.apiKey;
      headers['x-timestamp'] = timestamp;
      headers['x-signature'] = this.signRequest(timestamp, request.method, request.path, bodyText);
    }
    return headers;
  }

  private signRequest(timestamp: string, method: string, path: string, body: string): string {
    return createHmac('sha256', this.config.apiSecret)
      .update(`${timestamp}${method}${path}${body}`)
      .digest('hex');
  }
}
