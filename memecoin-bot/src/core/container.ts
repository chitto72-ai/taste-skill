import { AppError } from './errors.js';

/** Branded token so `resolve()` returns the right type without casts. */
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** Phantom field — never populated at runtime. */
  readonly __type?: T;
}

export function token<T>(name: string): Token<T> {
  return { key: Symbol(name), name };
}

export type Factory<T> = (c: Container) => T | Promise<T>;

interface Registration<T> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
  resolving?: Promise<T>;
}

/**
 * Minimal async DI container.
 *
 * No decorators and no reflection: wiring is explicit in composition-root.ts,
 * which keeps the dependency graph greppable and works identically under
 * `tsx`, compiled output and vitest.
 */
export class Container {
  private readonly registry = new Map<symbol, Registration<unknown>>();
  private readonly resolutionStack: string[] = [];
  private readonly disposers: Array<() => void | Promise<void>> = [];

  register<T>(t: Token<T>, factory: Factory<T>, options: { singleton?: boolean } = {}): this {
    this.registry.set(t.key, {
      factory: factory as Factory<unknown>,
      singleton: options.singleton ?? true,
    });
    return this;
  }

  /** Registers an already-constructed value (config objects, clocks, …). */
  registerValue<T>(t: Token<T>, value: T): this {
    this.registry.set(t.key, {
      factory: () => value,
      singleton: true,
      instance: value,
    });
    return this;
  }

  has<T>(t: Token<T>): boolean {
    return this.registry.has(t.key);
  }

  async resolve<T>(t: Token<T>): Promise<T> {
    const registration = this.registry.get(t.key) as Registration<T> | undefined;
    if (!registration) {
      throw new AppError(`No provider registered for "${t.name}"`, {
        code: 'DI_UNRESOLVED',
        category: 'internal',
        context: { token: t.name, stack: [...this.resolutionStack] },
      });
    }
    if (registration.singleton && registration.instance !== undefined) return registration.instance;
    if (registration.resolving) return registration.resolving;

    if (this.resolutionStack.includes(t.name)) {
      throw new AppError(
        `Circular dependency detected: ${[...this.resolutionStack, t.name].join(' -> ')}`,
        { code: 'DI_CIRCULAR', category: 'internal' },
      );
    }

    this.resolutionStack.push(t.name);
    const promise = (async () => {
      try {
        const instance = await registration.factory(this);
        if (registration.singleton) registration.instance = instance;
        return instance;
      } finally {
        this.resolutionStack.pop();
        registration.resolving = undefined;
      }
    })();
    registration.resolving = promise;
    return promise;
  }

  /** Resolves several tokens in parallel; order of the tuple is preserved. */
  async resolveAll<const T extends readonly Token<unknown>[]>(
    ...tokens: T
  ): Promise<{ [K in keyof T]: T[K] extends Token<infer U> ? U : never }> {
    const values = await Promise.all(tokens.map((t) => this.resolve(t)));
    return values as { [K in keyof T]: T[K] extends Token<infer U> ? U : never };
  }

  onDispose(fn: () => void | Promise<void>): void {
    this.disposers.push(fn);
  }

  /** Tears down in reverse registration order; one failure never blocks the rest. */
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const disposer of [...this.disposers].reverse()) {
      try {
        await disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    this.disposers.length = 0;
    this.registry.clear();
    if (errors.length > 0) {
      throw new AppError(`${errors.length} disposer(s) failed during container shutdown`, {
        code: 'DI_DISPOSE_FAILED',
        category: 'internal',
        context: { errors: errors.map((e) => (e instanceof Error ? e.message : String(e))) },
      });
    }
  }
}
