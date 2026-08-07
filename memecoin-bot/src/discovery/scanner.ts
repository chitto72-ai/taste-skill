import type { TokenProfile, TokenRef } from '../core/domain/token.js';
import { tokenKey } from '../core/domain/token.js';
import type { TokenScore } from '../core/domain/scoring.js';
import type { EventBus } from '../core/event-bus.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import { TtlCache } from '../core/utils/cache.js';
import { WorkQueue } from '../core/utils/queue.js';
import { mapConcurrent } from '../core/utils/async.js';
import type { Logger } from '../logger/logger.js';
import type { DiscoveryConfig } from '../config/schema.js';
import type { TokenScorer } from '../scoring/scorer.js';
import { CandidateFilter } from './filters.js';
import { EnrichmentPipeline } from './pipeline.js';
import type { DiscoveryStats, TokenCandidate, TokenFeed } from './types.js';

export interface ScannerOptions {
  readonly feeds: readonly TokenFeed[];
  readonly pipeline: EnrichmentPipeline;
  readonly scorer: TokenScorer;
  readonly config: DiscoveryConfig;
  readonly minScore: number;
  readonly events: EventBus;
  readonly logger: Logger;
}

interface TrackedToken {
  profile: TokenProfile;
  score: TokenScore;
  missing: readonly string[];
}

/**
 * The continuous discovery loop.
 *
 * One tick: poll every feed, drop the obvious rejects with cheap filters,
 * enrich what survives in parallel, score it, and publish. Tokens that clear
 * the threshold are emitted as `token.scored`; everything else is emitted as
 * `token.rejected` so the dashboard can show *why* the bot is not trading,
 * which in practice is the question operators ask most.
 *
 * Ticks never overlap: if enrichment is slower than the interval the next tick
 * is skipped rather than queued, because stacking scans behind a degraded
 * provider is how a scanner turns into a memory leak.
 */
export class TokenScanner implements Service {
  readonly name = 'scanner';

  private readonly filter: CandidateFilter;
  private readonly tracked: TtlCache<string, TrackedToken>;
  private readonly queue: WorkQueue;
  private readonly logger: Logger;

  private timer: NodeJS.Timeout | undefined;
  private scanning = false;
  private stopped = true;
  private stats = {
    scans: 0,
    candidates: 0,
    filtered: 0,
    enriched: 0,
    scored: 0,
    accepted: 0,
    errors: 0,
    lastScanAt: 0,
    scanMsTotal: 0,
  };

  constructor(private readonly options: ScannerOptions) {
    this.logger = options.logger.child(this.name);
    this.filter = new CandidateFilter(options.config);
    this.tracked = new TtlCache({ ttlMs: options.config.profileTtlMs, maxEntries: 2_000 });
    this.queue = new WorkQueue({
      name: 'enrichment',
      concurrency: options.config.concurrency,
      maxQueued: options.config.maxCandidatesPerScan * 4,
      onError: (error) => {
        this.stats.errors++;
        this.logger.debug({ err: error }, 'enrichment task failed');
      },
    });
  }

  async start(): Promise<void> {
    if (!this.options.config.enabled) {
      this.logger.warn('discovery is disabled by configuration');
      return;
    }
    this.stopped = false;
    for (const feed of this.options.feeds) await feed.start?.();

    // Run one scan immediately so the bot is not idle for a full interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.config.scanIntervalMs);
    this.timer.unref?.();
    this.logger.info(
      { feeds: this.options.feeds.map((f) => f.name), intervalMs: this.options.config.scanIntervalMs },
      'scanner started',
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.queue.clear('scanner stopping');
    for (const feed of this.options.feeds) await feed.stop?.();
    this.logger.info({ ...this.snapshot() }, 'scanner stopped');
  }

  /** One full discovery pass. Public so tests and the CLI can drive it. */
  async tick(): Promise<TrackedToken[]> {
    if (this.scanning || this.stopped) return [];
    this.scanning = true;
    const started = Date.now();
    const accepted: TrackedToken[] = [];

    try {
      const candidates = await this.pollFeeds();
      this.stats.candidates += candidates.length;

      const survivors: TokenCandidate[] = [];
      for (const candidate of candidates) {
        const outcome = this.filter.apply(candidate, started);
        if (outcome.passed) survivors.push(candidate);
        else this.stats.filtered++;
      }

      const limited = survivors.slice(0, this.options.config.maxCandidatesPerScan);
      const results = await mapConcurrent(limited, this.options.config.concurrency, (candidate) =>
        this.queue
          .push(`enrich:${candidate.ref.address}`, () => this.evaluate(candidate), 0)
          .catch((error) => {
            this.stats.errors++;
            this.logger.debug({ token: candidate.ref.address, err: error }, 'candidate evaluation failed');
            return undefined;
          }),
      );

      for (const result of results) {
        if (result?.accepted) accepted.push(result.tracked);
      }

      this.stats.scans++;
      this.stats.lastScanAt = started;
      this.stats.scanMsTotal += Date.now() - started;
      this.options.events.emit('engine.tick', { seq: this.stats.scans, at: started });
    } catch (error) {
      this.stats.errors++;
      this.logger.error({ err: error }, 'scan failed');
    } finally {
      this.scanning = false;
    }
    return accepted;
  }

  /** Currently tracked, above-threshold tokens, best first. */
  candidates(): TrackedToken[] {
    return this.tracked
      .values()
      .filter((entry) => entry.score.total >= this.options.minScore)
      .sort((a, b) => b.score.total - a.score.total);
  }

  profileOf(ref: TokenRef): TokenProfile | undefined {
    return this.tracked.get(tokenKey(ref))?.profile;
  }

  scoreOf(ref: TokenRef): TokenScore | undefined {
    return this.tracked.get(tokenKey(ref))?.score;
  }

  snapshot(): DiscoveryStats {
    return {
      scans: this.stats.scans,
      candidates: this.stats.candidates,
      filtered: this.stats.filtered,
      enriched: this.stats.enriched,
      scored: this.stats.scored,
      accepted: this.stats.accepted,
      errors: this.stats.errors,
      lastScanAt: this.stats.lastScanAt,
      avgScanMs: this.stats.scans === 0 ? 0 : Math.round(this.stats.scanMsTotal / this.stats.scans),
      trackedTokens: this.tracked.stats().size,
    };
  }

  health(): HealthReport {
    const stale = this.stats.lastScanAt > 0 && Date.now() - this.stats.lastScanAt > this.options.config.scanIntervalMs * 5;
    return {
      component: this.name,
      healthy: !this.stopped && !stale,
      detail: stale ? 'no successful scan recently' : `${this.stats.scans} scans completed`,
      checkedAt: Date.now(),
      metrics: { ...this.snapshot() },
    };
  }

  private async pollFeeds(): Promise<TokenCandidate[]> {
    const batches = await Promise.all(
      this.options.feeds.map(async (feed) => {
        try {
          return await feed.poll();
        } catch (error) {
          this.stats.errors++;
          this.logger.warn({ feed: feed.name, err: error }, 'feed poll failed');
          return [];
        }
      }),
    );

    // De-duplicate across feeds, keeping the freshest observation.
    const byKey = new Map<string, TokenCandidate>();
    for (const candidate of batches.flat()) {
      const key = tokenKey(candidate.ref);
      const existing = byKey.get(key);
      if (!existing || candidate.at > existing.at) byKey.set(key, candidate);
    }
    return [...byKey.values()];
  }

  private async evaluate(candidate: TokenCandidate): Promise<{ accepted: boolean; tracked: TrackedToken }> {
    const { profile, missing } = await this.options.pipeline.run(candidate);
    this.stats.enriched++;

    const score = this.options.scorer.score(profile, missing, candidate.at);
    this.stats.scored++;

    const tracked: TrackedToken = { profile, score, missing };
    const key = tokenKey(profile.ref);
    const isNew = this.tracked.get(key) === undefined;
    this.tracked.set(key, tracked);

    this.options.events.emit(isNew ? 'token.discovered' : 'token.updated', { profile });

    if (score.vetoes.length > 0) {
      this.options.events.emit('token.rejected', { profile, score, reason: score.vetoes[0] });
      return { accepted: false, tracked };
    }
    if (score.total < this.options.minScore) {
      this.options.events.emit('token.rejected', {
        profile,
        score,
        reason: `score ${score.total} below threshold ${this.options.minScore}`,
      });
      return { accepted: false, tracked };
    }

    this.stats.accepted++;
    this.options.events.emit('token.scored', { profile, score });
    this.logger.info(
      {
        token: profile.metadata.symbol,
        chain: profile.ref.chain,
        score: score.total,
        rug: Number(score.probabilities.rug.toFixed(3)),
        pump: Number(score.probabilities.pump.toFixed(3)),
        confidence: Number(score.confidence.toFixed(2)),
      },
      'token cleared the score threshold',
    );
    return { accepted: true, tracked };
  }
}
