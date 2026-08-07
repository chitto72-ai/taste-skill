import type { OrderRequest, OrderResult } from '../../core/domain/trading.js';
import { AppError, toAppError } from '../../core/errors.js';
import type { LogRecord } from '../../logger/types.js';
import { shortId } from '../../core/utils/id.js';
import type { StorageDriver } from '../driver.js';
import { eq, gte, type ErrorRow, type LogRow, type OrderRow } from '../types.js';
import { BaseRepository } from './base-repository.js';

export class OrderRepository extends BaseRepository<OrderRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'orders');
  }

  async record(request: OrderRequest, result: OrderResult, venue: string): Promise<void> {
    await this.insert({
      id: request.clientOrderId,
      ts: result.submittedAt,
      clientOrderId: request.clientOrderId,
      positionId: request.positionId,
      chain: String(request.token.chain),
      tokenAddress: request.token.address,
      side: request.side,
      status: result.status,
      requestedAmount: request.amount,
      filledQty: result.filledQty,
      filledQuote: result.filledQuote,
      avgPrice: result.avgPrice,
      feeQuote: result.feeQuote,
      gasUsd: result.gasUsd,
      slippageBps: result.slippageBps,
      txHash: result.txHash,
      venue,
      reason: request.reason,
      error: result.error,
    });
  }

  async forPosition(positionId: string): Promise<OrderRow[]> {
    return this.find({ where: [eq('positionId', positionId)], orderBy: { field: 'ts', dir: 'asc' } });
  }

  async failedSince(timestamp: number): Promise<OrderRow[]> {
    return this.find({ where: [gte('ts', timestamp), eq('status', 'rejected')] });
  }
}

export class ErrorRepository extends BaseRepository<ErrorRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'errors');
  }

  async record(error: unknown, component: string): Promise<void> {
    const appError: AppError = toAppError(error);
    await this.insert({
      id: shortId('err'),
      ts: appError.at ?? Date.now(),
      code: appError.code,
      category: appError.category,
      component,
      message: appError.message,
      retryable: appError.retryable,
      context: JSON.stringify(appError.context ?? {}),
      stack: appError.stack,
    });
  }

  async byCode(code: string, limit = 100): Promise<ErrorRow[]> {
    return this.find({ where: [eq('code', code)], orderBy: { field: 'ts', dir: 'desc' }, limit });
  }

  /** Error counts by code since a timestamp — the health endpoint's summary. */
  async summarySince(timestamp: number): Promise<Record<string, number>> {
    const rows = await this.find({ where: [gte('ts', timestamp)] });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.code] = (counts[row.code] ?? 0) + 1;
    return counts;
  }
}

export class LogRepository extends BaseRepository<LogRow> {
  constructor(driver: StorageDriver) {
    super(driver, 'logs');
  }

  async record(record: LogRecord): Promise<void> {
    await this.insert({
      id: shortId('log'),
      ts: record.time,
      level: record.level,
      component: record.component,
      msg: record.msg,
      context: JSON.stringify({ ...record.context, ...(record.err ? { err: record.err } : {}) }),
    });
  }

  async tail(limit = 200, level?: string): Promise<LogRow[]> {
    return this.find({
      where: level ? [eq('level', level)] : undefined,
      orderBy: { field: 'ts', dir: 'desc' },
      limit,
    });
  }
}
