export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

export interface LogRecord {
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly time: number;
  readonly msg: string;
  readonly component: string;
  readonly context: Record<string, unknown>;
  readonly err?: {
    readonly message: string;
    readonly name: string;
    readonly code?: string;
    readonly stack?: string;
  };
}

/** Destination for log records: stdout, database, websocket, test buffer. */
export interface LogSink {
  readonly name: string;
  write(record: LogRecord): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}
