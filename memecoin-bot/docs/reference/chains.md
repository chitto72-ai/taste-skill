<!-- GENERATED FILE — do not edit by hand. Run `npm run docs` to regenerate. -->

# Supported chains


Chains are data, not code: adding one means adding a descriptor to
`src/config/chains.config.ts`. The EVM adapter serves every `evm` family
chain and the Solana adapter serves `svm`.

| Chain | Family | EVM id | Native | Quote | Block time | Confirmations | Venues |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `solana` | svm | — | SOL | USDC | 400ms | 1 | raydium, orca, meteora, pumpfun, jupiter |
| `ethereum` | evm | 1 | ETH | USDC | 12000ms | 2 | uniswap_v2, uniswap_v3, uniswap_v4 |
| `base` | evm | 8453 | ETH | USDC | 2000ms | 3 | uniswap_v2, uniswap_v3, aerodrome, clanker |
| `bsc` | evm | 56 | BNB | USDC | 750ms | 3 | pancakeswap_v2, pancakeswap_v3, four_meme |
| `arbitrum` | evm | 42161 | ETH | USDC | 250ms | 3 | uniswap_v3, camelot |
| `hyperliquid` | evm | 999 | HYPE | USDC | 1000ms | 2 | hyperswap, kittenswap |
