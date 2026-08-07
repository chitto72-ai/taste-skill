import { AppError, toAppError } from './errors.js';

/**
 * Lightweight Result type used on hot paths (order execution, RPC calls) where
 * throwing for expected outcomes — a rejected order, a failed simulation — is
 * both slow and semantically wrong.
 */
export type Result<T, E extends Error = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

export function unwrapOr<T, E extends Error>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function mapResult<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T, AppError>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(toAppError(error));
  }
}
