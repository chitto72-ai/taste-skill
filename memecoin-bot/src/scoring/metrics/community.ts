import { clamp01, lerp, logScale } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Community metrics.
 *
 * Weighted lowest of all groups. Follower counts and member counts are the
 * cheapest numbers in crypto to manufacture, so absolute size is capped early
 * and the weight sits mostly on growth rate and on whether socials exist at
 * all — a token with no social footprint is a different risk class from one
 * with a small but real one.
 */
export const COMMUNITY_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'com.twitter_followers',
    group: 'community',
    label: 'Twitter followers',
    weight: 0.9,
    requires: ['social.twitterFollowers'],
    compute: ({ profile }) => {
      const raw = profile.social.twitterFollowers;
      return { raw, normalized: logScale(raw, 200, 50_000) };
    },
  }),
  defineMetric({
    id: 'com.twitter_growth',
    group: 'community',
    label: 'Twitter growth (1h)',
    weight: 1.6,
    requires: ['social.twitterGrowth1h'],
    compute: ({ profile }) => {
      const raw = profile.social.twitterGrowth1h;
      return { raw, normalized: clamp01(lerp(raw, 0, 0.2, 0.4, 1)) };
    },
  }),
  defineMetric({
    id: 'com.twitter_mentions',
    group: 'community',
    label: 'Twitter mentions (1h)',
    weight: 1.2,
    compute: ({ profile }) => {
      const raw = profile.social.twitterMentions1h;
      return { raw, normalized: logScale(raw, 5, 2_000) };
    },
  }),
  defineMetric({
    id: 'com.telegram_members',
    group: 'community',
    label: 'Telegram members',
    weight: 0.8,
    requires: ['social.telegramMembers'],
    compute: ({ profile }) => {
      const raw = profile.social.telegramMembers;
      return { raw, normalized: logScale(raw, 100, 20_000) };
    },
  }),
  defineMetric({
    id: 'com.telegram_growth',
    group: 'community',
    label: 'Telegram growth (1h)',
    weight: 1.3,
    compute: ({ profile }) => {
      const raw = profile.social.telegramGrowth1h;
      return { raw, normalized: clamp01(lerp(raw, 0, 0.2, 0.5, 1)) };
    },
  }),
  defineMetric({
    id: 'com.verified_socials',
    group: 'community',
    label: 'Verified socials present',
    weight: 1.1,
    compute: ({ profile }) => {
      const raw = profile.social.hasVerifiedSocials ? 1 : 0;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'com.sentiment',
    group: 'community',
    label: 'Sentiment score',
    weight: 1.0,
    compute: ({ profile }) => {
      const raw = profile.social.sentiment;
      return { raw, normalized: clamp01(raw / 100) };
    },
  }),
];
