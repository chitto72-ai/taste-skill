import { NetworkError, RpcError } from '../../core/errors.js';
import { withTimeout } from '../../core/utils/async.js';

export interface JsonRpcRequest {
  readonly method: string;
  readonly params: readonly unknown[];
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * JSON-RPC error codes that mean "this endpoint is unhealthy" rather than
 * "this request is wrong". Only the former should trigger failover; retrying a
 * malformed call on a second endpoint just burns latency.
 */
const RETRYABLE_RPC_CODES = new Set([-32005, -32000, -32603, 429, 503]);

let requestSeq = 0;

export interface JsonRpcClientOptions {
  readonly timeoutMs: number;
  readonly headers?: Record<string, string>;
}

/** Minimal HTTP JSON-RPC client shared by the EVM and Solana adapters. */
export class JsonRpcClient {
  constructor(
    readonly url: string,
    private readonly options: JsonRpcClientOptions,
  ) {}

  async call<T>(method: string, params: readonly unknown[] = [], timeoutMs?: number): Promise<T> {
    const [result] = await this.batch<[T]>([{ method, params }], timeoutMs);
    return result;
  }

  /** Batched call: one HTTP round trip for N methods, in request order. */
  async batch<T extends unknown[]>(
    requests: readonly JsonRpcRequest[],
    timeoutMs?: number,
  ): Promise<T> {
    if (requests.length === 0) return [] as unknown as T;

    const payload = requests.map((req) => ({
      jsonrpc: '2.0' as const,
      id: ++requestSeq,
      method: req.method,
      params: req.params,
    }));

    const body = JSON.stringify(requests.length === 1 ? payload[0] : payload);
    const response = await withTimeout(
      fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.options.headers },
        body,
      }).catch((error: unknown) => {
        throw new NetworkError(`RPC transport failure: ${describe(error)}`, { url: this.url }, error);
      }),
      timeoutMs ?? this.options.timeoutMs,
      `rpc:${requests.map((r) => r.method).join(',')}`,
    );

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new RpcError(`RPC HTTP ${response.status}`, retryable, {
        url: this.url,
        status: response.status,
      });
    }

    const json = (await response.json().catch((error: unknown) => {
      throw new RpcError(`RPC returned invalid JSON: ${describe(error)}`, true, { url: this.url });
    })) as JsonRpcResponse<unknown> | JsonRpcResponse<unknown>[];

    const list = Array.isArray(json) ? json : [json];
    const byId = new Map(list.map((entry) => [entry.id, entry]));

    return payload.map((sent) => {
      const entry = byId.get(sent.id) ?? list.shift();
      if (!entry) {
        throw new RpcError(`RPC response missing result for ${sent.method}`, true, { url: this.url });
      }
      if (entry.error) {
        throw new RpcError(`RPC error ${entry.error.code}: ${entry.error.message}`, RETRYABLE_RPC_CODES.has(entry.error.code), {
          url: this.url,
          method: sent.method,
          code: entry.error.code,
          data: entry.error.data,
        });
      }
      return entry.result;
    }) as T;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
