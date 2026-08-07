import type { GroupedMetrics, PerformanceMetrics } from './performance.js';
import type { CurveStats } from './equity-curve.js';

const usd = (value: number): string =>
  `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const pct = (value: number, decimals = 2): string => `${(value * 100).toFixed(decimals)}%`;

const duration = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
};

/** Terminal-friendly performance report used by the CLI and backtester. */
export function formatMetrics(metrics: PerformanceMetrics, title = 'Performance'): string {
  const lines = [
    `${title}`,
    '─'.repeat(Math.max(title.length, 52)),
    `Trades            ${metrics.trades} (${metrics.wins}W / ${metrics.losses}L)`,
    `Win rate          ${pct(metrics.winRate)}`,
    `Net PnL           ${usd(metrics.netPnl)}  (return ${pct(metrics.totalReturnPct)})`,
    `Gross P/L         ${usd(metrics.grossProfit)} / ${usd(-metrics.grossLoss)}`,
    `Fees + gas        ${usd(metrics.fees)} + ${usd(metrics.gas)}`,
    `Profit factor     ${metrics.profitFactor.toFixed(2)}`,
    `Expectancy        ${usd(metrics.expectancy)} per trade`,
    `Avg win / loss    ${usd(metrics.avgWin)} / ${usd(metrics.avgLoss)}  (payoff ${metrics.payoffRatio.toFixed(2)}x)`,
    `Best / worst      ${pct(metrics.bestTradePct)} / ${pct(metrics.worstTradePct)}`,
    `Median trade      ${pct(metrics.medianPnlPct)}`,
    `Avg MFE / MAE     ${pct(metrics.avgMfePct)} / ${pct(metrics.avgMaePct)}`,
    `Sharpe / Sortino  ${metrics.sharpe.toFixed(2)} / ${metrics.sortino.toFixed(2)}  (per trade)`,
    `Max drawdown      ${metrics.maxDrawdownPct.toFixed(2)}%`,
    `Streaks           ${metrics.maxConsecutiveWins}W / ${metrics.maxConsecutiveLosses}L`,
    `Avg hold          ${duration(metrics.avgHoldMs)}`,
  ];
  return lines.join('\n');
}

export function formatGroups(groups: readonly GroupedMetrics[], title: string): string {
  if (groups.length === 0) return `${title}\n  (no trades)`;
  const rows = groups.map((group) => {
    const m = group.metrics;
    return `  ${group.key.padEnd(18)} ${String(m.trades).padStart(4)} trades  ` +
      `${pct(m.winRate).padStart(7)} WR  ${usd(m.netPnl).padStart(12)}  PF ${m.profitFactor.toFixed(2)}`;
  });
  return [title, '─'.repeat(Math.max(title.length, 52)), ...rows].join('\n');
}

export function formatCurve(stats: CurveStats): string {
  return [
    'Equity curve',
    '─'.repeat(52),
    `Start / end       ${usd(stats.start)} -> ${usd(stats.end)} (${stats.returnPct.toFixed(2)}%)`,
    `Peak / trough     ${usd(stats.peak)} / ${usd(stats.trough)}`,
    `Max drawdown      ${stats.maxDrawdownPct.toFixed(2)}%`,
    `Longest drawdown  ${duration(stats.longestDrawdownMs)}`,
    `Time in drawdown  ${stats.timeInDrawdownPct.toFixed(1)}%`,
  ].join('\n');
}

/** Compact ASCII sparkline for terminal reports. */
export function sparkline(values: readonly number[], width = 60): string {
  if (values.length === 0) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const step = Math.max(1, Math.ceil(values.length / width));
  const sampled = values.filter((_, index) => index % step === 0);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  return sampled
    .map((value) => blocks[Math.min(blocks.length - 1, Math.floor(((value - min) / range) * blocks.length))])
    .join('');
}

export { usd, pct, duration };
