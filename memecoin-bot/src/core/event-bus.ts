import type { AnyEventHandler, EventHandler, EventMap, EventName } from './events.js';

export interface Subscription {
  unsubscribe(): void;
}

export interface EventBusOptions {
  /** Invoked when a handler throws; must never throw itself. */
  onHandlerError?: (name: EventName, error: unknown) => void;
  /** Warn when a single dispatch exceeds this budget (ms). */
  slowHandlerMs?: number;
  onSlowHandler?: (name: EventName, ms: number) => void;
}

interface Registration {
  handler: (payload: unknown) => void | Promise<void>;
  once: boolean;
}

export interface EventBusStats {
  readonly published: number;
  readonly handlerErrors: number;
  readonly byEvent: Readonly<Record<string, number>>;
}

/**
 * Typed async event bus.
 *
 * Two dispatch modes on purpose:
 *  - `emit()` is fire-and-forget and never lets a slow subscriber (the DB
 *    writer, the websocket fan-out) stall the trading loop.
 *  - `emitAndWait()` is used where ordering matters, e.g. risk state must be
 *    updated before the next entry is evaluated.
 *
 * Handler exceptions are always isolated: one broken subscriber cannot take
 * down a publish, which in a trading loop is the difference between a logged
 * error and an unmanaged open position.
 */
export class EventBus {
  private readonly handlers = new Map<EventName, Set<Registration>>();
  private readonly wildcards = new Set<AnyEventHandler>();
  private published = 0;
  private handlerErrors = 0;
  private readonly counts = new Map<string, number>();

  constructor(private readonly options: EventBusOptions = {}) {}

  on<K extends EventName>(name: K, handler: EventHandler<K>): Subscription {
    return this.register(name, handler as Registration['handler'], false);
  }

  once<K extends EventName>(name: K, handler: EventHandler<K>): Subscription {
    return this.register(name, handler as Registration['handler'], true);
  }

  onAny(handler: AnyEventHandler): Subscription {
    this.wildcards.add(handler);
    return { unsubscribe: () => this.wildcards.delete(handler) };
  }

  /** Resolves on the first matching event, or rejects on timeout. */
  waitFor<K extends EventName>(
    name: K,
    predicate: (payload: EventMap[K]) => boolean = () => true,
    timeoutMs = 30_000,
  ): Promise<EventMap[K]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`Timed out waiting for event "${String(name)}"`));
      }, timeoutMs);
      timer.unref?.();
      const sub = this.on(name, (payload) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(payload);
      });
    });
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    void this.dispatch(name, payload, false);
  }

  emitAndWait<K extends EventName>(name: K, payload: EventMap[K]): Promise<void> {
    return this.dispatch(name, payload, true);
  }

  listenerCount(name: EventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  stats(): EventBusStats {
    return {
      published: this.published,
      handlerErrors: this.handlerErrors,
      byEvent: Object.fromEntries(this.counts),
    };
  }

  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcards.clear();
  }

  private register(
    name: EventName,
    handler: Registration['handler'],
    once: boolean,
  ): Subscription {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const registration: Registration = { handler, once };
    set.add(registration);
    return {
      unsubscribe: () => {
        set?.delete(registration);
      },
    };
  }

  private async dispatch<K extends EventName>(
    name: K,
    payload: EventMap[K],
    awaitHandlers: boolean,
  ): Promise<void> {
    this.published++;
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);

    const registrations = this.handlers.get(name);
    const started = this.options.slowHandlerMs ? Date.now() : 0;
    const pending: Promise<void>[] = [];

    if (registrations) {
      // Snapshot: handlers may unsubscribe themselves during dispatch.
      for (const registration of [...registrations]) {
        if (registration.once) registrations.delete(registration);
        pending.push(this.invoke(name, registration.handler, payload));
      }
    }
    for (const wildcard of [...this.wildcards]) {
      pending.push(
        this.invoke(name, () => wildcard(name, payload as EventMap[EventName]), payload),
      );
    }

    if (awaitHandlers) {
      await Promise.all(pending);
      if (this.options.slowHandlerMs) {
        const elapsed = Date.now() - started;
        if (elapsed > this.options.slowHandlerMs) this.options.onSlowHandler?.(name, elapsed);
      }
    }
  }

  private async invoke(
    name: EventName,
    handler: (payload: unknown) => void | Promise<void>,
    payload: unknown,
  ): Promise<void> {
    try {
      await handler(payload);
    } catch (error) {
      this.handlerErrors++;
      this.options.onHandlerError?.(name, error);
    }
  }
}
