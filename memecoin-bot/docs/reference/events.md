<!-- GENERATED FILE — do not edit by hand. Run `npm run docs` to regenerate. -->

# Event catalogue


Modules communicate exclusively through these events (`src/core/events.ts`).
Subscribing to them is the supported way to extend the bot without modifying it.

| Event | Meaning |
| --- | --- |
| `engine.started` | The engine finished starting every managed service. |
| `engine.stopping` | Shutdown began; services are about to stop. |
| `engine.stopped` | Every service has stopped. |
| `engine.tick` | A discovery scan completed. |
| `token.discovered` | A token was seen for the first time. |
| `token.updated` | An already-tracked token was re-observed. |
| `token.scored` | A token cleared the score threshold and has no vetoes. |
| `token.rejected` | A token was scored and rejected; the payload says why. |
| `token.evaluated` | A strategy evaluated a token, pass or fail, with conditions. |
| `signal.entry` | A strategy produced an entry signal that cleared risk. |
| `signal.exit` | An exit rule fired for an open position. |
| `order.submitted` | An order was handed to the execution router. |
| `order.filled` | An order filled, fully or partially. |
| `order.rejected` | An order was rejected after all retries. |
| `position.opened` | A position was created from a fill. |
| `position.updated` | Position state changed without a fill. |
| `position.partial_exit` | A take-profit level or partial exit filled. |
| `position.closed` | A position closed; a trade record was written. |
| `risk.rejected` | An entry was blocked by a risk limit. |
| `risk.halted` | A circuit breaker tripped; new entries are blocked. |
| `risk.resumed` | Trading resumed after a halt. |
| `risk.updated` | Equity, drawdown or open-position count changed. |
| `wallet.activity` | A tracked wallet traded. |
| `wallet.promoted` | A wallet now qualifies for copy trading. |
| `wallet.demoted` | A wallet no longer qualifies for copy trading. |
| `chain.tx_confirmed` | A transaction reached its confirmation target. |
| `chain.rpc_failover` | An RPC call moved to a different endpoint. |
| `health.changed` | A component became healthy or unhealthy. |
| `error.occurred` | An error was captured and persisted. |
