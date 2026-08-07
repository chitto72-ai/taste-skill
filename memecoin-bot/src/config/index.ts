import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { ConfigError } from '../core/errors.js';
import { CHAIN_REGISTRY, SUPPORTED_CHAIN_IDS, getChain, isSupportedChain } from './chains.config.js';
import { MODE_PRESETS, createDefaultConfig, defaultChainRuntime } from './default.config.js';
import { configFromEnv } from './env.js';
import { deepMerge, mergeAll, type DeepPartial } from './merge.js';
import { botConfigSchema, type BotConfig } from './schema.js';
import { formatIssues, validateConfig, type ConfigIssue } from './validate.js';

export interface LoadConfigOptions {
  /** Path to a JSON config file. Defaults to ./config.json when present. */
  readonly configPath?: string;
  /** Path to a dotenv file. Defaults to ./.env when present. */
  readonly envPath?: string;
  /** Highest-priority overrides, e.g. CLI flags. */
  readonly overrides?: DeepPartial<BotConfig>;
  /** Skip reading process.env (used by tests for hermetic loads). */
  readonly ignoreEnv?: boolean;
  /** Throw on warnings as well as errors. */
  readonly strict?: boolean;
}

export interface LoadedConfig {
  readonly config: BotConfig;
  readonly issues: readonly ConfigIssue[];
  readonly sources: readonly string[];
}

/**
 * Resolution order (later wins): defaults -> mode preset -> JSON file ->
 * environment -> explicit overrides. The mode preset is applied early so an
 * operator can still relax a preset from the file if they mean to.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const sources: string[] = ['defaults'];

  if (!options.ignoreEnv) {
    const envPath = options.envPath ?? resolve(process.cwd(), '.env');
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath });
      sources.push(envPath);
    }
  }

  const fileOverride = readConfigFile(options.configPath, sources);
  const envOverride = options.ignoreEnv ? undefined : configFromEnv();
  if (envOverride && Object.keys(envOverride).length > 0) sources.push('process.env');
  if (options.overrides) sources.push('overrides');

  // Mode has to be resolved before presets can be applied.
  const base = createDefaultConfig();
  const modeCandidate =
    options.overrides?.mode ?? envOverride?.mode ?? (fileOverride?.mode as BotConfig['mode']) ?? base.mode;
  const preset = MODE_PRESETS[modeCandidate] ?? {};

  const merged = mergeAll(
    base,
    preset as DeepPartial<BotConfig>,
    fileOverride,
    envOverride,
    options.overrides,
  );

  // Any chain named in enabledChains must have a runtime block.
  const withChains = ensureChainRuntimes(merged);

  const parsed = botConfigSchema.safeParse(withChains);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Configuration failed schema validation:\n${details.join('\n')}`, {
      issues: details,
    });
  }

  const config = parsed.data;
  const issues = validateConfig(config);
  const errors = issues.filter((i) => i.severity === 'error');
  const blocking = options.strict ? issues : errors;
  if (blocking.length > 0) {
    throw new ConfigError(`Configuration is invalid:\n${formatIssues(blocking)}`, {
      issues: blocking.map((i) => `${i.path}: ${i.message}`),
    });
  }

  return { config, issues, sources };
}

function readConfigFile(
  configPath: string | undefined,
  sources: string[],
): DeepPartial<BotConfig> | undefined {
  const path = configPath ?? resolve(process.cwd(), 'config.json');
  if (!existsSync(path)) {
    if (configPath) {
      throw new ConfigError(`Config file not found: ${path}`, { path });
    }
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as DeepPartial<BotConfig>;
    sources.push(path);
    return parsed;
  } catch (error) {
    throw new ConfigError(`Config file ${path} is not valid JSON`, { path }, error);
  }
}

function ensureChainRuntimes(config: BotConfig): BotConfig {
  const chains = { ...config.chains };
  for (const chainId of config.enabledChains) {
    if (!isSupportedChain(chainId)) {
      throw new ConfigError(
        `Unknown chain "${chainId}". Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`,
        { chainId },
      );
    }
    chains[chainId] = deepMerge(defaultChainRuntime(chainId), chains[chainId]);
  }
  return { ...config, chains };
}

/** Convenience accessor used across modules that need both halves of a chain. */
export function chainConfig(config: BotConfig, chainId: string) {
  const runtime = config.chains[chainId];
  if (!runtime) throw new ConfigError(`Chain "${chainId}" is not configured`, { chainId });
  return { descriptor: getChain(chainId), runtime };
}

export { CHAIN_REGISTRY, SUPPORTED_CHAIN_IDS, getChain, isSupportedChain };
export { createDefaultConfig, defaultChainRuntime, MODE_PRESETS };
export { validateConfig, formatIssues, type ConfigIssue };
export { deepMerge, mergeAll, type DeepPartial };
export * from './schema.js';
