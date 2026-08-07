import type { BaseRow, QueryOptions, TableName } from './types.js';

/**
 * Storage port. Three implementations ship with the bot (memory, append-only
 * file, SQLite) and they are interchangeable — repositories and everything
 * above them are written against this interface only.
 */
export interface StorageDriver {
  readonly name: string;
  init(): Promise<void>;
  insert<T extends BaseRow>(table: TableName, row: T): Promise<void>;
  insertMany<T extends BaseRow>(table: TableName, rows: readonly T[]): Promise<void>;
  update<T extends BaseRow>(table: TableName, id: string, patch: Partial<T>): Promise<boolean>;
  upsert<T extends BaseRow>(table: TableName, row: T): Promise<void>;
  get<T extends BaseRow>(table: TableName, id: string): Promise<T | undefined>;
  find<T extends BaseRow>(table: TableName, options?: QueryOptions): Promise<T[]>;
  count(table: TableName, options?: QueryOptions): Promise<number>;
  delete(table: TableName, id: string): Promise<boolean>;
  deleteWhere(table: TableName, options: QueryOptions): Promise<number>;
  /** Persist buffered writes; a no-op for drivers that write synchronously. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Shared predicate evaluation so every driver filters identically. */
export function matchesFilters(row: Record<string, unknown>, options?: QueryOptions): boolean {
  if (!options?.where || options.where.length === 0) return true;
  return options.where.every((filter) => {
    const value = row[filter.field];
    switch (filter.op) {
      case 'eq':
        return value === filter.value;
      case 'ne':
        return value !== filter.value;
      case 'gt':
        return typeof value === 'number' && value > (filter.value as number);
      case 'gte':
        return typeof value === 'number' && value >= (filter.value as number);
      case 'lt':
        return typeof value === 'number' && value < (filter.value as number);
      case 'lte':
        return typeof value === 'number' && value <= (filter.value as number);
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'contains':
        return typeof value === 'string' && value.includes(String(filter.value));
      default:
        return false;
    }
  });
}

export function applyQuery<T extends BaseRow>(rows: readonly T[], options?: QueryOptions): T[] {
  let result = rows.filter((row) => matchesFilters(row as Record<string, unknown>, options));

  if (options?.orderBy) {
    const { field, dir } = options.orderBy;
    const sign = dir === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const left = (a as Record<string, unknown>)[field];
      const right = (b as Record<string, unknown>)[field];
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
      return String(left).localeCompare(String(right)) * sign;
    });
  }

  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? result.length;
  return result.slice(offset, offset + limit);
}
