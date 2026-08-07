import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseError } from '../../core/errors.js';
import type { BaseRow, QueryFilter, QueryOptions, TableName } from '../types.js';
import { TABLES } from '../types.js';
import type { StorageDriver } from '../driver.js';

/** Structural subset of better-sqlite3 that this driver relies on. */
interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
  pragma(source: string): unknown;
}

/**
 * SQLite driver for high-volume deployments.
 *
 * Rows are stored as a JSON document plus two indexed columns (`id`, `ts`);
 * arbitrary field filters compile to `json_extract` predicates. That keeps the
 * schema stable as domain rows evolve — a new field on TradeRow needs no
 * migration — while still giving real indexes on the two dimensions every
 * query actually uses.
 *
 * `better-sqlite3` is an optional dependency and is imported lazily, so the
 * bot runs without a native toolchain unless this driver is selected.
 */
export class SqliteDriver implements StorageDriver {
  readonly name = 'sqlite';
  private db: SqliteDatabase | undefined;

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    let Database: new (path: string) => SqliteDatabase;
    try {
      // Untyped dynamic import: better-sqlite3 is optional, so the build must
      // not require its type declarations to be present.
      const module = (await import(/* @vite-ignore */ 'better-sqlite3' as string)) as {
        default: new (path: string) => SqliteDatabase;
      };
      Database = module.default;
    } catch (error) {
      throw new DatabaseError(
        'DB_DRIVER=sqlite requires the optional dependency "better-sqlite3". ' +
          'Install it (npm i better-sqlite3) or switch to DB_DRIVER=file.',
        { path: this.path },
        error,
      );
    }

    this.db = new Database(this.path);
    // WAL keeps the writer from blocking dashboard reads.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    for (const table of TABLES) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (
           id TEXT PRIMARY KEY,
           ts INTEGER NOT NULL,
           data TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_${table}_ts ON ${table}(ts);`,
      );
    }
  }

  async insert<T extends BaseRow>(table: TableName, row: T): Promise<void> {
    this.handle()
      .prepare(`INSERT OR REPLACE INTO ${table} (id, ts, data) VALUES (?, ?, ?)`)
      .run(row.id, row.ts, JSON.stringify(row));
  }

  async insertMany<T extends BaseRow>(table: TableName, rows: readonly T[]): Promise<void> {
    if (rows.length === 0) return;
    const statement = this.handle().prepare(
      `INSERT OR REPLACE INTO ${table} (id, ts, data) VALUES (?, ?, ?)`,
    );
    const insertAll = this.handle().transaction((batch: readonly T[]) => {
      for (const row of batch) statement.run(row.id, row.ts, JSON.stringify(row));
    });
    insertAll(rows as never);
  }

  async update<T extends BaseRow>(table: TableName, id: string, patch: Partial<T>): Promise<boolean> {
    const existing = await this.get<T>(table, id);
    if (!existing) return false;
    const merged = { ...existing, ...patch };
    this.handle()
      .prepare(`UPDATE ${table} SET ts = ?, data = ? WHERE id = ?`)
      .run(merged.ts, JSON.stringify(merged), id);
    return true;
  }

  async upsert<T extends BaseRow>(table: TableName, row: T): Promise<void> {
    const existing = await this.get<T>(table, row.id);
    await this.insert(table, existing ? ({ ...existing, ...row } as T) : row);
  }

  async get<T extends BaseRow>(table: TableName, id: string): Promise<T | undefined> {
    const found = this.handle().prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;
    return found ? (JSON.parse(found.data) as T) : undefined;
  }

  async find<T extends BaseRow>(table: TableName, options?: QueryOptions): Promise<T[]> {
    const { clause, params } = buildWhere(options?.where);
    const order = options?.orderBy
      ? `ORDER BY ${columnExpr(options.orderBy.field)} ${options.orderBy.dir === 'desc' ? 'DESC' : 'ASC'}`
      : '';
    const limit = options?.limit !== undefined ? `LIMIT ${Number(options.limit)}` : '';
    const offset = options?.offset ? `OFFSET ${Number(options.offset)}` : '';

    const rows = this.handle()
      .prepare(`SELECT data FROM ${table} ${clause} ${order} ${limit} ${offset}`.trim())
      .all(...params) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  async count(table: TableName, options?: QueryOptions): Promise<number> {
    const { clause, params } = buildWhere(options?.where);
    const row = this.handle()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} ${clause}`.trim())
      .get(...params) as { n: number };
    return row?.n ?? 0;
  }

  async delete(table: TableName, id: string): Promise<boolean> {
    return this.handle().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  }

  async deleteWhere(table: TableName, options: QueryOptions): Promise<number> {
    const { clause, params } = buildWhere(options.where);
    if (!clause) throw new DatabaseError('deleteWhere requires at least one filter', { table });
    return this.handle().prepare(`DELETE FROM ${table} ${clause}`).run(...params).changes;
  }

  async flush(): Promise<void> {
    // better-sqlite3 writes synchronously.
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  private handle(): SqliteDatabase {
    if (!this.db) throw new DatabaseError('SQLite driver used before init()', { path: this.path });
    return this.db;
  }
}

/** `id`/`ts` hit real indexes; everything else goes through json_extract. */
function columnExpr(field: string): string {
  if (field === 'id' || field === 'ts') return field;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new DatabaseError(`Unsafe field name in query: ${field}`, { field });
  }
  return `json_extract(data, '$.${field}')`;
}

function buildWhere(filters?: readonly QueryFilter[]): { clause: string; params: unknown[] } {
  if (!filters || filters.length === 0) return { clause: '', params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];

  for (const filter of filters) {
    const column = columnExpr(filter.field);
    switch (filter.op) {
      case 'eq':
        parts.push(`${column} = ?`);
        params.push(normalize(filter.value));
        break;
      case 'ne':
        parts.push(`${column} != ?`);
        params.push(normalize(filter.value));
        break;
      case 'gt':
        parts.push(`${column} > ?`);
        params.push(normalize(filter.value));
        break;
      case 'gte':
        parts.push(`${column} >= ?`);
        params.push(normalize(filter.value));
        break;
      case 'lt':
        parts.push(`${column} < ?`);
        params.push(normalize(filter.value));
        break;
      case 'lte':
        parts.push(`${column} <= ?`);
        params.push(normalize(filter.value));
        break;
      case 'in': {
        const values = (filter.value as readonly unknown[]) ?? [];
        if (values.length === 0) {
          parts.push('0 = 1');
          break;
        }
        parts.push(`${column} IN (${values.map(() => '?').join(', ')})`);
        params.push(...values.map(normalize));
        break;
      }
      case 'contains':
        parts.push(`${column} LIKE ?`);
        params.push(`%${String(filter.value)}%`);
        break;
    }
  }
  return { clause: `WHERE ${parts.join(' AND ')}`, params };
}

/** SQLite has no boolean type; JSON booleans come back as 0/1. */
function normalize(value: unknown): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}
