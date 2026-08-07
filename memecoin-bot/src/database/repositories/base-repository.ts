import type { StorageDriver } from '../driver.js';
import type { BaseRow, QueryFilter, QueryOptions, TableName } from '../types.js';

/** Thin, typed wrapper over the driver; every repository extends it. */
export abstract class BaseRepository<T extends BaseRow> {
  constructor(
    protected readonly driver: StorageDriver,
    protected readonly table: TableName,
  ) {}

  async insert(row: T): Promise<T> {
    await this.driver.insert(this.table, row);
    return row;
  }

  async insertMany(rows: readonly T[]): Promise<void> {
    await this.driver.insertMany(this.table, rows);
  }

  async upsert(row: T): Promise<void> {
    await this.driver.upsert(this.table, row);
  }

  async update(id: string, patch: Partial<T>): Promise<boolean> {
    return this.driver.update(this.table, id, patch);
  }

  async byId(id: string): Promise<T | undefined> {
    return this.driver.get<T>(this.table, id);
  }

  async find(options?: QueryOptions): Promise<T[]> {
    return this.driver.find<T>(this.table, options);
  }

  async findOne(where: readonly QueryFilter[]): Promise<T | undefined> {
    const [row] = await this.driver.find<T>(this.table, { where, limit: 1 });
    return row;
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.driver.count(this.table, options);
  }

  async delete(id: string): Promise<boolean> {
    return this.driver.delete(this.table, id);
  }

  /** Retention pruning; returns the number of rows removed. */
  async pruneOlderThan(timestamp: number): Promise<number> {
    return this.driver.deleteWhere(this.table, { where: [{ field: 'ts', op: 'lt', value: timestamp }] });
  }

  async recent(limit = 100): Promise<T[]> {
    return this.driver.find<T>(this.table, { orderBy: { field: 'ts', dir: 'desc' }, limit });
  }
}
