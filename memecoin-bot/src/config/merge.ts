export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursive merge where arrays replace rather than concatenate.
 *
 * Concatenating would be actively wrong for this config: an operator who sets
 * `enabledChains: ['solana']` means *only* Solana, not "solana plus whatever
 * the defaults had".
 */
export function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined || override === null) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;

  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

export function mergeAll<T>(base: T, ...overrides: (DeepPartial<T> | undefined)[]): T {
  return overrides.reduce<T>((acc, override) => deepMerge(acc, override), base);
}
