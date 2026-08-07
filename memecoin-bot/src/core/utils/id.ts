import { randomUUID, randomBytes } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

/**
 * Monotonic, sortable id: base36 timestamp + randomness. Sorting trade ids
 * lexicographically therefore sorts them chronologically, which the analytics
 * and file-driver layers rely on.
 */
export function shortId(prefix?: string): string {
  const id = `${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
  return prefix ? `${prefix}_${id}` : id;
}

export function clientOrderId(): string {
  return shortId('ord');
}

export function positionId(): string {
  return shortId('pos');
}

export function tradeId(): string {
  return shortId('trd');
}

export function signalId(): string {
  return shortId('sig');
}
