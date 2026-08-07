import type { BaseRow, QueryOptions, TableName } from '../types.js';
import { TABLES } from '../types.js';
import { applyQuery, matchesFilters, type StorageDriver } from '../driver.js';

/**
 * In-memory driver. Used by unit tests, backtests and `DB_DRIVER=memory`,
 * and also serves as the write-through cache for the file driver.
 */
export class MemoryDriver implements StorageDriver {
  readonly name: string = 'memory';
  protected readonly tables = new Map<TableName, Map<string, BaseRow>>();

  constructor() {
    for (const table of TABLES) this.tables.set(table, new Map());
  }

  async init(): Promise<void> {
    // Nothing to prepare; tables are created in the constructor.
  }

  async insert<T extends BaseRow>(table: TableName, row: T): Promise<void> {
    this.table(table).set(row.id, structuredClone(row));
    this.onMutate(table);
  }

  async insertMany<T extends BaseRow>(table: TableName, rows: readonly T[]): Promise<void> {
    const target = this.table(table);
    for (const row of rows) target.set(row.id, structuredClone(row));
    if (rows.length > 0) this.onMutate(table);
  }

  async update<T extends BaseRow>(table: TableName, id: string, patch: Partial<T>): Promise<boolean> {
    const target = this.table(table);
    const existing = target.get(id);
    if (!existing) return false;
    target.set(id, { ...existing, ...structuredClone(patch) } as BaseRow);
    this.onMutate(table);
    return true;
  }

  async upsert<T extends BaseRow>(table: TableName, row: T): Promise<void> {
    const target = this.table(table);
    const existing = target.get(row.id);
    target.set(row.id, existing ? ({ ...existing, ...structuredClone(row) } as BaseRow) : structuredClone(row));
    this.onMutate(table);
  }

  async get<T extends BaseRow>(table: TableName, id: string): Promise<T | undefined> {
    const row = this.table(table).get(id);
    return row ? (structuredClone(row) as T) : undefined;
  }

  async find<T extends BaseRow>(table: TableName, options?: QueryOptions): Promise<T[]> {
    const rows = [...this.table(table).values()] as T[];
    return applyQuery(rows, options).map((row) => structuredClone(row));
  }

  async count(table: TableName, options?: QueryOptions): Promise<number> {
    if (!options?.where?.length) return this.table(table).size;
    let total = 0;
    for (const row of this.table(table).values()) {
      if (matchesFilters(row as unknown as Record<string, unknown>, options)) total++;
    }
    return total;
  }

  async delete(table: TableName, id: string): Promise<boolean> {
    const deleted = this.table(table).delete(id);
    if (deleted) this.onMutate(table);
    return deleted;
  }

  async deleteWhere(table: TableName, options: QueryOptions): Promise<number> {
    const target = this.table(table);
    let removed = 0;
    for (const [id, row] of [...target]) {
      if (matchesFilters(row as unknown as Record<string, unknown>, options)) {
        target.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.onMutate(table);
    return removed;
  }

  async flush(): Promise<void> {
    // No durable backing store.
  }

  async close(): Promise<void> {
    for (const table of this.tables.values()) table.clear();
  }

  /** Row counts per table — surfaced on the dashboard's storage panel. */
  sizes(): Record<string, number> {
    return Object.fromEntries([...this.tables].map(([name, rows]) => [name, rows.size]));
  }

  /** Hook for subclasses that persist. */
  protected onMutate(_table: TableName): void {
    // Intentionally empty in the pure in-memory driver.
  }

  protected table(name: TableName): Map<string, BaseRow> {
    const table = this.tables.get(name);
    if (table) return table;
    const created = new Map<string, BaseRow>();
    this.tables.set(name, created);
    return created;
  }
}
