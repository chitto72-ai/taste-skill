import { WebSocket } from 'ws';
import { clamp } from '../../core/utils/math.js';
import type { Logger } from '../../logger/logger.js';
import type { ExchangeConfig } from '../../config/schema.js';

export type StreamHandler = (channel: string, payload: unknown) => void;

/**
 * Market-data websocket with automatic reconnection.
 *
 * Reconnect logic is exponential with jitter and — importantly —
 * re-subscribes on every open. A silent reconnect that loses subscriptions is
 * worse than a visible disconnect: the bot would keep running against frozen
 * prices, which is exactly the state where stops do not fire.
 */
export class AxiomStream {
  private socket: WebSocket | undefined;
  private readonly subscriptions = new Set<string>();
  private readonly handlers = new Set<StreamHandler>();
  private readonly logger: Logger;
  private reconnectAttempt = 0;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private lastMessageAt = 0;

  constructor(
    private readonly config: ExchangeConfig['axiom'],
    logger: Logger,
  ) {
    this.logger = logger.child('axiom:stream');
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get staleMs(): number {
    return this.lastMessageAt === 0 ? 0 : Date.now() - this.lastMessageAt;
  }

  onMessage(handler: StreamHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribe(channel: string): void {
    this.subscriptions.add(channel);
    if (this.connected) this.send({ op: 'subscribe', channel });
  }

  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this.connected) this.send({ op: 'unsubscribe', channel });
  }

  async connect(): Promise<void> {
    this.closing = false;
    await this.open();
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), 15_000);
    this.heartbeatTimer.unref?.();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private open(): Promise<void> {
    return new Promise((resolve) => {
      const headers = this.config.apiKey ? { 'x-api-key': this.config.apiKey } : undefined;
      const socket = new WebSocket(this.config.wsUrl, { headers });
      this.socket = socket;

      socket.on('open', () => {
        this.reconnectAttempt = 0;
        this.lastMessageAt = Date.now();
        this.logger.info({ url: redact(this.config.wsUrl) }, 'market data socket connected');
        for (const channel of this.subscriptions) this.send({ op: 'subscribe', channel });
        resolve();
      });

      socket.on('message', (data) => {
        this.lastMessageAt = Date.now();
        try {
          const parsed = JSON.parse(data.toString()) as { channel?: string; data?: unknown };
          const channel = parsed.channel ?? 'unknown';
          for (const handler of this.handlers) handler(channel, parsed.data ?? parsed);
        } catch (error) {
          this.logger.debug({ err: error }, 'unparseable stream message');
        }
      });

      socket.on('error', (error) => {
        this.logger.warn({ err: error }, 'market data socket error');
      });

      socket.on('close', (code) => {
        if (this.closing) return;
        this.logger.warn({ code }, 'market data socket closed, scheduling reconnect');
        this.scheduleReconnect();
        // Resolve anyway: startup must not block on a venue being reachable.
        resolve();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectAttempt++;
    const base = Math.min(this.config.reconnectMaxMs, 500 * 2 ** this.reconnectAttempt);
    const delay = clamp(base * (0.5 + Math.random() * 0.5), 500, this.config.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** A socket that stops sending is indistinguishable from a dead market. */
  private checkHeartbeat(): void {
    if (!this.connected || this.closing) return;
    if (this.staleMs > 60_000) {
      this.logger.warn({ staleMs: this.staleMs }, 'no stream messages, forcing reconnect');
      this.socket?.terminate();
    } else {
      this.send({ op: 'ping', ts: Date.now() });
    }
  }

  private send(payload: unknown): void {
    if (!this.connected) return;
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch (error) {
      this.logger.debug({ err: error }, 'failed to send on stream');
    }
  }
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}
