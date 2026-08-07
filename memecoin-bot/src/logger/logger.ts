import { AppError } from '../core/errors.js';
import { redact } from './redact.js';
import { JsonStdoutSink, MemorySink, PrettyStdoutSink } from './sinks.js';
import { LEVEL_ORDER, type LogLevel, type LogRecord, type LogSink } from './types.js';

export type LogContext = Record<string, unknown> & { err?: unknown };

export interface Logger {
  readonly component: string;
  level: LogLevel;
  trace(context: LogContext | string, msg?: string): void;
  debug(context: LogContext | string, msg?: string): void;
  info(context: LogContext | string, msg?: string): void;
  warn(context: LogContext | string, msg?: string): void;
  error(context: LogContext | string, msg?: string): void;
  fatal(context: LogContext | string, msg?: string): void;
  /** Derives a logger that tags every record with a component + base context. */
  child(component: string, context?: Record<string, unknown>): Logger;
  addSink(sink: LogSink): void;
  removeSink(name: string): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly component?: string;
  readonly format?: 'pretty' | 'json';
  readonly sinks?: LogSink[];
  readonly base?: Record<string, unknown>;
  /** Disable secret scrubbing (tests only — never in production). */
  readonly redactSecrets?: boolean;
}

class LoggerImpl implements Logger {
  level: LogLevel;
  readonly component: string;
  private readonly base: Record<string, unknown>;
  private readonly sinks: LogSink[];
  private readonly shouldRedact: boolean;

  constructor(options: LoggerOptions & { sinks: LogSink[] }) {
    this.level = options.level ?? 'info';
    this.component = options.component ?? 'app';
    this.base = options.base ?? {};
    this.sinks = options.sinks;
    this.shouldRedact = options.redactSecrets ?? true;
  }

  trace(context: LogContext | string, msg?: string): void {
    this.log('trace', context, msg);
  }
  debug(context: LogContext | string, msg?: string): void {
    this.log('debug', context, msg);
  }
  info(context: LogContext | string, msg?: string): void {
    this.log('info', context, msg);
  }
  warn(context: LogContext | string, msg?: string): void {
    this.log('warn', context, msg);
  }
  error(context: LogContext | string, msg?: string): void {
    this.log('error', context, msg);
  }
  fatal(context: LogContext | string, msg?: string): void {
    this.log('fatal', context, msg);
  }

  child(component: string, context: Record<string, unknown> = {}): Logger {
    const child = new LoggerImpl({
      level: this.level,
      component,
      base: { ...this.base, ...context },
      sinks: this.sinks,
      redactSecrets: this.shouldRedact,
    });
    return child;
  }

  addSink(sink: LogSink): void {
    if (!this.sinks.some((s) => s.name === sink.name)) this.sinks.push(sink);
  }

  removeSink(name: string): void {
    const index = this.sinks.findIndex((s) => s.name === name);
    if (index >= 0) this.sinks.splice(index, 1);
  }

  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.flush?.()));
  }

  async close(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.close?.()));
  }

  private log(level: Exclude<LogLevel, 'silent'>, context: LogContext | string, msg?: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    const rawContext = typeof context === 'string' ? {} : { ...context };
    const message = typeof context === 'string' ? context : (msg ?? '');
    const errorValue = rawContext.err;
    delete rawContext.err;

    const merged = { ...this.base, ...rawContext };
    const record: LogRecord = {
      level,
      time: Date.now(),
      msg: message,
      component: this.component,
      context: this.shouldRedact ? redact(merged) : merged,
      err: errorValue ? serializeError(errorValue, this.shouldRedact) : undefined,
    };

    for (const sink of this.sinks) {
      try {
        sink.write(record);
      } catch {
        // Never let logging failures propagate into trading logic.
      }
    }
  }
}

function serializeError(value: unknown, shouldRedact: boolean): LogRecord['err'] {
  if (value instanceof AppError) {
    const out = {
      name: value.name,
      message: value.message,
      code: value.code,
      stack: value.stack,
    };
    return shouldRedact ? redact(out) : out;
  }
  if (value instanceof Error) {
    const out = { name: value.name, message: value.message, stack: value.stack };
    return shouldRedact ? redact(out) : out;
  }
  return { name: 'NonError', message: String(value) };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sinks =
    options.sinks ?? [options.format === 'json' ? new JsonStdoutSink() : new PrettyStdoutSink()];
  return new LoggerImpl({ ...options, sinks });
}

/** Discards everything — used by unit tests that assert on behaviour, not logs. */
export function createNullLogger(): Logger {
  return new LoggerImpl({ level: 'silent', sinks: [] });
}

/** Logger backed by an inspectable ring buffer, for assertions in tests. */
export function createTestLogger(): { logger: Logger; sink: MemorySink } {
  const sink = new MemorySink(500);
  return { logger: new LoggerImpl({ level: 'trace', sinks: [sink] }), sink };
}
