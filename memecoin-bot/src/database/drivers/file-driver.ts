import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseError } from '../../core/errors.js';
import type { BaseRow, TableName } from '../types.js';
import { TABLES } from '../types.js';
import { MemoryDriver } from './memory-driver.js';

/**
 * Durable driver with no native dependencies: the whole dataset lives in
 * memory and is snapshotted to a JSON file.
 *
 * This is the default because it survives restarts, needs no build toolchain,
 * and a memecoin bot's write volume (thousands of rows per day, not millions)
 * fits comfortably. Snapshots are written to a temp file and renamed, so a
 * crash mid-write leaves the previous snapshot intact rather than a truncated
 * one. For higher volumes, switch `DB_DRIVER=sqlite`.
 */
export class FileDriver extends MemoryDriver {
  override readonly name = 'file';
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly flushIntervalMs = 5_000,
  ) {
    super();
  }

  override async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) await this.load();
    this.timer = setInterval(() => {
      if (this.dirty) void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  override async flush(): Promise<void> {
    if (!this.dirty) return await this.writing;
    this.dirty = false;
    this.writing = this.writing.then(() => this.snapshot()).catch((error) => {
      // Re-arm so the next tick retries rather than silently losing the write.
      this.dirty = true;
      throw new DatabaseError('Failed to write database snapshot', { path: this.path }, error);
    });
    return this.writing;
  }

  override async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
    await super.close();
  }

  protected override onMutate(): void {
    this.dirty = true;
  }

  private async snapshot(): Promise<void> {
    const payload: Record<string, BaseRow[]> = {};
    for (const name of TABLES) payload[name] = [...this.table(name).values()];
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), tables: payload }), 'utf8');
    await rename(tmp, this.path);
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      if (raw.trim() === '') return;
      const parsed = JSON.parse(raw) as { tables?: Record<string, BaseRow[]> };
      for (const [name, rows] of Object.entries(parsed.tables ?? {})) {
        const target = this.table(name as TableName);
        for (const row of rows) target.set(row.id, row);
      }
    } catch (error) {
      throw new DatabaseError(
        `Database snapshot at ${this.path} is corrupt; move it aside to start fresh`,
        { path: this.path },
        error,
      );
    }
  }
}
