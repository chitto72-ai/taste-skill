import type { ChainId } from '../core/domain/chain.js';
import type { EventBus } from '../core/event-bus.js';
import { AppError } from '../core/errors.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import type { Logger } from '../logger/logger.js';
import type { BotConfig } from '../config/schema.js';
import { getChain } from '../config/chains.config.js';
import { GasManager } from './gas/gas-manager.js';
import { RpcManager } from './rpc/rpc-manager.js';
import { EvmChainAdapter } from './evm/evm-adapter.js';
import { SolanaChainAdapter } from './solana/solana-adapter.js';
import type { ChainAdapter, PriceOracle } from './types.js';

export interface ChainRegistryOptions {
  readonly config: BotConfig;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly priceOracle: PriceOracle;
}

interface ChainBundle {
  readonly adapter: ChainAdapter;
  readonly rpc: RpcManager;
  readonly gas: GasManager;
}

/**
 * Builds and owns one adapter stack per enabled chain.
 *
 * Everything downstream asks the registry for an adapter by `ChainId` and gets
 * the same interface regardless of family — that is what lets a single
 * strategy run across Solana and four EVM chains without branching.
 */
export class ChainRegistry implements Service {
  readonly name = 'chain-registry';
  private readonly bundles = new Map<ChainId, ChainBundle>();
  private readonly logger: Logger;

  constructor(private readonly options: ChainRegistryOptions) {
    this.logger = options.logger.child(this.name);
  }

  async start(): Promise<void> {
    const { config } = this.options;
    for (const chainId of config.enabledChains) {
      const runtime = config.chains[chainId];
      if (!runtime?.enabled) {
        this.logger.warn({ chain: chainId }, 'chain listed as enabled but runtime config is disabled');
        continue;
      }
      const descriptor = getChain(chainId);
      const isEvm = descriptor.family === 'evm';

      const rpc = new RpcManager({
        chainId,
        config: runtime,
        logger: this.options.logger,
        events: this.options.events,
        healthCheckMethod: isEvm ? 'eth_blockNumber' : 'getSlot',
        healthCheckParams: isEvm ? [] : [{ commitment: 'processed' }],
      });

      const gas = new GasManager({
        chainId,
        rpc,
        config: runtime,
        priceOracle: this.options.priceOracle,
        logger: this.options.logger,
      });

      const adapter: ChainAdapter = isEvm
        ? new EvmChainAdapter({ descriptor, config: runtime, rpc, gas, logger: this.options.logger })
        : new SolanaChainAdapter({ descriptor, config: runtime, rpc, gas, logger: this.options.logger });

      try {
        await rpc.start();
        await adapter.start();
        this.bundles.set(chainId, { adapter, rpc, gas });
        this.logger.info({ chain: chainId, family: descriptor.family }, 'chain online');
      } catch (error) {
        // One unreachable chain must not prevent the bot from trading the rest.
        await rpc.stop().catch(() => undefined);
        this.logger.error({ chain: chainId, err: error }, 'chain failed to initialise, skipping');
        this.options.events.emit('health.changed', {
          component: `chain:${chainId}`,
          healthy: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.bundles.size === 0) {
      throw new AppError('No chain could be initialised; the bot cannot trade', {
        code: 'NO_CHAINS_AVAILABLE',
        category: 'config',
        context: { requested: config.enabledChains },
      });
    }
  }

  async stop(): Promise<void> {
    for (const [chainId, bundle] of this.bundles) {
      await bundle.adapter.stop().catch((error) => {
        this.logger.warn({ chain: chainId, err: error }, 'adapter stop failed');
      });
      await bundle.rpc.stop().catch(() => undefined);
    }
    this.bundles.clear();
  }

  get chains(): ChainId[] {
    return [...this.bundles.keys()];
  }

  has(chainId: ChainId): boolean {
    return this.bundles.has(chainId);
  }

  adapter(chainId: ChainId): ChainAdapter {
    const bundle = this.bundles.get(chainId);
    if (!bundle) {
      throw new AppError(`Chain "${chainId}" is not available`, {
        code: 'CHAIN_UNAVAILABLE',
        category: 'config',
        context: { chain: chainId, available: this.chains },
      });
    }
    return bundle.adapter;
  }

  rpc(chainId: ChainId): RpcManager {
    const bundle = this.bundles.get(chainId);
    if (!bundle) throw new AppError(`Chain "${chainId}" is not available`, { code: 'CHAIN_UNAVAILABLE', category: 'config' });
    return bundle.rpc;
  }

  gas(chainId: ChainId): GasManager {
    const bundle = this.bundles.get(chainId);
    if (!bundle) throw new AppError(`Chain "${chainId}" is not available`, { code: 'CHAIN_UNAVAILABLE', category: 'config' });
    return bundle.gas;
  }

  async health(): Promise<HealthReport> {
    const reports = await Promise.all([...this.bundles.values()].map((b) => b.adapter.health()));
    const healthy = reports.filter((r) => r.healthy).length;
    return {
      component: this.name,
      healthy: healthy > 0,
      detail: `${healthy}/${reports.length} chains healthy`,
      checkedAt: Date.now(),
      metrics: { chains: reports.length, healthy },
    };
  }

  /** Per-chain detail for the dashboard's infrastructure panel. */
  async detailedHealth(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [chainId, bundle] of this.bundles) {
      out[chainId] = {
        adapter: await bundle.adapter.health(),
        rpc: bundle.rpc.stats(),
      };
    }
    return out;
  }
}
