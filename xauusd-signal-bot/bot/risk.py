"""Dimensionamento posizione e controlli di leva per XAUUSD.

Il punto chiave con leve 100x-250x: **la leva non determina il rischio, lo
determinano la size e la distanza dello stop**. La leva fissa solo il
margine richiesto e, di conseguenza, quanto margine libero resta prima
del livello di stop-out del broker.

Ordine di calcolo:
1. size dal rischio per trade e dalla distanza dello stop;
2. taglio per il tetto di margine impegnabile;
3. taglio perché la liquidazione resti almeno `liquidation_buffer` volte
   più lontana dello stop;
4. arrotondamento al passo di lotto e verifica finale.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .config import RiskConfig


@dataclass
class PositionPlan:
    """Piano operativo di una singola posizione."""

    side: str
    entry: float
    stop_loss: float
    lots: float
    units: float
    notional: float
    required_margin: float
    margin_pct: float
    effective_leverage: float
    leverage: float
    risk_amount: float
    risk_pct: float
    stop_distance: float
    value_per_dollar_move: float
    liquidation_price: float
    liquidation_distance: float
    liquidation_buffer_ratio: float
    cost_estimate: float
    accepted: bool = True
    reject_reason: str | None = None
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def pnl_at(self, price: float) -> float:
        """P&L in valuta del conto al prezzo indicato (costi esclusi)."""
        direction = 1.0 if self.side == "LONG" else -1.0
        return direction * (price - self.entry) * self.units

    def r_multiple_at(self, price: float) -> float:
        if self.risk_amount <= 0:
            return 0.0
        return self.pnl_at(price) / self.risk_amount

    def as_dict(self) -> dict:
        return {
            "lots": round(self.lots, 4),
            "units_oz": round(self.units, 2),
            "notional": round(self.notional, 2),
            "required_margin": round(self.required_margin, 2),
            "margin_pct": round(self.margin_pct, 2),
            "leverage": self.leverage,
            "effective_leverage": round(self.effective_leverage, 2),
            "risk_amount": round(self.risk_amount, 2),
            "risk_pct": round(self.risk_pct, 3),
            "stop_distance": round(self.stop_distance, 2),
            "usd_per_dollar_move": round(self.value_per_dollar_move, 2),
            "liquidation_price": round(self.liquidation_price, 2),
            "liquidation_distance": round(self.liquidation_distance, 2),
            "liquidation_buffer_ratio": round(self.liquidation_buffer_ratio, 2),
            "estimated_costs": round(self.cost_estimate, 2),
            "accepted": self.accepted,
            "reject_reason": self.reject_reason,
            "warnings": list(self.warnings),
        }


def _round_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    return math.floor(round(value / step, 9)) * step


def max_units_for_liquidation_buffer(
    balance: float, entry: float, stop_distance: float, leverage: float,
    stop_out_frac: float, buffer: float,
) -> float:
    """Unità massime affinché la liquidazione resti oltre `buffer` * stop.

    La liquidazione scatta quando `equity <= stop_out_frac * margine`:

        balance - units * d = stop_out_frac * units * entry / leverage

    Imponendo `d >= buffer * stop_distance` e risolvendo per `units`:

        units <= balance / (buffer * stop_distance + stop_out_frac * entry / leverage)
    """
    denom = buffer * stop_distance + stop_out_frac * entry / leverage
    return balance / denom if denom > 0 else math.inf


def liquidation_price(
    side: str, entry: float, units: float, balance: float, leverage: float, stop_out_frac: float
) -> tuple[float, float]:
    """Prezzo e distanza di liquidazione approssimati per una posizione singola."""
    if units <= 0:
        return (math.nan, math.inf)
    margin = units * entry / leverage
    distance = (balance - stop_out_frac * margin) / units
    distance = max(distance, 0.0)
    price = entry - distance if side == "LONG" else entry + distance
    return (price, distance)


def build_position_plan(
    side: str,
    entry: float,
    stop_loss: float,
    cfg: RiskConfig,
    balance: float | None = None,
) -> PositionPlan:
    """Calcola la size e tutti i controlli di rischio per un setup."""
    side = side.upper()
    if side not in {"LONG", "SHORT"}:
        raise ValueError(f"lato non valido: {side!r}")
    balance = cfg.account_balance if balance is None else balance
    stop_distance = abs(entry - stop_loss)
    warnings: list[str] = []
    notes: list[str] = []

    if stop_distance <= 0:
        raise ValueError("la distanza dello stop deve essere > 0")
    if (side == "LONG" and stop_loss >= entry) or (side == "SHORT" and stop_loss <= entry):
        raise ValueError(f"stop loss dal lato sbagliato per una posizione {side}")

    stop_out_frac = cfg.stop_out_level_pct / 100.0
    risk_amount_target = balance * cfg.risk_pct / 100.0

    # 1) size dal rischio per trade
    units_risk = risk_amount_target / stop_distance
    units = units_risk
    binding = "rischio per trade"

    # 2) tetto di margine impegnabile
    units_margin = balance * (cfg.max_margin_pct / 100.0) * cfg.leverage / entry
    if units_margin < units:
        units, binding = units_margin, "tetto di margine"

    # 3) distanza di liquidazione
    units_liq = max_units_for_liquidation_buffer(
        balance, entry, stop_distance, cfg.leverage, stop_out_frac, cfg.liquidation_buffer
    )
    if units_liq < units:
        units, binding = units_liq, "buffer di liquidazione"

    # 4) arrotondamento al passo di lotto
    lots = _round_to_step(units / cfg.contract_size, cfg.lot_step)
    lots = min(lots, cfg.max_lot)
    notes.append(f"size limitata da: {binding}")

    rejections: list[str] = []
    if lots < cfg.min_lot:
        rejections.append(
            f"size richiesta ({lots:.4f} lotti) sotto il lotto minimo {cfg.min_lot:g}"
        )
        lots = cfg.min_lot  # piano costruito comunque, per mostrare il rischio reale

    plan = _plan_from_lots(side, entry, stop_loss, lots, cfg, balance, stop_distance)
    plan.notes = notes

    if rejections:
        rejections[0] += (
            f": con {balance:,.0f} {cfg.account_currency} e stop di {stop_distance:.2f}$ "
            f"il lotto minimo rischierebbe {plan.risk_pct:.2f}% del capitale "
            f"(limite {cfg.risk_pct:g}%)"
        )

    if plan.liquidation_buffer_ratio < cfg.liquidation_buffer:
        msg = (
            f"stop a {stop_distance:.2f}$ contro una liquidazione a "
            f"{plan.liquidation_distance:.2f}$ (rapporto {plan.liquidation_buffer_ratio:.2f}x, "
            f"richiesto {cfg.liquidation_buffer:g}x)"
        )
        if cfg.reject_if_stop_beyond_liquidation and plan.liquidation_distance <= stop_distance:
            rejections.append("liquidazione prima dello stop: " + msg)
        else:
            warnings.append(msg)

    if rejections:
        plan.accepted = False
        plan.reject_reason = " | ".join(rejections)

    if plan.margin_pct > cfg.max_margin_pct + 1e-9:
        warnings.append(
            f"margine al {plan.margin_pct:.1f}% del capitale (tetto {cfg.max_margin_pct:g}%)"
        )
    if plan.risk_pct > cfg.risk_pct * 1.05:
        warnings.append(
            f"rischio effettivo {plan.risk_pct:.2f}% oltre il target {cfg.risk_pct:g}% "
            "(arrotondamento al lotto minimo)"
        )
    if plan.cost_estimate > 0.25 * plan.risk_amount:
        warnings.append(
            f"costi stimati {plan.cost_estimate:.2f} = "
            f"{plan.cost_estimate / plan.risk_amount * 100:.0f}% del rischio: stop troppo stretto"
        )
    if plan.effective_leverage > cfg.leverage:
        warnings.append(
            f"esposizione {plan.effective_leverage:.0f}x del capitale: nessun margine libero"
        )
    plan.warnings = warnings + plan.warnings
    return plan


def _plan_from_lots(
    side: str, entry: float, stop_loss: float, lots: float,
    cfg: RiskConfig, balance: float, stop_distance: float,
) -> PositionPlan:
    units = lots * cfg.contract_size
    notional = units * entry
    required_margin = notional / cfg.leverage
    risk_amount = units * stop_distance
    liq_price, liq_distance = liquidation_price(
        side, entry, units, balance, cfg.leverage, cfg.stop_out_level_pct / 100.0
    )
    costs = units * cfg.spread_usd + lots * cfg.commission_per_lot
    return PositionPlan(
        side=side,
        entry=entry,
        stop_loss=stop_loss,
        lots=lots,
        units=units,
        notional=notional,
        required_margin=required_margin,
        margin_pct=required_margin / balance * 100.0 if balance else float("inf"),
        effective_leverage=notional / balance if balance else float("inf"),
        leverage=cfg.leverage,
        risk_amount=risk_amount,
        risk_pct=risk_amount / balance * 100.0 if balance else float("inf"),
        stop_distance=stop_distance,
        value_per_dollar_move=units,
        liquidation_price=liq_price,
        liquidation_distance=liq_distance,
        liquidation_buffer_ratio=liq_distance / stop_distance if stop_distance else float("inf"),
        cost_estimate=costs,
    )


def leverage_table(cfg: RiskConfig, entry: float, stop_distance: float,
                   levels: tuple[float, ...] = (100.0, 150.0, 200.0, 250.0)) -> list[dict]:
    """Confronto dello stesso setup alle diverse leve consentite.

    Serve a rendere esplicito che, a parità di size, alzare la leva riduce
    il margine e *allontana* la liquidazione: ciò che uccide il conto è la
    size, non il moltiplicatore.
    """
    rows = []
    for lev in levels:
        if not (cfg.min_leverage <= lev <= cfg.max_leverage):
            continue
        scoped = RiskConfig(**{**cfg.__dict__, "leverage": lev})
        plan = build_position_plan("LONG", entry, entry - stop_distance, scoped)
        rows.append(
            {
                "leverage": lev,
                "lots": round(plan.lots, 2),
                "margin": round(plan.required_margin, 2),
                "margin_pct": round(plan.margin_pct, 1),
                "risk_pct": round(plan.risk_pct, 2),
                "liq_distance": round(plan.liquidation_distance, 2),
                "liq_buffer": round(plan.liquidation_buffer_ratio, 2),
                "accepted": plan.accepted,
            }
        )
    return rows
