import type { SecurityFlags } from '../../core/domain/token.js';
import { TtlCache } from '../../core/utils/cache.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRegistry } from '../../blockchains/registry.js';
import { SolanaChainAdapter } from '../../blockchains/solana/solana-adapter.js';
import { decodeAddress, encodeOwner } from '../../blockchains/evm/erc20.js';
import { getChain } from '../../config/chains.config.js';
import type { DiscoveryConfig } from '../../config/schema.js';
import type { Enricher, EnrichmentResult, TokenCandidate } from '../types.js';

const ZERO_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '11111111111111111111111111111111',
]);

/**
 * Contract-level rug checks — the highest-value stage in the pipeline.
 *
 * Everything here is verified against chain state where possible rather than
 * taken from a feed: mint/freeze authority on Solana and ownership renounce on
 * EVM are two RPC calls, and they are exactly the checks a feed is most likely
 * to report stale.
 */
export class SecurityEnricher implements Enricher {
  readonly name = 'security';
  readonly slice = 'security' as const;

  // Authorities are immutable once revoked, so a long TTL is safe and saves
  // an RPC round trip on every rescan.
  private readonly cache = new TtlCache<string, Partial<SecurityFlags>>({
    ttlMs: 10 * 60_000,
    maxEntries: 5_000,
  });
  private readonly logger: Logger;
  private readonly denyList: Set<string>;

  constructor(
    private readonly chains: ChainRegistry | undefined,
    config: DiscoveryConfig,
    logger: Logger,
  ) {
    this.logger = logger.child('enricher:security');
    this.denyList = new Set(config.denyListTokens.map((v) => v.toLowerCase()));
  }

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    const key = `${candidate.ref.chain}:${candidate.ref.address}`;
    const feed = candidate.security ?? {};
    const missing: string[] = [];

    let onchain = this.cache.get(key);
    if (!onchain) {
      onchain = await this.readChainState(candidate);
      if (onchain) this.cache.set(key, onchain);
    }

    const merged: Partial<SecurityFlags> = { ...feed, ...onchain };

    const lpLocked = merged.lpLocked ?? candidate.pool.lpLockedPct >= 0.9;
    const lpBurned = merged.lpBurned ?? candidate.pool.lpLockedPct >= 0.99;

    if (merged.mintAuthorityRevoked === undefined) missing.push('security.mintAuthorityRevoked');
    if (merged.freezeAuthorityRevoked === undefined) missing.push('security.freezeAuthorityRevoked');
    if (merged.isHoneypot === undefined) missing.push('security.isHoneypot');
    if (merged.buyTaxPct === undefined) missing.push('security.buyTaxPct');
    if (merged.sellTaxPct === undefined) missing.push('security.sellTaxPct');

    // Bundle detection: a launch is "bundled" when a cluster of wallets bought
    // in the same block or holds near-identical amounts. The holders stage
    // computes the share; this stage turns it into a flag.
    const bundledPct = candidate.holders?.bundledPct ?? 0;
    const bundleWallets = merged.bundleWallets ?? 0;
    const bundleDetected = merged.bundleDetected ?? (bundledPct > 0.12 || bundleWallets >= 5);

    const flags: Partial<SecurityFlags> = {
      mintAuthorityRevoked: merged.mintAuthorityRevoked ?? false,
      freezeAuthorityRevoked: merged.freezeAuthorityRevoked ?? false,
      ownershipRenounced: merged.ownershipRenounced ?? false,
      lpLocked,
      lpBurned,
      isHoneypot: merged.isHoneypot ?? false,
      hasTransferTax: merged.hasTransferTax ?? (merged.buyTaxPct ?? 0) + (merged.sellTaxPct ?? 0) > 0,
      buyTaxPct: merged.buyTaxPct ?? 0,
      sellTaxPct: merged.sellTaxPct ?? 0,
      hasBlacklistFn: merged.hasBlacklistFn ?? false,
      isProxyUpgradable: merged.isProxyUpgradable ?? false,
      bundleDetected,
      bundleWallets,
      onDenyList: this.denyList.has(candidate.ref.address.toLowerCase()),
    };

    return { security: flags, missing };
  }

  private async readChainState(candidate: TokenCandidate): Promise<Partial<SecurityFlags> | undefined> {
    if (!this.chains?.has(candidate.ref.chain)) return undefined;
    const family = getChain(candidate.ref.chain).family;
    try {
      return family === 'svm'
        ? await this.readSolana(candidate)
        : await this.readEvm(candidate);
    } catch (error) {
      this.logger.debug({ token: candidate.ref.address, err: error }, 'security chain probe failed');
      return undefined;
    }
  }

  private async readSolana(candidate: TokenCandidate): Promise<Partial<SecurityFlags>> {
    const adapter = this.chains!.adapter(candidate.ref.chain);
    if (!(adapter instanceof SolanaChainAdapter)) return {};
    const authorities = await adapter.getMintAuthorities(candidate.ref.address);
    return {
      mintAuthorityRevoked: authorities.mintAuthority === null,
      freezeAuthorityRevoked: authorities.freezeAuthority === null,
      // Token-2022 transfer hooks can implement taxes and blocklists, so an
      // unrevoked authority on that program is treated as upgradable.
      isProxyUpgradable: authorities.isToken2022 && authorities.mintAuthority !== null,
      ownershipRenounced: authorities.mintAuthority === null && authorities.freezeAuthority === null,
    };
  }

  private async readEvm(candidate: TokenCandidate): Promise<Partial<SecurityFlags>> {
    const rpc = this.chains!.rpc(candidate.ref.chain);
    try {
      const data = await rpc.call<string>('eth_call', [
        { to: candidate.ref.address, data: encodeOwner() },
        'latest',
      ]);
      const owner = decodeAddress(data).toLowerCase();
      const renounced = ZERO_ADDRESSES.has(owner);
      return {
        ownershipRenounced: renounced,
        // No owner means no privileged mint or blacklist path.
        mintAuthorityRevoked: renounced,
        freezeAuthorityRevoked: renounced,
      };
    } catch {
      // Tokens without `owner()` are frequently the safest kind; absence of
      // the function is not evidence of a problem, so report nothing.
      return {};
    }
  }
}
