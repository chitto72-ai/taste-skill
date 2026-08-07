import { describe, expect, it } from 'vitest';
import { CandidateFilter } from '../../src/discovery/filters.js';
import { EnrichmentPipeline } from '../../src/discovery/pipeline.js';
import { TokenScanner } from '../../src/discovery/scanner.js';
import { SyntheticTokenFeed } from '../../src/discovery/sources/synthetic-feed.js';
import { DeveloperEnricher } from '../../src/discovery/enrichment/developer-enricher.js';
import { SmartMoneyEnricher } from '../../src/discovery/enrichment/smart-money-enricher.js';
import { SocialEnricher } from '../../src/discovery/enrichment/social-enricher.js';
import type { Enricher, TokenFeed } from '../../src/discovery/types.js';
import { TokenScorer } from '../../src/scoring/scorer.js';
import { EventBus } from '../../src/core/event-bus.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { candidateFrom, healthyProfile, TEST_NOW } from '../helpers/factories.js';

const config = createDefaultConfig();
const logger = createNullLogger();

describe('CandidateFilter', () => {
  const filter = new CandidateFilter(config.discovery);

  it('accepts a healthy candidate', () => {
    expect(filter.apply(candidateFrom(healthyProfile()), TEST_NOW).passed).toBe(true);
  });

  it('rejects a token that is too young to judge', () => {
    const candidate = candidateFrom(healthyProfile({ metadata: { createdAt: TEST_NOW - 10_000 } }));
    const outcome = filter.apply(candidate, TEST_NOW);
    expect(outcome.passed).toBe(false);
    expect(outcome.reason).toContain('too young');
  });

  it('rejects a stale token', () => {
    const candidate = candidateFrom(
      healthyProfile({ metadata: { createdAt: TEST_NOW - 3 * 24 * 60 * 60_000 } }),
    );
    expect(filter.apply(candidate, TEST_NOW).reason).toContain('too old');
  });

  it('rejects thin liquidity and low volume', () => {
    expect(
      filter.apply(candidateFrom(healthyProfile({ market: { liquidityUsd: 1_000 } })), TEST_NOW).reason,
    ).toContain('liquidity');
    expect(
      filter.apply(candidateFrom(healthyProfile({ market: { volume5mUsd: 100 } })), TEST_NOW).reason,
    ).toContain('volume');
  });

  it('rejects a pool with no recent transactions', () => {
    const candidate = candidateFrom(healthyProfile({ market: { txns5m: { buys: 0, sells: 0 } } }));
    expect(filter.apply(candidate, TEST_NOW).reason).toContain('no transactions');
  });

  it('rejects deny-listed tokens and developers', () => {
    const profile = healthyProfile();
    const denyTokens = new CandidateFilter({
      ...config.discovery,
      denyListTokens: [profile.ref.address.toUpperCase()],
    });
    expect(denyTokens.apply(candidateFrom(profile), TEST_NOW).reason).toContain('deny-listed');

    const denyDevs = new CandidateFilter({
      ...config.discovery,
      denyListDevWallets: [profile.developer.wallet],
    });
    expect(denyDevs.apply(candidateFrom(profile), TEST_NOW).reason).toContain('developer');
  });
});

describe('EnrichmentPipeline', () => {
  it('merges enricher slices and collects missing fields', async () => {
    const stage: Enricher = {
      name: 'stub',
      slice: 'holders',
      enrich: async () => ({ holders: { count: 4_321 }, missing: ['holders.growth5m'] }),
    };
    const pipeline = new EnrichmentPipeline({ enrichers: [stage], logger });
    const { profile, missing } = await pipeline.run(candidateFrom(healthyProfile()));

    expect(profile.holders.count).toBe(4_321);
    expect(missing).toContain('holders.growth5m');
  });

  it('survives a stage that throws, marking the whole slice missing', async () => {
    const broken: Enricher = {
      name: 'broken',
      slice: 'security',
      enrich: async () => {
        throw new Error('provider down');
      },
    };
    const pipeline = new EnrichmentPipeline({ enrichers: [broken], logger });
    const { profile, missing } = await pipeline.run(candidateFrom(healthyProfile()));

    expect(profile.ref.address).toBeTruthy();
    expect(missing).toContain('security.*');
  });

  it('survives a stage that hangs past its budget', async () => {
    const slow: Enricher = {
      name: 'slow',
      slice: 'social',
      enrich: () => new Promise(() => {}),
    };
    const pipeline = new EnrichmentPipeline({ enrichers: [slow], logger, stageTimeoutMs: 20 });
    const { missing } = await pipeline.run(candidateFrom(healthyProfile()));
    expect(missing).toContain('social.*');
  });

  it('accumulates price history across runs', async () => {
    const pipeline = new EnrichmentPipeline({ enrichers: [], logger });
    const first = await pipeline.run(candidateFrom(healthyProfile()));
    const second = await pipeline.run(
      candidateFrom(healthyProfile({ market: { at: TEST_NOW + 60_000, priceUsd: 0.002 } })),
    );
    expect(second.profile.priceHistory.length).toBeGreaterThan(first.profile.priceHistory.length);
    expect(second.profile.discoveredAt).toBe(first.profile.discoveredAt);
  });
});

describe('enrichers', () => {
  it('reports developer fields as missing only when nothing supplies them', async () => {
    const enricher = new DeveloperEnricher(undefined, logger);

    const fromFeed = await enricher.enrich(candidateFrom(healthyProfile()));
    expect(fromFeed.missing).not.toContain('developer.tokensLaunched');

    const unknown = await enricher.enrich({
      ...candidateFrom(healthyProfile()),
      developer: { wallet: 'unknown-dev' },
    });
    expect(unknown.missing).toContain('developer.tokensLaunched');
  });

  it('falls back to feed values when no smart-money source is wired', async () => {
    const enricher = new SmartMoneyEnricher(undefined, logger);
    const result = await enricher.enrich(candidateFrom(healthyProfile()));
    expect(result.smartMoney?.smartWalletsBuying5m).toBe(4);
  });

  it('derives a sentiment score when no social provider is configured', async () => {
    const enricher = new SocialEnricher(undefined, logger);
    const result = await enricher.enrich({
      ...candidateFrom(healthyProfile()),
      social: { twitterFollowers: 20_000, telegramMembers: 5_000 },
    });
    expect(result.social?.sentiment).toBeGreaterThan(0);
    expect(result.social?.sentiment).toBeLessThanOrEqual(100);
  });
});

describe('SyntheticTokenFeed', () => {
  it('is deterministic for a given seed', async () => {
    const a = new SyntheticTokenFeed({ chains: ['solana'], seed: 7 });
    const b = new SyntheticTokenFeed({ chains: ['solana'], seed: 7 });
    const first = await a.poll();
    const second = await b.poll();
    expect(first.map((c) => c.ref.address)).toEqual(second.map((c) => c.ref.address));
    expect(first[0]?.market.priceUsd).toBe(second[0]?.market.priceUsd);
  });

  it('exposes prices for the paper venue', async () => {
    const feed = new SyntheticTokenFeed({ chains: ['solana'], seed: 3 });
    const [candidate] = await feed.poll();
    expect(feed.priceOf(candidate.ref)).toBeGreaterThan(0);
    expect(feed.liquidityOf(candidate.ref)).toBeGreaterThan(0);
  });
});

describe('TokenScanner', () => {
  // The scanner filters against wall-clock time, so these fixtures are built
  // at `Date.now()` rather than the frozen timestamp the other suites use.
  const now = () => Date.now();

  function scannerWith(feed: TokenFeed, events = new EventBus()): TokenScanner {
    return new TokenScanner({
      feeds: [feed],
      pipeline: new EnrichmentPipeline({ enrichers: [], logger }),
      scorer: new TokenScorer({ config: config.scoring }),
      config: config.discovery,
      minScore: config.scoring.minScore,
      events,
      logger,
    });
  }

  const feedOf = (candidates: ReturnType<typeof candidateFrom>[]): TokenFeed => ({
    name: 'test',
    chains: ['solana'],
    poll: async () => candidates,
    refresh: async () => new Map(),
  });

  it('publishes a token that clears the threshold', async () => {
    const events = new EventBus();
    const scored: number[] = [];
    events.on('token.scored', ({ score }) => {
      scored.push(score.total);
    });

    const scanner = scannerWith(feedOf([candidateFrom(healthyProfile({}, now()))]), events);
    await scanner.start();
    await scanner.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0]).toBeGreaterThanOrEqual(config.scoring.minScore);
    expect(scanner.candidates()).toHaveLength(1);
    await scanner.stop();
  });

  it('publishes a rejection reason for a vetoed token', async () => {
    const events = new EventBus();
    const reasons: string[] = [];
    events.on('token.rejected', ({ reason }) => {
      reasons.push(reason);
    });

    const scanner = scannerWith(
      feedOf([candidateFrom(healthyProfile({ security: { isHoneypot: true } }, now()))]),
      events,
    );
    await scanner.start();
    await scanner.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reasons.join(' ')).toContain('honeypot');
    await scanner.stop();
  });

  it('keeps scanning when a feed throws', async () => {
    const broken: TokenFeed = {
      name: 'broken',
      chains: ['solana'],
      poll: async () => {
        throw new Error('feed down');
      },
      refresh: async () => new Map(),
    };
    const scanner = scannerWith(broken);
    await scanner.start();
    await scanner.tick();
    expect(scanner.snapshot().errors).toBeGreaterThan(0);
    expect(scanner.health().healthy).toBe(true);
    await scanner.stop();
  });

  it('de-duplicates the same token across feeds', async () => {
    const candidate = candidateFrom(healthyProfile({}, now()));
    const scanner = new TokenScanner({
      feeds: [feedOf([candidate]), feedOf([candidate])],
      pipeline: new EnrichmentPipeline({ enrichers: [], logger }),
      scorer: new TokenScorer({ config: config.scoring }),
      config: config.discovery,
      minScore: config.scoring.minScore,
      events: new EventBus(),
      logger,
    });
    await scanner.start();
    await scanner.tick();
    // start() kicks off the first scan itself; let it settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scanner.snapshot().enriched).toBe(1);
    await scanner.stop();
  });
});
