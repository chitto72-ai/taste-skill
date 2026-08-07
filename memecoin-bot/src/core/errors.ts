/**
 * Error taxonomy. Everything thrown inside the bot should end up as an
 * `AppError` so the retry layer can tell "try again" from "give up", and so the
 * error repository stores a stable `code` instead of a message string.
 */

export type ErrorCategory =
  | 'config'
  | 'network'
  | 'rpc'
  | 'exchange'
  | 'wallet'
  | 'strategy'
  | 'risk'
  | 'database'
  | 'validation'
  | 'internal';

export interface AppErrorOptions {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable?: boolean;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;
  readonly at: number;

  constructor(message: string, opts: AppErrorOptions) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code;
    this.category = opts.category;
    this.retryable = opts.retryable ?? false;
    this.context = opts.context ?? {};
    this.at = Date.now();
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      context: this.context,
      at: this.at,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'CONFIG_INVALID', category: 'config', context, cause });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'VALIDATION_FAILED', category: 'validation', context });
  }
}

export class NetworkError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, {
      code: 'NETWORK_FAILURE',
      category: 'network',
      retryable: true,
      context,
      cause,
    });
  }
}

export class RpcError extends AppError {
  constructor(message: string, retryable = true, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'RPC_FAILURE', category: 'rpc', retryable, context, cause });
  }
}

export class ExchangeError extends AppError {
  constructor(message: string, retryable = false, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'EXCHANGE_FAILURE', category: 'exchange', retryable, context, cause });
  }
}

export class InsufficientLiquidityError extends AppError {
  constructor(context?: Record<string, unknown>) {
    super('Insufficient liquidity to fill order within slippage budget', {
      code: 'INSUFFICIENT_LIQUIDITY',
      category: 'exchange',
      retryable: false,
      context,
    });
  }
}

export class WalletError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'WALLET_FAILURE', category: 'wallet', context, cause });
  }
}

export class RiskRejectionError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'RISK_REJECTED', category: 'risk', context });
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'DATABASE_FAILURE', category: 'database', context, cause });
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, ms: number) {
    super(`Operation "${operation}" timed out after ${ms}ms`, {
      code: 'TIMEOUT',
      category: 'network',
      retryable: true,
      context: { operation, ms },
    });
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.retryable;
  if (err instanceof Error) {
    // Node/undici transient socket failures.
    const code = (err as NodeJS.ErrnoException).code ?? '';
    return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'].includes(
      code,
    );
  }
  return false;
}

export function toAppError(err: unknown, fallbackCode = 'UNEXPECTED'): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(message, {
    code: fallbackCode,
    category: 'internal',
    retryable: isRetryable(err),
    cause: err,
  });
}
