<!-- GENERATED FILE — do not edit by hand. Run `npm run docs` to regenerate. -->

# Metric catalogue


The scorer evaluates **62 metrics** across seven groups. Each metric
normalizes a raw measurement to `0..1`, where 1 is unambiguously favourable.
Group scores are weighted means; the composite applies the group weights from
`scoring.weights`.

The "sample" column shows what each metric returns for a healthy reference
token, which is a quick way to see the shape of a normalizer.

## liquidity (8 metrics, total weight 11.6)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `liq.depth_usd` | Pool liquidity (USD) | 2 | — | 0.54 |
| `liq.to_marketcap` | Liquidity / market cap | 1.8 | — | 0.25 |
| `liq.lp_locked_pct` | LP locked or burned | 2.2 | — | 1.00 |
| `liq.lock_duration` | LP lock remaining | 0.8 | — | 1.00 |
| `liq.pool_age_minutes` | Pool age | 0.9 | — | 0.99 |
| `liq.trend` | Liquidity trend | 1.4 | `market.liquidity_history` | 0.67 |
| `liq.volume_to_liquidity` | 5m volume / liquidity | 1.2 | — | 0.50 |
| `liq.entry_impact` | Estimated entry price impact | 1.3 | — | 0.74 |

## momentum (11 metrics, total weight 14.1)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `mom.price_change_5m` | 5m price change | 1.8 | — | 0.52 |
| `mom.price_change_1h` | 1h price change | 1.3 | — | 0.61 |
| `mom.price_change_24h` | 24h price change | 0.6 | — | 0.62 |
| `mom.volume_growth_5m` | 5m volume growth | 2 | — | 0.69 |
| `mom.volume_5m_usd` | 5m volume (USD) | 1.2 | — | 0.78 |
| `mom.buy_sell_ratio_5m` | 5m buy/sell ratio | 1.7 | — | 1.00 |
| `mom.buy_sell_ratio_1h` | 1h buy/sell ratio | 1 | — | 1.00 |
| `mom.txn_count_5m` | 5m transaction count | 0.9 | — | 0.79 |
| `mom.price_slope` | Price trend slope | 1.5 | `market.price_history` | 0.69 |
| `mom.ema_alignment` | Fast/slow EMA alignment | 1.1 | `market.price_history` | 1.00 |
| `mom.volatility` | Realized volatility (inverse) | 1 | `market.price_history` | 1.00 |

## holders (12 metrics, total weight 17.6)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `hold.count` | Holder count | 1.4 | `holders.count` | 0.60 |
| `hold.growth_5m` | 5m holder growth | 1.9 | `holders.growth5m` | 0.65 |
| `hold.growth_1h` | 1h holder growth | 1.2 | — | 0.82 |
| `hold.growth_trend` | Holder growth trend | 1 | `market.price_history` | 0.96 |
| `hold.top10_pct` | Top-10 concentration | 2.1 | `holders.top10Pct` | 0.90 |
| `hold.top25_pct` | Top-25 concentration | 1.2 | — | 1.00 |
| `hold.hhi` | Distribution HHI | 1.3 | `holders.concentrationHhi` | 0.96 |
| `hold.sniper_pct` | Sniper-held supply | 1.5 | `holders.snipersPct` | 1.00 |
| `hold.insider_pct` | Insider-held supply | 1.6 | — | 1.00 |
| `hold.bundled_pct` | Bundled supply | 2 | `holders.bundledPct` | 0.93 |
| `hold.dev_holding_pct` | Developer-held supply | 1.7 | `holders.devHoldingPct` | 1.00 |
| `hold.avg_position_usd` | Average holder position | 0.7 | — | 1.00 |

## whales (7 metrics, total weight 11.3)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `whale.smart_holding` | Smart wallets holding | 1.8 | `smartMoney.smartWalletsHolding` | 0.75 |
| `whale.smart_buying_5m` | Smart wallets buying (5m) | 2.2 | `smartMoney.smartWalletsBuying5m` | 0.80 |
| `whale.smart_net_flow` | Smart money net flow (5m) | 1.9 | — | 1.00 |
| `whale.whales_holding` | Whales holding | 1.3 | — | 0.80 |
| `whale.whale_net_flow` | Whale net flow (5m) | 1.7 | `smartMoney.whaleNetFlowUsd5m` | 1.00 |
| `whale.kol_mentions` | KOL mentions | 0.9 | `smartMoney.kolMentions` | 1.00 |
| `whale.insider_wallets` | Insider wallets (inverse) | 1.5 | — | 1.00 |

## community (7 metrics, total weight 7.9)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `com.twitter_followers` | Twitter followers | 0.9 | `social.twitterFollowers` | 0.74 |
| `com.twitter_growth` | Twitter growth (1h) | 1.6 | `social.twitterGrowth1h` | 0.80 |
| `com.twitter_mentions` | Twitter mentions (1h) | 1.2 | — | 0.68 |
| `com.telegram_members` | Telegram members | 0.8 | `social.telegramMembers` | 0.74 |
| `com.telegram_growth` | Telegram growth (1h) | 1.3 | — | 0.60 |
| `com.verified_socials` | Verified socials present | 1.1 | — | 1.00 |
| `com.sentiment` | Sentiment score | 1 | — | 0.82 |

## developer (7 metrics, total weight 10.4)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `dev.wallet_age_days` | Developer wallet age | 1.3 | `developer.walletAgeDays` | 1.00 |
| `dev.rug_ratio` | Prior rug ratio | 2.5 | `developer.ruggedTokens` | 1.00 |
| `dev.success_ratio` | Prior successful launches | 1.4 | `developer.tokensLaunched` | 0.67 |
| `dev.launch_count` | Launch count | 0.8 | — | 0.90 |
| `dev.balance_pct` | Developer balance | 1.8 | — | 1.00 |
| `dev.sold_pct` | Developer already sold | 1.9 | — | 1.00 |
| `dev.identified` | Developer wallet identified | 0.7 | — | 1.00 |

## security (10 metrics, total weight 19.4)

| Metric | Description | Weight | Requires | Sample |
| --- | --- | --- | --- | --- |
| `sec.mint_revoked` | Mint authority revoked | 2.4 | `security.mintAuthorityRevoked` | 1.00 |
| `sec.freeze_revoked` | Freeze authority revoked | 2.2 | `security.freezeAuthorityRevoked` | 1.00 |
| `sec.ownership_renounced` | Ownership renounced | 1.6 | — | 1.00 |
| `sec.lp_secured` | LP locked or burned | 2.3 | — | 1.00 |
| `sec.not_honeypot` | Sellable (not a honeypot) | 2.5 | `security.isHoneypot` | 1.00 |
| `sec.buy_tax` | Buy tax | 1.4 | `security.buyTaxPct` | 1.00 |
| `sec.sell_tax` | Sell tax | 1.8 | `security.sellTaxPct` | 1.00 |
| `sec.no_blacklist` | No blacklist function | 1.7 | — | 1.00 |
| `sec.not_upgradable` | Not proxy-upgradable | 1.5 | — | 1.00 |
| `sec.no_bundle` | No bundled launch detected | 2 | `holders.bundledPct` | 1.00 |

## Probability models

Three logistic models sit on top of the metrics. Each is a weighted mean of
interpretable terms passed through a logistic, so the output stays calibrated
instead of saturating at 0 or 1.

### Rug probability

| Term | Coefficient |
| --- | --- |
| `lp_unsecured` | 2.4 |
| `mint_authority_live` | 1.9 |
| `freeze_authority_live` | 1.2 |
| `honeypot` | 4 |
| `blacklist_fn` | 1.3 |
| `sell_tax` | 1.8 |
| `dev_rug_history` | 3 |
| `dev_wallet_fresh` | 1.1 |
| `dev_balance` | 1.4 |
| `bundled` | 1.7 |
| `concentration` | 1.5 |
| `liquidity_draining` | 2.6 |
| `lp_thin` | 0.8 |

### Pump probability

| Term | Coefficient |
| --- | --- |
| `momentum_score` | 2.1 |
| `smart_buyers` | 2.4 |
| `smart_net_flow` | 1.6 |
| `holder_growth` | 1.9 |
| `volume_surge` | 1.7 |
| `buy_pressure` | 1.3 |
| `liquidity_quality` | 1 |
| `room_to_run` | 0.9 |
| `security_clean` | 0.8 |
| `already_extended` | 1.5 |

### Dump probability

| Term | Coefficient |
| --- | --- |
| `concentration` | 1.8 |
| `sniper_supply` | 1.6 |
| `insider_supply` | 1.4 |
| `whale_outflow` | 2.2 |
| `smart_outflow` | 1.9 |
| `sell_pressure` | 1.7 |
| `parabolic` | 1.5 |
| `thin_liquidity` | 1.2 |
| `holders_stalling` | 1.1 |
| `momentum_quality` | 1.4 |
