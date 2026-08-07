import { AppError } from '../errors.js';
import { Semaphore } from './async.js';

export interface QueueOptions {
  readonly name: string;
  readonly concurrency?: number;
  /** Reject new work above this backlog instead of growing without bound. */
  readonly maxQueued?: number;
  readonly onError?: (error: unknown, taskName: string) => void;
}

interface QueuedTask<T> {
  name: string;
  priority: number;
  seq: number;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface QueueStats {
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly rejected: number;
}

/**
 * Priority work queue with bounded concurrency and backpressure.
 *
 * Priority matters here: an exit order for an open position must jump ahead of
 * a hundred queued token-enrichment jobs, otherwise the scanner's throughput
 * becomes the exit latency.
 */
export class WorkQueue {
  private readonly tasks: QueuedTask<unknown>[] = [];
  private readonly semaphore: Semaphore;
  private readonly maxQueued: number;
  private seq = 0;
  private active = 0;
  private completed = 0;
  private failed = 0;
  private rejected = 0;
  private draining = false;

  constructor(private readonly options: QueueOptions) {
    this.semaphore = new Semaphore(options.concurrency ?? 4);
    this.maxQueued = options.maxQueued ?? 1000;
  }

  get size(): number {
    return this.tasks.length;
  }

  get activeCount(): number {
    return this.active;
  }

  stats(): QueueStats {
    return {
      queued: this.tasks.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      rejected: this.rejected,
    };
  }

  /** Higher `priority` runs first; ties break on insertion order (FIFO). */
  push<T>(name: string, fn: () => Promise<T>, priority = 0): Promise<T> {
    if (this.draining) {
      this.rejected++;
      return Promise.reject(
        new AppError(`Queue "${this.options.name}" is draining`, {
          code: 'QUEUE_DRAINING',
          category: 'internal',
        }),
      );
    }
    if (this.tasks.length >= this.maxQueued) {
      this.rejected++;
      return Promise.reject(
        new AppError(`Queue "${this.options.name}" is full (${this.maxQueued})`, {
          code: 'QUEUE_FULL',
          category: 'internal',
          retryable: true,
          context: { queue: this.options.name },
        }),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = { name, priority, seq: this.seq++, fn, resolve, reject };
      this.insert(task as QueuedTask<unknown>);
      void this.pump();
    });
  }

  /** Waits for the current backlog to finish; new pushes are rejected. */
  async drain(): Promise<void> {
    this.draining = true;
    while (this.tasks.length > 0 || this.active > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.draining = false;
  }

  /** Fails every queued task immediately (shutdown path). */
  clear(reason = 'queue cleared'): void {
    const pending = this.tasks.splice(0, this.tasks.length);
    for (const task of pending) {
      task.reject(new AppError(reason, { code: 'QUEUE_CLEARED', category: 'internal' }));
    }
  }

  private insert(task: QueuedTask<unknown>): void {
    let low = 0;
    let high = this.tasks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const other = this.tasks[mid];
      const before = other.priority > task.priority || (other.priority === task.priority && other.seq < task.seq);
      if (before) low = mid + 1;
      else high = mid;
    }
    this.tasks.splice(low, 0, task);
  }

  private async pump(): Promise<void> {
    // The semaphore is acquired BEFORE dequeuing. Taking the task first would
    // pull it out of the priority order while it waits for a slot, so a
    // high-priority exit pushed a moment later could not overtake it — and the
    // backlog limit would never see the real queue depth.
    const release = await this.semaphore.acquire();
    const task = this.tasks.shift();
    if (!task) {
      release();
      return;
    }
    this.active++;
    try {
      task.resolve(await task.fn());
      this.completed++;
    } catch (error) {
      this.failed++;
      this.options.onError?.(error, task.name);
      task.reject(error);
    } finally {
      this.active--;
      release();
    }
  }
}
