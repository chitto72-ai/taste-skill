import type { ChainDescriptor, ChainId } from '../core/domain/chain.js';

/**
 * Registry of the chains the bot can trade — the set Axiom Pro exposes for
 * memecoin execution (Solana plus the EVM venues) — expressed as data.
 *
 * When a broker adds a chain, add a descriptor here: the RPC manager, gas
 * manager, adapters and risk layer are all driven by `family` and the fields
 * below, so no execution code changes.
 */
export const CHAIN_REGISTRY: Readonly<Record<string, ChainDescriptor>> = Object.freeze({
  solana: {
    id: 'solana',
    family: 'svm',
    displayName: 'Solana',
    nativeCurrency: { symbol: 'SOL', decimals: 9, priceId: 'solana' },
    quoteToken: {
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
    },
    wrappedNative: 'So11111111111111111111111111111111111111112',
    blockTimeMs: 400,
    confirmations: 1,
    explorerTxUrl: 'https://solscan.io/tx/',
    explorerTokenUrl: 'https://solscan.io/token/',
    venues: ['raydium', 'orca', 'meteora', 'pumpfun', 'jupiter'],
  },
  ethereum: {
    id: 'ethereum',
    family: 'evm',
    displayName: 'Ethereum',
    evmChainId: 1,
    nativeCurrency: { symbol: 'ETH', decimals: 18, priceId: 'ethereum' },
    quoteToken: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
    },
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    blockTimeMs: 12_000,
    confirmations: 2,
    explorerTxUrl: 'https://etherscan.io/tx/',
    explorerTokenUrl: 'https://etherscan.io/token/',
    venues: ['uniswap_v2', 'uniswap_v3', 'uniswap_v4'],
  },
  base: {
    id: 'base',
    family: 'evm',
    displayName: 'Base',
    evmChainId: 8453,
    nativeCurrency: { symbol: 'ETH', decimals: 18, priceId: 'ethereum' },
    quoteToken: {
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      symbol: 'USDC',
      decimals: 6,
    },
    wrappedNative: '0x4200000000000000000000000000000000000006',
    blockTimeMs: 2_000,
    confirmations: 3,
    explorerTxUrl: 'https://basescan.org/tx/',
    explorerTokenUrl: 'https://basescan.org/token/',
    venues: ['uniswap_v2', 'uniswap_v3', 'aerodrome', 'clanker'],
  },
  bsc: {
    id: 'bsc',
    family: 'evm',
    displayName: 'BNB Chain',
    evmChainId: 56,
    nativeCurrency: { symbol: 'BNB', decimals: 18, priceId: 'binancecoin' },
    quoteToken: {
      address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      symbol: 'USDC',
      decimals: 18,
    },
    wrappedNative: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    blockTimeMs: 750,
    confirmations: 3,
    explorerTxUrl: 'https://bscscan.com/tx/',
    explorerTokenUrl: 'https://bscscan.com/token/',
    venues: ['pancakeswap_v2', 'pancakeswap_v3', 'four_meme'],
  },
  arbitrum: {
    id: 'arbitrum',
    family: 'evm',
    displayName: 'Arbitrum One',
    evmChainId: 42161,
    nativeCurrency: { symbol: 'ETH', decimals: 18, priceId: 'ethereum' },
    quoteToken: {
      address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      symbol: 'USDC',
      decimals: 6,
    },
    wrappedNative: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    blockTimeMs: 250,
    confirmations: 3,
    explorerTxUrl: 'https://arbiscan.io/tx/',
    explorerTokenUrl: 'https://arbiscan.io/token/',
    venues: ['uniswap_v3', 'camelot'],
  },
  hyperliquid: {
    id: 'hyperliquid',
    family: 'evm',
    displayName: 'HyperEVM',
    evmChainId: 999,
    nativeCurrency: { symbol: 'HYPE', decimals: 18, priceId: 'hyperliquid' },
    quoteToken: {
      address: '0x6d1e7cde53ba9467b783cb7c530ce054',
      symbol: 'USDC',
      decimals: 6,
    },
    wrappedNative: '0x5555555555555555555555555555555555555555',
    blockTimeMs: 1_000,
    confirmations: 2,
    explorerTxUrl: 'https://hyperevmscan.io/tx/',
    explorerTokenUrl: 'https://hyperevmscan.io/token/',
    venues: ['hyperswap', 'kittenswap'],
  },
} satisfies Record<string, ChainDescriptor>);

export const SUPPORTED_CHAIN_IDS: readonly ChainId[] = Object.keys(CHAIN_REGISTRY);

export function getChain(id: ChainId): ChainDescriptor {
  const descriptor = CHAIN_REGISTRY[id];
  if (!descriptor) {
    throw new Error(`Unknown chain "${id}". Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`);
  }
  return descriptor;
}

export function isSupportedChain(id: string): id is ChainId {
  return id in CHAIN_REGISTRY;
}

/** Public fallback RPCs. Production deployments should override with paid endpoints. */
export const DEFAULT_RPC_ENDPOINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  solana: ['https://api.mainnet-beta.solana.com'],
  ethereum: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  base: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
  bsc: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
  arbitrum: ['https://arb1.arbitrum.io/rpc'],
  hyperliquid: ['https://rpc.hyperliquid.xyz/evm'],
});
