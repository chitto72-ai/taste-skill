"""Backtest event-driven della strategia, con la stessa logica di size del live.

Convenzioni conservative:
- ingresso alla chiusura della barra di segnale, maggiorata dello spread;
- se in una stessa barra vengono toccati sia stop sia target, vince lo stop;
- uscite parziali equamente distribuite sui take profit, stop a pareggio
  dopo il primo target;
- costi di spread e commissioni applicati a ogni fill.

Un backtest su dati a barre sovrastima i risultati (niente slippage reale,
niente gap sui rollover, niente requote): trattalo come un filtro per
scartare configurazioni pessime, non come una stima di profitto.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import Config
from .data import resample, timeframe_minutes
from .risk import build_position_plan
from .strategy import compute_features, evaluate


@dataclass
class Trade:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    side: str
    setup: str
    entry: float
    stop_loss: float
    exit_price: float
    lots: float
    r_multiple: float
    pnl: float
    costs: float
    bars_held: int
    max_adverse: float
    liquidation_distance: float
    confidence: float
    outcome: str

    @property
    def liquidated(self) -> bool:
        return self.max_adverse >= self.liquidation_distance


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
    equity: list[tuple[pd.Timestamp, float]] = field(default_factory=list)
    initial_balance: float = 0.0
    final_balance: float = 0.0
    bars: int = 0
    skipped_by_risk: int = 0

    def summary(self) -> dict:
        n = len(self.trades)
        if n == 0:
            return {"trades": 0, "note": "nessun trade generato nel periodo"}
        rs = np.array([t.r_multiple for t in self.trades])
        pnls = np.array([t.pnl for t in self.trades])
        wins, losses = rs[rs > 0], rs[rs <= 0]
        eq = np.array([e for _, e in self.equity], dtype=float)
        peak = np.maximum.accumulate(eq)
        dd = (peak - eq) / np.where(peak == 0, 1, peak)
        gross_win, gross_loss = pnls[pnls > 0].sum(), -pnls[pnls < 0].sum()
        return {
            "trades": n,
            "win_rate_pct": round(len(wins) / n * 100.0, 1),
            "avg_R": round(float(rs.mean()), 3),
            "total_R": round(float(rs.sum()), 2),
            "best_R": round(float(rs.max()), 2),
            "worst_R": round(float(rs.min()), 2),
            "avg_win_R": round(float(wins.mean()), 2) if len(wins) else 0.0,
            "avg_loss_R": round(float(losses.mean()), 2) if len(losses) else 0.0,
            "profit_factor": round(float(gross_win / gross_loss), 2) if gross_loss > 0 else None,
            "expectancy_per_trade": round(float(pnls.mean()), 2),
            "initial_balance": round(self.initial_balance, 2),
            "final_balance": round(self.final_balance, 2),
            "return_pct": round((self.final_balance / self.initial_balance - 1) * 100.0, 2),
            "max_drawdown_pct": round(float(dd.max() * 100.0), 2),
            "avg_bars_held": round(float(np.mean([t.bars_held for t in self.trades])), 1),
            "liquidations": int(sum(t.liquidated for t in self.trades)),
            "skipped_by_risk": self.skipped_by_risk,
            "total_costs": round(float(sum(t.costs for t in self.trades)), 2),
        }


def _exit_levels(side: str, entry: float, stop: float, targets: list[float]) -> list[float]:
    return sorted(targets) if side == "LONG" else sorted(targets, reverse=True)


def run_backtest(
    entry_df: pd.DataFrame,
    cfg: Config,
    trend_df: pd.DataFrame | None = None,
    max_bars_in_trade: int = 96,
    check_session: bool = True,
) -> BacktestResult:
    """Esegue la strategia barra per barra su dati storici."""
    if trend_df is None:
        trend_df = resample(entry_df, cfg.data.trend_timeframe)
    ent = compute_features(entry_df, cfg.strategy)
    tre = compute_features(trend_df, cfg.strategy)

    warmup = cfg.strategy.ema_slow + 5
    if len(ent) <= warmup + 10:
        raise ValueError(f"storico insufficiente: servono più di {warmup + 10} barre")

    balance = cfg.risk.account_balance
    result = BacktestResult(initial_balance=balance, bars=len(ent))
    result.equity.append((ent.index[warmup], balance))
    cooldown_until = -1
    i = warmup

    while i < len(ent) - 1:
        if i <= cooldown_until:
            i += 1
            continue
        analysis = evaluate(
            ent, tre, cfg.strategy, index=i,
            symbol=cfg.data.symbol, timeframe=cfg.data.entry_timeframe,
            check_session=check_session,
        )
        sig = analysis.signal
        if sig is None:
            i += 1
            continue

        plan = build_position_plan(sig.side, sig.entry, sig.stop_loss, cfg.risk, balance=balance)
        if not plan.accepted:
            result.skipped_by_risk += 1
            i += 1
            continue

        direction = 1.0 if sig.side == "LONG" else -1.0
        half_spread = cfg.risk.spread_usd / 2.0
        entry_price = sig.entry + direction * half_spread
        stop = sig.stop_loss
        risk_per_unit = abs(entry_price - stop)
        targets = _exit_levels(sig.side, entry_price, stop, sig.take_profits)
        remaining = plan.units
        slice_units = plan.units / len(targets)
        realized = 0.0
        costs = plan.units * cfg.risk.spread_usd + plan.lots * cfg.risk.commission_per_lot
        max_adverse = 0.0
        hit = 0
        exit_price = entry_price
        exit_time = ent.index[i]
        outcome = "tempo scaduto"
        j = i + 1

        while j < len(ent) and j - i <= max_bars_in_trade and remaining > 1e-9:
            bar = ent.iloc[j]
            adverse = (entry_price - bar["low"]) if sig.side == "LONG" else (bar["high"] - entry_price)
            max_adverse = max(max_adverse, float(adverse))

            stop_hit = bar["low"] <= stop if sig.side == "LONG" else bar["high"] >= stop
            if stop_hit:
                realized += direction * (stop - entry_price) * remaining
                exit_price, exit_time = stop, ent.index[j]
                outcome = "stop" if hit == 0 else f"stop dopo TP{hit}"
                remaining = 0.0
                break

            while hit < len(targets):
                tp = targets[hit]
                reached = bar["high"] >= tp if sig.side == "LONG" else bar["low"] <= tp
                if not reached:
                    break
                fill = min(slice_units, remaining)
                realized += direction * (tp - entry_price) * fill
                remaining -= fill
                costs += fill * cfg.risk.spread_usd / 2.0
                hit += 1
                exit_price, exit_time = tp, ent.index[j]
                if hit == 1:  # stop a pareggio dopo il primo target
                    stop = entry_price
            if remaining <= 1e-9:
                outcome = f"TP{hit}" + (" (completo)" if hit == len(targets) else "")
                break
            j += 1

        if remaining > 1e-9:  # chiusura a mercato per tempo scaduto o fine dati
            k = min(j, len(ent) - 1)
            close = float(ent.iloc[k]["close"]) - direction * half_spread
            realized += direction * (close - entry_price) * remaining
            exit_price, exit_time = close, ent.index[k]

        pnl = realized - costs
        balance += pnl
        r_multiple = pnl / plan.risk_amount if plan.risk_amount else 0.0
        result.trades.append(
            Trade(
                entry_time=ent.index[i], exit_time=exit_time, side=sig.side, setup=sig.setup,
                entry=entry_price, stop_loss=sig.stop_loss, exit_price=exit_price,
                lots=plan.lots, r_multiple=r_multiple, pnl=pnl, costs=costs,
                bars_held=max(1, min(j, len(ent) - 1) - i), max_adverse=max_adverse,
                liquidation_distance=plan.liquidation_distance,
                confidence=sig.confidence, outcome=outcome,
            )
        )
        result.equity.append((exit_time, balance))

        if balance <= 0:
            result.final_balance = balance
            return result

        i = min(j, len(ent) - 1) + 1
        cooldown_until = i + cfg.engine.cooldown_bars - 1

    result.final_balance = balance
    return result


def format_report(result: BacktestResult, cfg: Config, max_rows: int = 12) -> str:
    s = result.summary()
    lines = [
        f"Backtest {cfg.data.symbol} {cfg.data.entry_timeframe}/{cfg.data.trend_timeframe} "
        f"— {result.bars} barre, leva {cfg.risk.leverage:.0f}x, rischio {cfg.risk.risk_pct:g}%/trade",
        "",
    ]
    if s.get("trades", 0) == 0:
        return "\n".join(lines + [s.get("note", "nessun trade")])
    width = max(len(k) for k in s)
    lines += [f"  {k.ljust(width)} : {v}" for k, v in s.items()]
    lines += ["", f"Ultimi {min(max_rows, len(result.trades))} trade:"]
    lines.append(
        f"  {'apertura':16} {'lato':5} {'entry':>9} {'uscita':>9} "
        f"{'R':>6} {'P&L':>10}  esito"
    )
    for t in result.trades[-max_rows:]:
        lines.append(
            f"  {t.entry_time:%Y-%m-%d %H:%M} {t.side:5} {t.entry:9.2f} {t.exit_price:9.2f} "
            f"{t.r_multiple:+6.2f} {t.pnl:+10.2f}  {t.outcome}"
        )
    if s["liquidations"]:
        lines += ["", f"⚠️  {s['liquidations']} trade hanno superato la distanza di liquidazione "
                      "stimata prima dell'uscita: con questa leva il conto sarebbe stato chiuso."]
    lines += ["", "I risultati passati non predicono quelli futuri; costi reali e slippage "
                  "peggiorano sempre queste metriche."]
    return "\n".join(lines)
