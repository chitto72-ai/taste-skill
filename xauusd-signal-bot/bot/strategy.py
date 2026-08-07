"""Motore di analisi: confluenza multi-timeframe su XAUUSD.

Logica in tre passaggi:
1. **Bias** sul timeframe superiore (default H1): struttura delle EMA,
   posizione del prezzo, forza del trend (ADX) e momentum (MACD).
2. **Trigger** sul timeframe di ingresso (default M15): continuazione dopo
   pullback oppure breakout di canale nella direzione del bias.
3. **Punteggio e livelli**: ogni condizione pesa sul punteggio di
   confidenza; stop e target derivano da ATR e struttura.

Tutti i calcoli usano solo barre chiuse: nessun look-ahead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time as dtime

import pandas as pd

from . import indicators as ind
from .config import StrategyConfig

LONG, SHORT, FLAT = "LONG", "SHORT", "FLAT"


@dataclass
class Signal:
    time: pd.Timestamp
    symbol: str
    side: str
    entry: float
    stop_loss: float
    take_profits: list[float]
    confidence: float
    setup: str
    timeframe: str
    atr: float
    reasons: list[str] = field(default_factory=list)
    features: dict = field(default_factory=dict)

    @property
    def risk_distance(self) -> float:
        return abs(self.entry - self.stop_loss)

    def rr_at(self, index: int = -1) -> float:
        if not self.take_profits or self.risk_distance <= 0:
            return 0.0
        return abs(self.take_profits[index] - self.entry) / self.risk_distance

    def as_dict(self) -> dict:
        return {
            "time": self.time.isoformat(),
            "symbol": self.symbol,
            "side": self.side,
            "setup": self.setup,
            "timeframe": self.timeframe,
            "entry": round(self.entry, 2),
            "stop_loss": round(self.stop_loss, 2),
            "take_profits": [round(t, 2) for t in self.take_profits],
            "risk_distance": round(self.risk_distance, 2),
            "rr_final": round(self.rr_at(-1), 2),
            "confidence": round(self.confidence, 1),
            "atr": round(self.atr, 2),
            "reasons": list(self.reasons),
        }


@dataclass
class Analysis:
    """Esito dell'analisi su una barra: segnale oppure motivi di scarto."""

    time: pd.Timestamp
    price: float
    bias: str
    bias_strength: float
    signal: Signal | None
    blockers: list[str] = field(default_factory=list)
    features: dict = field(default_factory=dict)


def _in_session(ts: pd.Timestamp, sessions: tuple[tuple[str, str], ...]) -> bool:
    if not sessions:
        return True
    now = ts.tz_convert("UTC").time()
    for start_s, end_s in sessions:
        start = dtime.fromisoformat(start_s)
        end = dtime.fromisoformat(end_s)
        if start <= end:
            if start <= now < end:
                return True
        elif now >= start or now < end:  # sessione a cavallo della mezzanotte
            return True
    return False


def compute_features(df: pd.DataFrame, cfg: StrategyConfig) -> pd.DataFrame:
    """Aggiunge le colonne degli indicatori a un DataFrame OHLCV."""
    out = df.copy()
    close = out["close"]
    out["ema_fast"] = ind.ema(close, cfg.ema_fast)
    out["ema_mid"] = ind.ema(close, cfg.ema_mid)
    out["ema_slow"] = ind.ema(close, cfg.ema_slow)
    out["rsi"] = ind.rsi(close, cfg.rsi_length)
    out["atr"] = ind.atr(out, cfg.atr_length)
    out["atr_pct"] = out["atr"] / close * 100.0
    macd = ind.macd(close)
    out[["macd", "macd_signal", "macd_hist"]] = macd[["macd", "signal", "hist"]]
    adx = ind.adx(out, cfg.adx_length)
    out[["adx", "plus_di", "minus_di"]] = adx[["adx", "plus_di", "minus_di"]]
    dc = ind.donchian(out, cfg.breakout_length)
    out[["dc_upper", "dc_lower", "dc_mid"]] = dc[["upper", "lower", "mid"]]
    swings = ind.swing_points(out)
    out["swing_high"] = swings["swing_high"].ffill()
    out["swing_low"] = swings["swing_low"].ffill()
    out["ema_slope"] = ind.slope(out["ema_mid"], 5)
    return out


def trend_bias(row: pd.Series, cfg: StrategyConfig) -> tuple[str, float, list[str]]:
    """Bias direzionale del timeframe superiore e sua forza (0-1)."""
    reasons: list[str] = []
    up = down = 0.0

    if row["ema_mid"] > row["ema_slow"]:
        up += 1.0
        reasons.append(f"H1 EMA{cfg.ema_mid} sopra EMA{cfg.ema_slow}")
    elif row["ema_mid"] < row["ema_slow"]:
        down += 1.0
        reasons.append(f"H1 EMA{cfg.ema_mid} sotto EMA{cfg.ema_slow}")

    if row["close"] > row["ema_mid"]:
        up += 1.0
    elif row["close"] < row["ema_mid"]:
        down += 1.0

    if row["macd_hist"] > 0:
        up += 0.5
    elif row["macd_hist"] < 0:
        down += 0.5

    if row["plus_di"] > row["minus_di"]:
        up += 0.5
    else:
        down += 0.5

    if row["ema_slope"] > 0:
        up += 0.5
    elif row["ema_slope"] < 0:
        down += 0.5

    total = 3.5
    if up > down:
        return LONG, up / total, reasons + [f"H1 ADX {row['adx']:.1f}"]
    if down > up:
        return SHORT, down / total, reasons + [f"H1 ADX {row['adx']:.1f}"]
    return FLAT, 0.0, ["H1 senza direzione dominante"]


def _pullback_trigger(prev: pd.Series, cur: pd.Series, side: str, cfg: StrategyConfig) -> bool:
    """Rientro in trend dopo un pullback sulla EMA veloce."""
    if side == LONG:
        touched = prev["low"] <= prev["ema_fast"] * 1.001 or cur["low"] <= cur["ema_fast"]
        return bool(
            touched
            and cur["close"] > cur["open"]
            and cur["close"] > cur["ema_fast"]
            and cur["close"] > prev["high"]
            and 40.0 <= cur["rsi"] <= 70.0
        )
    touched = prev["high"] >= prev["ema_fast"] * 0.999 or cur["high"] >= cur["ema_fast"]
    return bool(
        touched
        and cur["close"] < cur["open"]
        and cur["close"] < cur["ema_fast"]
        and cur["close"] < prev["low"]
        and 30.0 <= cur["rsi"] <= 60.0
    )


def _breakout_trigger(prev: pd.Series, cur: pd.Series, side: str, cfg: StrategyConfig) -> bool:
    """Rottura del canale di Donchian calcolato sulle barre precedenti."""
    body = abs(cur["close"] - cur["open"])
    strong_body = body >= 0.35 * cur["atr"]
    if side == LONG:
        return bool(cur["close"] > prev["dc_upper"] and strong_body and cur["rsi"] > 50.0)
    return bool(cur["close"] < prev["dc_lower"] and strong_body and cur["rsi"] < 50.0)


def _levels(cur: pd.Series, side: str, cfg: StrategyConfig) -> tuple[float, float, list[float]]:
    entry = float(cur["close"])
    atr = float(cur["atr"])
    buffer = cfg.atr_sl_buffer * atr
    if side == LONG:
        structural = cur["swing_low"] if pd.notna(cur["swing_low"]) else entry - cfg.atr_sl_mult * atr
        stop = min(float(structural) - buffer, entry - cfg.atr_sl_mult * atr)
        risk = entry - stop
        targets = [entry + r * risk for r in cfg.take_profit_r]
    else:
        structural = cur["swing_high"] if pd.notna(cur["swing_high"]) else entry + cfg.atr_sl_mult * atr
        stop = max(float(structural) + buffer, entry + cfg.atr_sl_mult * atr)
        risk = stop - entry
        targets = [entry - r * risk for r in cfg.take_profit_r]
    return entry, stop, targets


def _score(cur: pd.Series, side: str, bias_strength: float, setup: str,
           cfg: StrategyConfig) -> tuple[float, list[str]]:
    """Punteggio 0-100 come somma pesata di condizioni indipendenti."""
    checks: list[tuple[str, bool, float]] = [
        ("bias H1 allineato", True, 25.0 * bias_strength / 1.0),
        (f"ADX {cur['adx']:.0f} > {cfg.adx_min:g}", cur["adx"] > cfg.adx_min, 15.0),
        (
            "momentum MACD concorde",
            (cur["macd_hist"] > 0) if side == LONG else (cur["macd_hist"] < 0),
            12.0,
        ),
        (
            "prezzo sopra EMA lenta" if side == LONG else "prezzo sotto EMA lenta",
            (cur["close"] > cur["ema_slow"]) if side == LONG else (cur["close"] < cur["ema_slow"]),
            12.0,
        ),
        (
            "RSI in zona di continuazione",
            (50.0 <= cur["rsi"] <= 68.0) if side == LONG else (32.0 <= cur["rsi"] <= 50.0),
            10.0,
        ),
        (
            "DI direzionale a favore",
            (cur["plus_di"] > cur["minus_di"]) if side == LONG else (cur["minus_di"] > cur["plus_di"]),
            10.0,
        ),
        ("volatilità in range operativo",
         cfg.min_atr_pct <= cur["atr_pct"] <= cfg.max_atr_pct, 8.0),
        ("candela di trigger convincente",
         abs(cur["close"] - cur["open"]) >= 0.3 * cur["atr"], 8.0),
    ]
    score = 0.0
    reasons = [f"setup: {setup}"]
    for label, ok, weight in checks:
        if ok:
            score += weight
            reasons.append(f"+ {label}")
        else:
            reasons.append(f"- {label}")
    return min(score, 100.0), reasons


def evaluate(
    ent: pd.DataFrame,
    tre: pd.DataFrame,
    cfg: StrategyConfig,
    index: int = -1,
    symbol: str = "XAUUSD",
    timeframe: str = "15m",
    check_session: bool = True,
) -> Analysis:
    """Valuta la barra `index` di `ent` (DataFrame già arricchito di indicatori).

    `analyze` è il wrapper che calcola gli indicatori; il backtest usa
    direttamente questa funzione per non ricalcolarli a ogni barra.
    """
    pos = index if index >= 0 else len(ent) + index
    if pos < 1:
        raise ValueError("serve almeno una barra precedente per valutare il trigger")
    cur, prev = ent.iloc[pos], ent.iloc[pos - 1]

    # Bias dall'ultima barra H1 non successiva alla barra di ingresso.
    tre_hist = tre.loc[tre.index <= cur.name]
    if tre_hist.empty:
        raise ValueError("nessuna barra del timeframe superiore precedente al segnale")
    bias_row = tre_hist.iloc[-1]

    blockers: list[str] = []
    if bias_row[["ema_mid", "ema_slow", "adx", "macd_hist"]].isna().any() or pd.isna(cur["atr"]):
        return Analysis(cur.name, float(cur["close"]), FLAT, 0.0, None,
                        ["indicatori non ancora inizializzati (storico insufficiente)"])

    bias, strength, bias_reasons = trend_bias(bias_row, cfg)
    features = {
        "close": float(cur["close"]),
        "atr": float(cur["atr"]),
        "atr_pct": float(cur["atr_pct"]),
        "rsi": float(cur["rsi"]),
        "adx_entry": float(cur["adx"]),
        "adx_trend": float(bias_row["adx"]),
        "bias": bias,
        "bias_strength": round(strength, 3),
    }

    if check_session and not _in_session(cur.name, cfg.sessions_utc):
        blockers.append(f"fuori sessione operativa ({cur.name:%H:%M} UTC)")
    if bias == FLAT:
        blockers.append("H1 privo di direzione: nessun trade di continuazione")
    if pd.notna(bias_row["adx"]) and bias_row["adx"] < cfg.adx_min:
        blockers.append(f"trend H1 debole (ADX {bias_row['adx']:.1f} < {cfg.adx_min:g})")
    if cur["atr_pct"] < cfg.min_atr_pct:
        blockers.append(f"volatilità troppo bassa (ATR {cur['atr_pct']:.2f}% del prezzo)")
    if cur["atr_pct"] > cfg.max_atr_pct:
        blockers.append(f"volatilità anomala (ATR {cur['atr_pct']:.2f}% del prezzo)")

    setup = None
    if bias in (LONG, SHORT):
        if _pullback_trigger(prev, cur, bias, cfg):
            setup = "pullback in trend"
        elif _breakout_trigger(prev, cur, bias, cfg):
            setup = "breakout di canale"
        else:
            blockers.append("nessun trigger di ingresso sull'ultima barra chiusa")

    if blockers or setup is None:
        return Analysis(cur.name, float(cur["close"]), bias, strength, None, blockers, features)

    confidence, reasons = _score(cur, bias, strength, setup, cfg)
    if confidence < cfg.min_confidence:
        blockers.append(f"confidenza {confidence:.0f} sotto la soglia {cfg.min_confidence:g}")
        return Analysis(cur.name, float(cur["close"]), bias, strength, None, blockers, features)

    entry, stop, targets = _levels(cur, bias, cfg)
    signal = Signal(
        time=cur.name,
        symbol=symbol,
        side=bias,
        entry=entry,
        stop_loss=stop,
        take_profits=targets,
        confidence=confidence,
        setup=setup,
        timeframe=timeframe,
        atr=float(cur["atr"]),
        reasons=bias_reasons + reasons,
        features=features,
    )
    return Analysis(cur.name, float(cur["close"]), bias, strength, signal, [], features)


def analyze(
    entry_df: pd.DataFrame,
    trend_df: pd.DataFrame,
    cfg: StrategyConfig,
    symbol: str = "XAUUSD",
    timeframe: str = "15m",
    check_session: bool = True,
) -> Analysis:
    """Analizza l'ultima barra chiusa di `entry_df` con il bias di `trend_df`."""
    if len(entry_df) < cfg.ema_slow + 5 or len(trend_df) < cfg.ema_slow + 5:
        raise ValueError(
            f"servono almeno {cfg.ema_slow + 5} barre per timeframe "
            f"(ricevute {len(entry_df)} / {len(trend_df)})"
        )
    return evaluate(
        compute_features(entry_df, cfg),
        compute_features(trend_df, cfg),
        cfg,
        index=-1,
        symbol=symbol,
        timeframe=timeframe,
        check_session=check_session,
    )
