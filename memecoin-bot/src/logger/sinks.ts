import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LogRecord, LogSink } from './types.js';

const ESC = '\u001b';
const COLORS: Record<string, string> = {
  trace: `${ESC}[90m`,
  debug: `${ESC}[36m`,
  info: `${ESC}[32m`,
  warn: `${ESC}[33m`,
  error: `${ESC}[31m`,
  fatal: `${ESC}[35m`,
};
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;

function serialize(record: LogRecord): string {
  return JSON.stringify({
    level: record.level,
    time: record.time,
    component: record.component,
    msg: record.msg,
    ...record.context,
    ...(record.err ? { err: record.err } : {}),
  });
}

/** Newline-delimited JSON on stdout — the shape log shippers expect. */
export class JsonStdoutSink implements LogSink {
  readonly name = 'stdout-json';

  write(record: LogRecord): void {
    process.stdout.write(`${serialize(record)}\n`);
  }
}

/** Human-readable output for local development. */
export class PrettyStdoutSink implements LogSink {
  readonly name = 'stdout-pretty';

  constructor(private readonly useColor = process.stdout.isTTY === true) {}

  write(record: LogRecord): void {
    const time = new Date(record.time).toISOString().slice(11, 23);
    const level = record.level.toUpperCase().padEnd(5);
    const color = this.useColor ? (COLORS[record.level] ?? '') : '';
    const reset = this.useColor ? RESET : '';
    const dim = this.useColor ? DIM : '';

    const keys = Object.keys(record.context);
    const context =
      keys.length > 0
        ? ` ${dim}${keys.map((k) => `${k}=${format(record.context[k])}`).join(' ')}${reset}`
        : '';
    const error = record.err ? `\n    ${color}${record.err.name}: ${record.err.message}${reset}` : '';

    process.stdout.write(
      `${dim}${time}${reset} ${color}${level}${reset} ${dim}[${record.component}]${reset} ${record.msg}${context}${error}\n`,
    );
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(6);
  return String(value);
}

/** Buffered NDJSON file sink; flushes on an interval and on close. */
export class FileSink implements LogSink {
  readonly name = 'file';
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private ready: Promise<void> | undefined;

  constructor(
    private readonly path: string,
    private readonly flushMs = 1000,
    private readonly maxBuffer = 500,
  ) {}

  write(record: LogRecord): void {
    this.buffer.push(serialize(record));
    if (this.buffer.length >= this.maxBuffer) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.buffer.length === 0) return;
    const chunk = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    this.ready ??= mkdir(dirname(this.path), { recursive: true }).then(() => undefined);
    await this.ready;
    await appendFile(this.path, chunk, 'utf8');
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/** In-memory ring buffer powering `GET /api/logs` and the dashboard tail. */
export class MemorySink implements LogSink {
  readonly name = 'memory';
  private readonly records: LogRecord[] = [];

  constructor(private readonly capacity = 1000) {}

  write(record: LogRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
  }

  tail(limit = 100, minLevel?: LogRecord['level']): LogRecord[] {
    const filtered = minLevel ? this.records.filter((r) => r.level === minLevel) : this.records;
    return filtered.slice(-limit);
  }

  clear(): void {
    this.records.length = 0;
  }
}

/** Bridges log records into an arbitrary consumer (DB writer, websocket). */
export class CallbackSink implements LogSink {
  readonly name: string;

  constructor(
    name: string,
    private readonly fn: (record: LogRecord) => void,
  ) {
    this.name = name;
  }

  write(record: LogRecord): void {
    try {
      this.fn(record);
    } catch {
      // A failing sink must never break the caller's control flow.
    }
  }
}
