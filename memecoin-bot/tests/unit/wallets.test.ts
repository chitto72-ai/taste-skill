import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keystore } from '../../src/wallets/keystore.js';
import { WalletTracker } from '../../src/wallets/tracker/wallet-tracker.js';
import { Database } from '../../src/database/database.js';
import { MemoryDriver } from '../../src/database/drivers/memory-driver.js';
import { EventBus } from '../../src/core/event-bus.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import type { TrackedWallet } from '../../src/core/domain/wallet.js';

const config = createDefaultConfig();
const SECRET = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('Keystore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bot-keys-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const entry = {
    id: 'wallet_1',
    chain: 'ethereum',
    family: 'evm' as const,
    address: '0xabc',
    label: 'hot',
  };

  it('seals and unseals a key with the right passphrase', async () => {
    const keystore = new Keystore(directory, 'correct horse battery');
    await keystore.seal(entry, SECRET);

    const { privateKey, entry: restored } = await keystore.unseal('wallet_1');
    expect(privateKey).toBe(SECRET);
    expect(restored.address).toBe('0xabc');
  });

  it('never writes the plaintext key to disk', async () => {
    const keystore = new Keystore(directory, 'correct horse battery');
    await keystore.seal(entry, SECRET);
    const raw = await readFile(join(directory, 'wallet_1.json'), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw)).toMatchObject({ version: 1, kdf: 'scrypt' });
  });

  it('refuses to decrypt with the wrong passphrase', async () => {
    await new Keystore(directory, 'correct horse battery').seal(entry, SECRET);
    await expect(new Keystore(directory, 'wrong passphrase').unseal('wallet_1')).rejects.toThrow(
      /wrong passphrase or corrupt/i,
    );
  });

  it('rejects a weak passphrase outright', async () => {
    await expect(new Keystore(directory, 'short').seal(entry, SECRET)).rejects.toThrow(/at least 8/);
  });

  it('reports a missing entry clearly', async () => {
    await expect(new Keystore(directory, 'correct horse battery').unseal('nope')).rejects.toThrow(/No keystore entry/);
  });

  it('lists entries without needing the passphrase', async () => {
    await new Keystore(directory, 'correct horse battery').seal(entry, SECRET);
    const listed = await new Keystore(directory, '').list();
    expect(listed).toHaveLength(1);
    expect(listed[0].address).toBe('0xabc');
  });
});

describe('WalletTracker', () => {
  let database: Database;
  let tracker: WalletTracker;
  let events: EventBus;

  const wallet = (overrides: Partial<TrackedWallet['stats']> = {}, address = '0xwhale'): TrackedWallet => ({
    address,
    chain: 'solana',
    label: 'test',
    tags: ['smart_money'],
    copyEnabled: false,
    firstSeen: Date.now(),
    updatedAt: Date.now(),
    stats: {
      trades: 500,
      wins: 380,
      winRate: 0.76,
      roi: 1.4,
      pnlUsd: 250_000,
      avgHoldMs: 60_000,
      medianPnlPct: 0.2,
      maxDrawdownPct: 15,
      walletAgeDays: 400,
      lastTradeAt: Date.now(),
      rugRate: 0.02,
      ...overrides,
    },
  });

  beforeEach(async () => {
    database = new Database(new MemoryDriver(), { ...config.database, driver: 'memory' }, createNullLogger());
    await database.start();
    events = new EventBus();
    tracker = new WalletTracker({
      config: { ...config.copyTrading, enabled: true },
      database,
      events,
      logger: createNullLogger(),
    });
    await tracker.start();
  });

  afterEach(async () => {
    await tracker.stop();
    await database.stop();
  });

  it('promotes a wallet that clears every criterion', async () => {
    const promoted: string[] = [];
    events.on('wallet.promoted', ({ address }) => {
      promoted.push(address);
    });

    const saved = await tracker.upsert(wallet());
    expect(saved.copyEnabled).toBe(true);
    expect(promoted).toEqual(['0xwhale']);
    expect(tracker.copyable()).toHaveLength(1);
  });

  it.each([
    ['too few trades', { trades: 100 }],
    ['a weak win rate', { winRate: 0.55 }],
    ['a low ROI', { roi: 0.1 }],
    ['insufficient PnL', { pnlUsd: 1_000 }],
    ['a young wallet', { walletAgeDays: 10 }],
    ['a high rug rate', { rugRate: 0.5 }],
  ])('refuses to copy a wallet with %s', async (_label, override) => {
    const saved = await tracker.upsert(wallet(override));
    expect(saved.copyEnabled).toBe(false);
    expect(tracker.copyable()).toHaveLength(0);
  });

  it('never copies a wallet tagged as an insider', async () => {
    const saved = await tracker.upsert({ ...wallet(), tags: ['smart_money', 'insider'] });
    expect(saved.copyEnabled).toBe(false);
    expect(tracker.explain(saved)).toContain('insider');
  });

  it('explains exactly which criteria failed', async () => {
    const explanation = tracker.explain(wallet({ trades: 50, winRate: 0.4 }));
    expect(explanation).toContain('50 trades');
    expect(explanation).toContain('win rate');
  });

  it('aggregates tracked-wallet flow into smart-money signals', async () => {
    await tracker.upsert(wallet());
    const ref = { chain: 'solana' as const, address: 'MemeToken' };

    tracker.record({
      wallet: '0xwhale',
      chain: 'solana',
      tokenAddress: 'MemeToken',
      side: 'buy',
      amountUsd: 25_000,
      price: 0.001,
      txHash: 'sig',
      at: Date.now(),
    });

    const holdings = await tracker.holdings(ref);
    const flows = await tracker.flows(ref, 5 * 60_000);
    expect(holdings?.smartWallets).toBe(1);
    expect(flows?.smartBuyers).toBe(1);
    expect(flows?.smartNetUsd).toBe(25_000);
  });

  it('ignores activity from wallets it does not track', async () => {
    tracker.record({
      wallet: '0xunknown',
      chain: 'solana',
      tokenAddress: 'MemeToken',
      side: 'buy',
      amountUsd: 10_000,
      price: 0.001,
      txHash: 'sig',
      at: Date.now(),
    });
    expect(await tracker.holdings({ chain: 'solana', address: 'MemeToken' })).toBeUndefined();
  });

  it('persists the registry across a restart', async () => {
    await tracker.upsert(wallet());
    const reloaded = new WalletTracker({
      config: { ...config.copyTrading, enabled: true },
      database,
      events,
      logger: createNullLogger(),
    });
    await reloaded.start();
    expect(reloaded.size()).toBe(1);
    expect(reloaded.copyable()).toHaveLength(1);
    await reloaded.stop();
  });
});
