/**
 * Secret scrubbing. A trading bot logs request payloads and error contexts all
 * day; without this, one unlucky stack trace puts a private key in a log file
 * that gets shipped to a log aggregator.
 */

const SENSITIVE_KEYS = new Set([
  'privatekey',
  'private_key',
  'secretkey',
  'secret_key',
  'secret',
  'mnemonic',
  'seed',
  'seedphrase',
  'passphrase',
  'password',
  'apikey',
  'api_key',
  'apisecret',
  'api_secret',
  'authorization',
  // NOTE: a bare `token` key is deliberately NOT redacted — in this codebase it
  // always means a tradable asset, and redacting it makes every trade log
  // useless. Auth tokens are matched by the qualified names below.
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apitoken',
  'api_token',
  'authtoken',
  'auth_token',
  'bearertoken',
  'sessiontoken',
  'cookie',
  'signature',
  'keystore',
]);

const REDACTED = '[redacted]';

/** base58 (Solana keys), 0x-hex 32-byte, and JWT-shaped strings. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b0x[a-fA-F0-9]{64}\b/g,
  /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (typeof value === 'bigint') return value.toString() as unknown as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    } as unknown as T;
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([k, v]) => [String(k), redact(v, depth + 1)])) as unknown as T;
  }
  if (value instanceof Set) return [...value].map((v) => redact(v, depth + 1)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
  }
  return out as unknown as T;
}
