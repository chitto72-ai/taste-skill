import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WalletError } from '../core/errors.js';
import type { ChainId } from '../core/domain/chain.js';

export interface KeystoreEntry {
  readonly id: string;
  readonly chain: ChainId;
  readonly family: 'evm' | 'svm';
  readonly address: string;
  readonly label: string;
  readonly createdAt: number;
}

interface SealedKey extends KeystoreEntry {
  readonly version: 1;
  readonly kdf: 'scrypt';
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

/**
 * scrypt at N=2^15 needs ~32MB of working memory, which is exactly Node's
 * default `maxmem` — so the limit has to be raised explicitly or every seal
 * fails with "memory limit exceeded".
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024, keylen: 32 } as const;

/**
 * Encrypted key storage.
 *
 * AES-256-GCM with a scrypt-derived key. Private keys exist in plaintext only
 * inside `unseal()`'s return value — they are never logged, never written to
 * the database, and never read from environment variables in live mode.
 *
 * The threat model here is a compromised log shipper or a snapshotted disk,
 * not a compromised host with a running process: an attacker who can read this
 * process's memory has already won. What this does buy is that `keystore/`
 * can be backed up, and a leaked backup is useless without the passphrase.
 */
export class Keystore {
  constructor(
    private readonly directory: string,
    private readonly passphrase: string,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // 0700: keys are readable only by the bot's own user.
    await chmod(this.directory, 0o700).catch(() => undefined);
  }

  async list(): Promise<KeystoreEntry[]> {
    if (!existsSync(this.directory)) return [];
    const files = await readdir(this.directory);
    const entries: KeystoreEntry[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const sealed = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as SealedKey;
        entries.push({
          id: sealed.id,
          chain: sealed.chain,
          family: sealed.family,
          address: sealed.address,
          label: sealed.label,
          createdAt: sealed.createdAt,
        });
      } catch {
        // A malformed file must not stop the other keys from loading.
      }
    }
    return entries;
  }

  async seal(entry: Omit<KeystoreEntry, 'createdAt'>, privateKey: string): Promise<void> {
    this.requirePassphrase();
    await this.init();

    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);

    const sealed: SealedKey = {
      version: 1,
      kdf: 'scrypt',
      ...entry,
      createdAt: Date.now(),
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };

    const path = join(this.directory, `${entry.id}.json`);
    await writeFile(path, JSON.stringify(sealed, null, 2), { mode: 0o600 });
  }

  async unseal(id: string): Promise<{ entry: KeystoreEntry; privateKey: string }> {
    this.requirePassphrase();
    const path = join(this.directory, `${id}.json`);
    if (!existsSync(path)) {
      throw new WalletError(`No keystore entry "${id}" in ${this.directory}`, { id });
    }

    const sealed = JSON.parse(await readFile(path, 'utf8')) as SealedKey;
    const key = scryptSync(this.passphrase, Buffer.from(sealed.salt, 'base64'), SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

    let privateKey: string;
    try {
      privateKey = Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      // GCM authentication failure: wrong passphrase or a tampered file. The
      // two are indistinguishable by design.
      throw new WalletError(`Unable to decrypt keystore entry "${id}" — wrong passphrase or corrupt file`, { id }, error);
    }

    return {
      entry: {
        id: sealed.id,
        chain: sealed.chain,
        family: sealed.family,
        address: sealed.address,
        label: sealed.label,
        createdAt: sealed.createdAt,
      },
      privateKey,
    };
  }

  /** Verifies the passphrase against a sealed entry without exposing the key. */
  async verify(id: string): Promise<boolean> {
    try {
      const { privateKey } = await this.unseal(id);
      const probe = Buffer.from(privateKey.slice(0, 8));
      return timingSafeEqual(probe, probe);
    } catch {
      return false;
    }
  }

  private requirePassphrase(): void {
    if (!this.passphrase || this.passphrase.length < 8) {
      throw new WalletError('KEYSTORE_PASSPHRASE must be set and at least 8 characters long');
    }
  }
}
