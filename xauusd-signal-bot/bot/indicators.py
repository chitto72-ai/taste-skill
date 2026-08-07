"""Indicatori tecnici implementati su pandas/numpy (nessuna dipendenza da TA-Lib).

Tutte le funzioni ritornano Series allineate all'indice di input e non
modificano i DataFrame ricevuti.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = [
    "ema",
    "sma",
    "rsi",
    "true_range",
    "atr",
    "macd",
    "bollinger",
    "adx",
    "donchian",
    "swing_points",
    "slope",
]


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False, min_periods=length).mean()


def sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(length, min_periods=length).mean()


def _wilder(series: pd.Series, length: int) -> pd.Series:
    """Smoothing di Wilder (equivalente a EMA con alpha = 1/length)."""
    return series.ewm(alpha=1.0 / length, adjust=False, min_periods=length).mean()


def rsi(series: pd.Series, length: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = _wilder(gain, length)
    avg_loss = _wilder(loss, length)
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    # avg_loss == 0 -> RSI 100 (solo rialzi nella finestra)
    return out.where(avg_loss != 0.0, 100.0).where(avg_gain.notna(), np.nan)


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    ranges = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    )
    return ranges.max(axis=1)


def atr(df: pd.DataFrame, length: int = 14) -> pd.Series:
    return _wilder(true_range(df), length)


def macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> pd.DataFrame:
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame(
        {
            "macd": macd_line,
            "signal": signal_line,
            "hist": macd_line - signal_line,
        }
    )


def bollinger(series: pd.Series, length: int = 20, mult: float = 2.0) -> pd.DataFrame:
    mid = sma(series, length)
    sd = series.rolling(length, min_periods=length).std(ddof=0)
    return pd.DataFrame(
        {
            "mid": mid,
            "upper": mid + mult * sd,
            "lower": mid - mult * sd,
            "width": (2 * mult * sd) / mid,
        }
    )


def adx(df: pd.DataFrame, length: int = 14) -> pd.DataFrame:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)

    atr_ = _wilder(true_range(df), length)
    plus_di = 100.0 * _wilder(plus_dm, length) / atr_.replace(0.0, np.nan)
    minus_di = 100.0 * _wilder(minus_dm, length) / atr_.replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return pd.DataFrame({"adx": _wilder(dx, length), "plus_di": plus_di, "minus_di": minus_di})


def donchian(df: pd.DataFrame, length: int = 20) -> pd.DataFrame:
    upper = df["high"].rolling(length, min_periods=length).max()
    lower = df["low"].rolling(length, min_periods=length).min()
    return pd.DataFrame({"upper": upper, "lower": lower, "mid": (upper + lower) / 2.0})


def swing_points(df: pd.DataFrame, left: int = 3, right: int = 3) -> pd.DataFrame:
    """Frazionali di swing confermati (guardano `right` barre nel futuro).

    Il valore su una barra è noto solo dopo `right` barre: per evitare
    look-ahead il risultato viene shiftato in avanti di `right`.
    """
    win = left + right + 1
    high_roll = df["high"].rolling(win, min_periods=win).max()
    low_roll = df["low"].rolling(win, min_periods=win).min()
    centre_high = df["high"].shift(right)
    centre_low = df["low"].shift(right)
    is_high = (centre_high >= high_roll) & centre_high.notna()
    is_low = (centre_low <= low_roll) & centre_low.notna()
    return pd.DataFrame(
        {
            "swing_high": centre_high.where(is_high),
            "swing_low": centre_low.where(is_low),
        }
    )


def slope(series: pd.Series, length: int = 5) -> pd.Series:
    """Pendenza media per barra sulle ultime `length` barre."""
    return (series - series.shift(length)) / float(length)
