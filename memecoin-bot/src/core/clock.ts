/**
 * Time abstraction. Nothing in the domain calls `Date.now()` directly: the
 * backtester swaps in a virtual clock so a six-hour session replays in
 * milliseconds, and unit tests get deterministic timers for free.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimeout(fn: () => void, ms: number): Disposable;
  setInterval(fn: () => void, ms: number): Disposable;
}

export interface Disposable {
  dispose(): void;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setTimeout(fn: () => void, ms: number): Disposable {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return { dispose: () => clearTimeout(handle) };
  }

  setInterval(fn: () => void, ms: number): Disposable {
    const handle = setInterval(fn, ms);
    handle.unref?.();
    return { dispose: () => clearInterval(handle) };
  }
}

interface ScheduledTask {
  id: number;
  at: number;
  intervalMs?: number;
  fn: () => void;
  cancelled: boolean;
}

/**
 * Deterministic clock driven by explicit `advance()` calls. Timers fire in
 * chronological order; intervals reschedule themselves until cancelled.
 */
export class VirtualClock implements Clock {
  private current: number;
  private seq = 0;
  private tasks: ScheduledTask[] = [];

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.schedule(resolve, ms);
    });
  }

  setTimeout(fn: () => void, ms: number): Disposable {
    return this.schedule(fn, ms);
  }

  setInterval(fn: () => void, ms: number): Disposable {
    return this.schedule(fn, ms, ms);
  }

  /** Moves time forward, firing every timer whose deadline is crossed. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const next = this.nextTask(target);
      if (!next) break;
      this.current = next.at;
      if (next.intervalMs !== undefined) {
        next.at = this.current + next.intervalMs;
      } else {
        next.cancelled = true;
      }
      next.fn();
      // Let microtasks queued by the callback settle before the next timer.
      await Promise.resolve();
    }
    this.current = target;
    this.tasks = this.tasks.filter((t) => !t.cancelled);
  }

  /** Jumps directly to an absolute timestamp. */
  async advanceTo(timestamp: number): Promise<void> {
    if (timestamp > this.current) await this.advance(timestamp - this.current);
  }

  get pendingTimers(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }

  private schedule(fn: () => void, ms: number, intervalMs?: number): Disposable {
    const task: ScheduledTask = {
      id: this.seq++,
      at: this.current + Math.max(0, ms),
      intervalMs,
      fn,
      cancelled: false,
    };
    this.tasks.push(task);
    return {
      dispose: () => {
        task.cancelled = true;
      },
    };
  }

  private nextTask(limit: number): ScheduledTask | undefined {
    let best: ScheduledTask | undefined;
    for (const task of this.tasks) {
      if (task.cancelled || task.at > limit) continue;
      if (!best || task.at < best.at || (task.at === best.at && task.id < best.id)) best = task;
    }
    return best;
  }
}
