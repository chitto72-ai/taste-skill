import type { SocialStats } from '../../core/domain/token.js';
import { TtlCache } from '../../core/utils/cache.js';
import { clamp, clamp01, logScale, pctChange } from '../../core/utils/math.js';
import type { Logger } from '../../logger/logger.js';
import type { Enricher, EnrichmentResult, TokenCandidate } from '../types.js';

export interface SocialSnapshot {
  readonly twitterFollowers: number;
  readonly twitterMentions1h: number;
  readonly telegramMembers: number;
  readonly verified: boolean;
}

/** Upstream social provider (Twitter/X, Telegram). Optional by design. */
export interface SocialProvider {
  readonly name: string;
  fetch(handleOrUrl: { twitter?: string; telegram?: string }): Promise<SocialSnapshot | undefined>;
}

interface SocialHistory {
  followers: number;
  members: number;
  at: number;
}

/**
 * Community signal.
 *
 * Weighted lightly on purpose: social metrics are the easiest part of a
 * memecoin to fake, and a bought follower count correlates with rugs rather
 * than against them. Growth *rate* is what carries signal here, so the stage
 * keeps its own history instead of trusting a provider's window.
 */
export class SocialEnricher implements Enricher {
  readonly name = 'social';
  readonly slice = 'social' as const;

  private readonly history = new TtlCache<string, SocialHistory>({ ttlMs: 6 * 60 * 60_000, maxEntries: 5_000 });
  private readonly logger: Logger;

  constructor(
    private readonly provider: SocialProvider | undefined,
    logger: Logger,
  ) {
    this.logger = logger.child('enricher:social');
  }

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    const key = `${candidate.ref.chain}:${candidate.ref.address}`;
    const feed = candidate.social ?? {};
    const missing: string[] = [];

    let snapshot: SocialSnapshot | undefined;
    const handles = { twitter: candidate.metadata.twitter, telegram: candidate.metadata.telegram };
    if (this.provider && (handles.twitter || handles.telegram)) {
      try {
        snapshot = await this.provider.fetch(handles);
      } catch (error) {
        this.logger.debug({ token: candidate.ref.address, err: error }, 'social provider failed');
      }
    }

    const followers = feed.twitterFollowers ?? snapshot?.twitterFollowers ?? 0;
    const members = feed.telegramMembers ?? snapshot?.telegramMembers ?? 0;
    const previous = this.history.get(key);

    const twitterGrowth1h =
      feed.twitterGrowth1h ?? (previous ? scaleToHour(pctChange(previous.followers, followers), candidate.at - previous.at) : 0);
    const telegramGrowth1h =
      feed.telegramGrowth1h ?? (previous ? scaleToHour(pctChange(previous.members, members), candidate.at - previous.at) : 0);

    this.history.set(key, { followers, members, at: candidate.at });

    if (feed.twitterFollowers === undefined && !snapshot) missing.push('social.twitterFollowers');
    if (feed.telegramMembers === undefined && !snapshot) missing.push('social.telegramMembers');
    if (!previous && feed.twitterGrowth1h === undefined) missing.push('social.twitterGrowth1h');

    const hasVerifiedSocials =
      feed.hasVerifiedSocials ?? snapshot?.verified ?? Boolean(handles.twitter && handles.telegram);

    const stats: Partial<SocialStats> = {
      twitterFollowers: followers,
      twitterMentions1h: feed.twitterMentions1h ?? snapshot?.twitterMentions1h ?? 0,
      twitterGrowth1h,
      telegramMembers: members,
      telegramGrowth1h,
      hasVerifiedSocials,
      sentiment: feed.sentiment ?? this.deriveSentiment(followers, members, twitterGrowth1h, hasVerifiedSocials),
    };

    return { social: stats, missing };
  }

  /** Fallback composite when no sentiment provider is configured. */
  private deriveSentiment(
    followers: number,
    members: number,
    growth: number,
    verified: boolean,
  ): number {
    const reach = logScale(followers + members, 100, 100_000);
    const momentum = clamp01(growth / 0.5);
    const trust = verified ? 1 : 0.4;
    return Math.round(clamp((reach * 0.4 + momentum * 0.4 + trust * 0.2) * 100, 0, 100));
  }
}

/** Normalizes an observed change over an arbitrary window to a 1h rate. */
function scaleToHour(change: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const hours = elapsedMs / 3_600_000;
  return clamp(change / Math.max(hours, 1 / 60), -1, 10);
}
