<!-- GENERATED FILE — do not edit by hand. Run `npm run docs` to regenerate. -->

# Configuration reference


Every field below is settable in `config.json`. A subset is also settable by
environment variable — see `.env.example`. Resolution order is:

```
defaults -> mode preset -> config.json -> environment -> CLI flags
```

## `mode`

_`live` \| `paper` \| `backtest`_

## `env`

_`development` \| `staging` \| `production`_

## `enabledChains`

_string[]_

## `chains`

_record_

## `exchange`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `primary` | `axiom` \| `paper` | `paper` |  |
| `axiom.enabled` | boolean | `false` |  |
| `axiom.restUrl` | string | `https://api.axiom.trade` |  |
| `axiom.wsUrl` | string | `wss://api.axiom.trade/ws` |  |
| `axiom.apiKey` | string | `` |  |
| `axiom.apiSecret` | string | `` |  |
| `axiom.timeoutMs` | number | `10000` |  |
| `axiom.maxRps` | number | `8` |  |
| `axiom.reconnectMaxMs` | number | `30000` |  |
| `axiom.privateTx` | boolean | `true` |  |
| `paper.baseSlippageBps` | number | `50` |  |
| `paper.impactBpsPerPct` | number | `120` |  |
| `paper.feeBps` | number | `100` |  |
| `paper.gasUsdPerTrade` | number | `0.75` |  |
| `paper.latencyMs` | number | `400` |  |
| `paper.failureRate` | number | `0.02` |  |

## `discovery`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` |  |
| `scanIntervalMs` | number | `3000` |  |
| `concurrency` | number | `8` |  |
| `maxCandidatesPerScan` | number | `50` |  |
| `minLiquidityUsd` | number | `25000` |  |
| `maxLiquidityUsd` | number | `5000000` |  |
| `minMarketCapUsd` | number | `30000` |  |
| `maxMarketCapUsd` | number | `20000000` |  |
| `minHolders` | number | `80` |  |
| `minVolume5mUsd` | number | `15000` |  |
| `maxTokenAgeMinutes` | number | `1440` |  |
| `minTokenAgeSeconds` | number | `60` |  |
| `profileTtlMs` | number | `900000` |  |
| `denyListTokens` | string[] | `[]` |  |
| `denyListDevWallets` | string[] | `[]` |  |

## `scoring`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `minScore` | number | `80` |  |
| `weights.liquidity` | number | `1` |  |
| `weights.momentum` | number | `1.2` |  |
| `weights.holders` | number | `1` |  |
| `weights.whales` | number | `1.1` |  |
| `weights.community` | number | `0.6` |  |
| `weights.developer` | number | `0.9` |  |
| `weights.security` | number | `1.6` |  |
| `maxRugProbability` | number | `0.2` |  |
| `minPumpProbability` | number | `0.35` |  |
| `maxDumpProbability` | number | `0.55` |  |
| `minConfidence` | number | `0.6` |  |

## `entry`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `requireVolumeGrowth` | boolean | `true` |  |
| `requireHolderGrowth` | boolean | `true` |  |
| `requireSmartMoney` | boolean | `true` |  |
| `requireWhaleBuying` | boolean | `true` |  |
| `requirePositiveMomentum` | boolean | `true` |  |
| `minVolumeGrowth5m` | number | `0.25` |  |
| `minHolderGrowth5m` | number | `0.05` |  |
| `minSmartWalletsBuying` | number | `2` |  |
| `minWhaleNetFlowUsd` | number | `5000` |  |
| `minLiquidityUsd` | number | `25000` |  |
| `maxTop10HolderPct` | number | `0.35` |  |
| `maxBundledPct` | number | `0.15` |  |
| `maxDevHoldingPct` | number | `0.1` |  |
| `maxBuyTaxPct` | number | `5` |  |
| `maxSellTaxPct` | number | `5` |  |
| `minBuySellRatio` | number | `1.4` |  |
| `maxSlippageBps` | number | `300` |  |
| `maxPoolImpactPct` | number | `0.02` |  |

## `risk`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `baseCapital` | number | `10000` |  |
| `riskPerTradePct` | number | `0.5` |  |
| `maxConcurrentPositions` | number | `5` |  |
| `maxPositionPctOfEquity` | number | `0.15` |  |
| `minPositionUsd` | number | `20` |  |
| `kellyFraction` | number | `0.25` |  |
| `kellyCap` | number | `0.1` |  |
| `maxConsecutiveStops` | number | `3` |  |
| `maxDailyDrawdownPct` | number | `5` |  |
| `maxTotalDrawdownPct` | number | `20` |  |
| `maxEquityVolatility` | number | `0.08` |  |
| `haltCooldownMs` | number | `3600000` |  |
| `maxExposurePerChainPct` | number | `0.5` |  |
| `maxDailyTrades` | number | `60` |  |
| `maxGasPctOfPosition` | number | `0.05` |  |

## `exit`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `stopLossPct` | number | `25` |  |
| `atrStopMultiplier` | number | `2.5` |  |
| `useDynamicStop` | boolean | `true` |  |
| `breakEvenTriggerPct` | number | `20` |  |
| `breakEvenOffsetPct` | number | `2` |  |
| `trailingActivationPct` | number | `35` |  |
| `trailingDistancePct` | number | `18` |  |
| `finalTrailingDistancePct` | number | `30` |  |
| `timeStopMs` | number | `14400000` |  |
| `timeStopMinProgressPct` | number | `5` |  |
| `emergencyLiquidityDropPct` | number | `0.4` |  |
| `emergencyPriceDropPct` | number | `0.3` |  |
| `emergencySellTaxPct` | number | `20` |  |
| `takeProfitLevels` | object[] | `[4 items]` |  |

## `copyTrading`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` |  |
| `minWinRate` | number | `0.7` |  |
| `minTrades` | number | `300` |  |
| `minRoi` | number | `0.5` |  |
| `minPnlUsd` | number | `50000` |  |
| `minWalletAgeDays` | number | `90` |  |
| `maxRugRate` | number | `0.1` |  |
| `sizeMultiplier` | number | `0.5` |  |
| `maxFollowedWallets` | number | `25` |  |
| `maxSignalAgeMs` | number | `20000` |  |
| `minTokenScore` | number | `65` |  |
| `mirrorExits` | boolean | `true` |  |

## `wallets`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `keystoreDir` | string | `./keystore` |  |
| `passphrase` | string | `` |  |
| `gasReserveUsd` | number | `25` |  |
| `maxHotWalletUsd` | number | `50000` |  |

## `database`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `driver` | `memory` \| `file` \| `sqlite` | `file` |  |
| `path` | string | `./data/bot.db` |  |
| `flushIntervalMs` | number | `5000` |  |
| `retentionDays` | number | `90` |  |
| `metricRetentionDays` | number | `14` |  |

## `api`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` |  |
| `host` | string | `127.0.0.1` |  |
| `port` | number | `8080` |  |
| `token` | string | `` |  |
| `corsOrigins` | string[] | `[]` |  |
| `broadcastIntervalMs` | number | `2000` |  |

## `backtest`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `dataDir` | string | `./data/historical` |  |
| `startingCapital` | number | `10000` |  |
| `latencyMs` | number | `600` |  |
| `slippageBps` | number | `80` |  |
| `feeBps` | number | `100` |  |
| `gasUsdPerTrade` | number | `0.75` |  |
| `barIntervalMs` | number | `60000` |  |
| `warmupBars` | number | `5` |  |

## `logging`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `level` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` | `info` |  |
| `format` | `pretty` \| `json` | `pretty` |  |
| `file` | string | `` |  |
| `persistToDatabase` | boolean | `true` |  |
| `databaseMinLevel` | `debug` \| `info` \| `warn` \| `error` | `info` |  |
