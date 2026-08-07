# Installation

## Requirements

| | |
| --- | --- |
| **Node.js** | 20.11 or newer (22 LTS recommended) |
| **npm** | 10 or newer |
| **Disk** | ~200MB for dependencies, plus whatever the database grows to |
| **Network** | Only needed for live mode — paper mode and backtests run offline |

A build toolchain is **not** required. The default storage driver is pure
JavaScript; `better-sqlite3` is an optional dependency and is only loaded if you
select `DB_DRIVER=sqlite`.

---

## Install

```bash
git clone <your-fork> memecoin-bot
cd memecoin-bot
npm install
```

Verify:

```bash
npm run typecheck
npm test
npm run doctor
```

`doctor` prints the resolved configuration and flags anything suspect. It exits
non-zero on a configuration error, so it works as a deployment gate.

---

## Configure

```bash
cp .env.example .env
```

The defaults run paper mode with the built-in simulated market. Nothing else is
required to start:

```bash
npm run dev
```

For anything beyond paper mode, see [CONFIGURATION.md](CONFIGURATION.md).

---

## Wallet setup (live mode only)

Private keys are never read from environment variables in live mode. They are
sealed into an encrypted keystore with AES-256-GCM and a scrypt-derived key.

```bash
# Choose a strong passphrase and keep it out of shell history.
read -rs KEYSTORE_PASSPHRASE && export KEYSTORE_PASSPHRASE

npx tsx src/cli.ts wallet:import --chain solana   --label solana-hot
npx tsx src/cli.ts wallet:import --chain base     --label base-hot
npx tsx src/cli.ts wallet:list
```

The key is prompted for interactively — never passed as an argument, so it does
not land in shell history or a process list.

Accepted formats:

| Chain family | Format |
| --- | --- |
| EVM | `0x`-prefixed 32-byte hex |
| Solana | base58 secret key (Phantom export) or a JSON byte array |

**Operational advice.** Fund the hot wallet with only what the bot is allowed to
lose, keep the rest in cold storage, and set `wallets.maxHotWalletUsd` — the bot
logs an error at startup if the balance exceeds it. Back up `keystore/`; a
leaked backup is useless without the passphrase, but a lost one is unrecoverable.

---

## Docker

```bash
cp .env.example .env      # edit it first
docker compose up -d
docker compose logs -f bot
```

The compose file:

- binds the dashboard to `127.0.0.1` only;
- persists the database in a named volume;
- mounts `./keystore` read-only;
- runs as a non-root user with a health check.

To run live in Docker, set `KEYSTORE_PASSPHRASE` in the environment (via your
orchestrator's secret mechanism, not the `.env` file) and mount the keystore.

---

## Storage backends

| `DB_DRIVER` | When |
| --- | --- |
| `file` (default) | Almost always. Survives restarts, no native dependencies. Comfortable into the thousands of rows per day. |
| `sqlite` | High volume or long retention. Requires `npm i better-sqlite3`, which needs a build toolchain. |
| `memory` | Tests and backtests only. Live mode refuses it. |

Switching drivers does not migrate data. To move, export what you need first —
the trade table is the only irreplaceable one.

---

## Upgrading

```bash
git pull
npm install
npm run typecheck && npm test
npm run docs        # regenerate reference docs if schemas changed
npm run doctor      # confirm your config still validates
```

Configuration is additive and schema-validated: a new field gets its default, and
an invalid one fails loudly at startup rather than silently at 3am.

---

## Troubleshooting

**`No chain could be initialised`** — every configured RPC endpoint failed at
startup. Check `RPC_*` variables; `doctor` lists what it resolved.

**`DB_DRIVER=sqlite requires the optional dependency`** — run
`npm i better-sqlite3` or switch to `DB_DRIVER=file`.

**`KEYSTORE_PASSPHRASE must be set and at least 8 characters`** — export it
before `wallet:import` and before running live.

**`Unable to decrypt keystore entry`** — wrong passphrase or a corrupt file. The
two are indistinguishable by design.

**Dashboard returns 401** — `API_TOKEN` is set. Pass it as
`Authorization: Bearer <token>`, or open the dashboard with `?token=<token>`.

**Nothing trades in paper mode** — expected sometimes: the score threshold is 80
and the simulated market does not always produce a qualifying token quickly.
`npx tsx src/cli.ts scan --passes 10` shows what was scored and why it was
rejected.
