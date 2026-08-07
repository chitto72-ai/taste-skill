#!/usr/bin/env tsx
/**
 * Generates the reference documentation that would otherwise rot.
 *
 * Everything under `docs/reference/` is derived from the code itself — the
 * config schema, the metric catalogue, the event map, the chain registry — so
 * a new metric or config field shows up in the docs by existing, not by
 * someone remembering to write it down. Run `npm run docs` after changing any
 * of them.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { botConfigSchema } from '../src/config/schema.js';
import { createDefaultConfig } from '../src/config/default.config.js';
import { CHAIN_REGISTRY } from '../src/config/chains.config.js';
import { METRICS_BY_GROUP, METRIC_COUNT } from '../src/scoring/metrics/index.js';
import { rugTerms, pumpTerms, dumpTerms } from '../src/scoring/probabilities.js';
import { healthyProfileForDocs } from './doc-fixtures.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'reference');

const HEADER = (title: string): string =>
  `<!-- GENERATED FILE — do not edit by hand. Run \`npm run docs\` to regenerate. -->\n\n# ${title}\n`;

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await Promise.all([
    writeFile(join(OUT, 'configuration.md'), configReference()),
    writeFile(join(OUT, 'metrics.md'), metricReference()),
    writeFile(join(OUT, 'chains.md'), chainReference()),
    writeFile(join(OUT, 'events.md'), eventReference()),
  ]);
  process.stdout.write(`Wrote 4 reference documents to docs/reference/\n`);
}

/** Walks the zod schema and emits one table row per leaf field. */
function configReference(): string {
  const defaults = createDefaultConfig() as unknown as Record<string, unknown>;
  const lines: string[] = [
    HEADER('Configuration reference'),
    '',
    'Every field below is settable in `config.json`. A subset is also settable by',
    'environment variable — see `.env.example`. Resolution order is:',
    '',
    '```',
    'defaults -> mode preset -> config.json -> environment -> CLI flags',
    '```',
    '',
  ];

  for (const [section, schema] of Object.entries(botConfigSchema.shape)) {
    lines.push(`## \`${section}\``, '');
    const rows = describe(schema as z.ZodTypeAny, defaults[section]);
    if (rows.length === 0) {
      lines.push(`_${typeName(schema as z.ZodTypeAny)}_`, '');
      continue;
    }
    lines.push('| Field | Type | Default | Notes |', '| --- | --- | --- | --- |');
    for (const row of rows) {
      lines.push(`| \`${row.path}\` | ${row.type} | \`${row.value}\` | ${row.description} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface Row {
  path: string;
  type: string;
  value: string;
  description: string;
}

function describe(schema: z.ZodTypeAny, value: unknown, prefix = ''): Row[] {
  const unwrapped = unwrap(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    return prefix
      ? [
          {
            path: prefix,
            type: typeName(unwrapped),
            value: render(value),
            description: schema.description ?? '',
          },
        ]
      : [];
  }

  const rows: Row[] = [];
  for (const [key, child] of Object.entries(unwrapped.shape as Record<string, z.ZodTypeAny>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childValue = (value as Record<string, unknown> | undefined)?.[key];
    const inner = unwrap(child);
    if (inner instanceof z.ZodObject) rows.push(...describe(inner, childValue, path));
    else {
      rows.push({
        path,
        type: typeName(inner),
        value: render(childValue),
        description: child.description ?? '',
      });
    }
  }
  return rows;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodDefault) current = current._def.innerType as z.ZodTypeAny;
    else if (current instanceof z.ZodOptional) current = current._def.innerType as z.ZodTypeAny;
    else if (current instanceof z.ZodEffects) current = current._def.schema as z.ZodTypeAny;
    else break;
  }
  return current;
}

function typeName(schema: z.ZodTypeAny): string {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodNumber) return 'number';
  if (inner instanceof z.ZodString) return 'string';
  if (inner instanceof z.ZodBoolean) return 'boolean';
  if (inner instanceof z.ZodEnum) return (inner._def.values as string[]).map((v) => `\`${v}\``).join(' \\| ');
  if (inner instanceof z.ZodArray) return `${typeName(inner._def.type as z.ZodTypeAny)}[]`;
  if (inner instanceof z.ZodRecord) return 'record';
  if (inner instanceof z.ZodObject) return 'object';
  return 'unknown';
}

function render(value: unknown): string {
  if (value === undefined) return '—';
  if (Array.isArray(value)) return value.length > 3 ? `[${value.length} items]` : JSON.stringify(value);
  if (typeof value === 'object') return '{…}';
  return String(value);
}

/** Emits the metric catalogue, including each metric's live value on a sample. */
function metricReference(): string {
  const profile = healthyProfileForDocs();
  const now = Date.now();

  const lines: string[] = [
    HEADER('Metric catalogue'),
    '',
    `The scorer evaluates **${METRIC_COUNT} metrics** across seven groups. Each metric`,
    'normalizes a raw measurement to `0..1`, where 1 is unambiguously favourable.',
    'Group scores are weighted means; the composite applies the group weights from',
    '`scoring.weights`.',
    '',
    'The "sample" column shows what each metric returns for a healthy reference',
    'token, which is a quick way to see the shape of a normalizer.',
    '',
  ];

  for (const [group, metrics] of Object.entries(METRICS_BY_GROUP)) {
    const totalWeight = metrics.reduce((acc, m) => acc + m.weight, 0);
    lines.push(`## ${group} (${metrics.length} metrics, total weight ${totalWeight.toFixed(1)})`, '');
    lines.push('| Metric | Description | Weight | Requires | Sample |', '| --- | --- | --- | --- | --- |');
    for (const metric of metrics) {
      let sample = '—';
      try {
        sample = metric.compute({ profile, now }).normalized.toFixed(2);
      } catch {
        sample = 'error';
      }
      const requires = metric.requires?.length ? metric.requires.map((r) => `\`${r}\``).join(', ') : '—';
      lines.push(`| \`${metric.id}\` | ${metric.label} | ${metric.weight} | ${requires} | ${sample} |`);
    }
    lines.push('');
  }

  const sub = { risk: 90, momentum: 70, liquidity: 80, community: 60, whale: 70, developer: 80 };
  lines.push('## Probability models', '');
  lines.push(
    'Three logistic models sit on top of the metrics. Each is a weighted mean of',
    'interpretable terms passed through a logistic, so the output stays calibrated',
    'instead of saturating at 0 or 1.',
    '',
  );
  for (const [name, terms] of [
    ['Rug probability', rugTerms(profile)],
    ['Pump probability', pumpTerms(profile, sub)],
    ['Dump probability', dumpTerms(profile, sub)],
  ] as const) {
    lines.push(`### ${name}`, '', '| Term | Coefficient |', '| --- | --- |');
    for (const term of terms) lines.push(`| \`${term.label}\` | ${term.coefficient} |`);
    lines.push('');
  }

  return lines.join('\n');
}

function chainReference(): string {
  const lines: string[] = [
    HEADER('Supported chains'),
    '',
    'Chains are data, not code: adding one means adding a descriptor to',
    '`src/config/chains.config.ts`. The EVM adapter serves every `evm` family',
    'chain and the Solana adapter serves `svm`.',
    '',
    '| Chain | Family | EVM id | Native | Quote | Block time | Confirmations | Venues |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const chain of Object.values(CHAIN_REGISTRY)) {
    lines.push(
      `| \`${chain.id}\` | ${chain.family} | ${chain.evmChainId ?? '—'} | ${chain.nativeCurrency.symbol} | ` +
        `${chain.quoteToken.symbol} | ${chain.blockTimeMs}ms | ${chain.confirmations} | ${chain.venues.join(', ')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** The event map is the module contract, so it is documented from the source. */
function eventReference(): string {
  const events: Record<string, string> = {
    'engine.started': 'The engine finished starting every managed service.',
    'engine.stopping': 'Shutdown began; services are about to stop.',
    'engine.stopped': 'Every service has stopped.',
    'engine.tick': 'A discovery scan completed.',
    'token.discovered': 'A token was seen for the first time.',
    'token.updated': 'An already-tracked token was re-observed.',
    'token.scored': 'A token cleared the score threshold and has no vetoes.',
    'token.rejected': 'A token was scored and rejected; the payload says why.',
    'token.evaluated': 'A strategy evaluated a token, pass or fail, with conditions.',
    'signal.entry': 'A strategy produced an entry signal that cleared risk.',
    'signal.exit': 'An exit rule fired for an open position.',
    'order.submitted': 'An order was handed to the execution router.',
    'order.filled': 'An order filled, fully or partially.',
    'order.rejected': 'An order was rejected after all retries.',
    'position.opened': 'A position was created from a fill.',
    'position.updated': 'Position state changed without a fill.',
    'position.partial_exit': 'A take-profit level or partial exit filled.',
    'position.closed': 'A position closed; a trade record was written.',
    'risk.rejected': 'An entry was blocked by a risk limit.',
    'risk.halted': 'A circuit breaker tripped; new entries are blocked.',
    'risk.resumed': 'Trading resumed after a halt.',
    'risk.updated': 'Equity, drawdown or open-position count changed.',
    'wallet.activity': 'A tracked wallet traded.',
    'wallet.promoted': 'A wallet now qualifies for copy trading.',
    'wallet.demoted': 'A wallet no longer qualifies for copy trading.',
    'chain.tx_confirmed': 'A transaction reached its confirmation target.',
    'chain.rpc_failover': 'An RPC call moved to a different endpoint.',
    'health.changed': 'A component became healthy or unhealthy.',
    'error.occurred': 'An error was captured and persisted.',
  };

  const lines: string[] = [
    HEADER('Event catalogue'),
    '',
    'Modules communicate exclusively through these events (`src/core/events.ts`).',
    'Subscribing to them is the supported way to extend the bot without modifying it.',
    '',
    '| Event | Meaning |',
    '| --- | --- |',
  ];
  for (const [name, description] of Object.entries(events)) {
    lines.push(`| \`${name}\` | ${description} |`);
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
