import { inverseScale } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Contract security.
 *
 * The highest-weighted group, and the one that also supplies the veto list in
 * the scorer. The distinction is deliberate: a live mint authority is a
 * *penalty* (some legitimate launches revoke late), while a confirmed
 * honeypot is a *veto* (no upside justifies a token that cannot be sold).
 */
export const SECURITY_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'sec.mint_revoked',
    group: 'security',
    label: 'Mint authority revoked',
    weight: 2.4,
    requires: ['security.mintAuthorityRevoked'],
    compute: ({ profile }) => {
      const raw = profile.security.mintAuthorityRevoked ? 1 : 0;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'sec.freeze_revoked',
    group: 'security',
    label: 'Freeze authority revoked',
    weight: 2.2,
    requires: ['security.freezeAuthorityRevoked'],
    compute: ({ profile }) => {
      const raw = profile.security.freezeAuthorityRevoked ? 1 : 0;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'sec.ownership_renounced',
    group: 'security',
    label: 'Ownership renounced',
    weight: 1.6,
    compute: ({ profile }) => {
      const raw = profile.security.ownershipRenounced ? 1 : 0;
      return { raw, normalized: raw ? 1 : 0.25 };
    },
  }),
  defineMetric({
    id: 'sec.lp_secured',
    group: 'security',
    label: 'LP locked or burned',
    weight: 2.3,
    compute: ({ profile }) => {
      const raw = profile.security.lpBurned ? 2 : profile.security.lpLocked ? 1 : 0;
      return { raw, normalized: raw === 2 ? 1 : raw === 1 ? 0.8 : 0 };
    },
  }),
  defineMetric({
    id: 'sec.not_honeypot',
    group: 'security',
    label: 'Sellable (not a honeypot)',
    weight: 2.5,
    requires: ['security.isHoneypot'],
    compute: ({ profile }) => {
      const raw = profile.security.isHoneypot ? 0 : 1;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'sec.buy_tax',
    group: 'security',
    label: 'Buy tax',
    weight: 1.4,
    requires: ['security.buyTaxPct'],
    compute: ({ profile }) => {
      const raw = profile.security.buyTaxPct;
      return { raw, normalized: inverseScale(raw, 0, 10) };
    },
  }),
  defineMetric({
    id: 'sec.sell_tax',
    group: 'security',
    label: 'Sell tax',
    weight: 1.8,
    requires: ['security.sellTaxPct'],
    compute: ({ profile }) => {
      const raw = profile.security.sellTaxPct;
      // Sell tax is worse than buy tax: it is charged on the way out, when
      // the position is already in trouble.
      return { raw, normalized: inverseScale(raw, 0, 8) };
    },
  }),
  defineMetric({
    id: 'sec.no_blacklist',
    group: 'security',
    label: 'No blacklist function',
    weight: 1.7,
    compute: ({ profile }) => {
      const raw = profile.security.hasBlacklistFn ? 0 : 1;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'sec.not_upgradable',
    group: 'security',
    label: 'Not proxy-upgradable',
    weight: 1.5,
    compute: ({ profile }) => {
      const raw = profile.security.isProxyUpgradable ? 0 : 1;
      return { raw, normalized: raw };
    },
  }),
  defineMetric({
    id: 'sec.no_bundle',
    group: 'security',
    label: 'No bundled launch detected',
    weight: 2.0,
    requires: ['holders.bundledPct'],
    compute: ({ profile }) => {
      const raw = profile.security.bundleDetected ? 1 : 0;
      const wallets = profile.security.bundleWallets;
      if (!profile.security.bundleDetected) return { raw: 0, normalized: 1 };
      return { raw, normalized: inverseScale(wallets, 3, 20) * 0.5 };
    },
  }),
];
