"""Provider di dati OHLCV per XAUUSD.

Contratto comune: ogni provider ritorna un DataFrame con indice
`DatetimeIndex` UTC crescente e colonne `open, high, low, close, volume`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .config import DataConfig

OHLCV = ["open", "high", "low", "close", "volume"]

_TF_MINUTES = {
    "1m": 1, "2m": 2, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "60m": 60, "2h": 120, "4h": 240, "1d": 1440,
}


class DataError(RuntimeError):
    """Dati di mercato non disponibili o non utilizzabili."""


def timeframe_minutes(tf: str) -> int:
    try:
        return _TF_MINUTES[tf.lower()]
    except KeyError:
        raise DataError(f"timeframe non supportato: {tf!r}") from None


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Ordina, deduplica e valida un DataFrame OHLCV."""
    missing = [c for c in OHLCV if c not in df.columns]
    if missing:
        raise DataError(f"colonne mancanti nei dati: {missing}")
    out = df[OHLCV].copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        raise DataError("l'indice deve essere un DatetimeIndex")
    out.index = (
        out.index.tz_localize("UTC") if out.index.tz is None else out.index.tz_convert("UTC")
    )
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out = out.dropna(subset=["open", "high", "low", "close"])
    if out.empty:
        raise DataError("nessuna barra valida dopo la normalizzazione")
    return out


def drop_unclosed_bar(df: pd.DataFrame, timeframe: str, now: pd.Timestamp | None = None) -> pd.DataFrame:
    """Rimuove l'ultima barra se non è ancora chiusa.

    Operare sulla barra in formazione è la causa più comune di segnali
    che "spariscono": il prezzo può ancora rientrare prima della chiusura.
    """
    if df.empty:
        return df
    now = pd.Timestamp.now(tz="UTC") if now is None else now
    delta = pd.Timedelta(minutes=timeframe_minutes(timeframe))
    return df.iloc[:-1] if df.index[-1] + delta > now else df


def resample(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    rule = f"{timeframe_minutes(timeframe)}min"
    out = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    return out.dropna(subset=["open", "high", "low", "close"])


class Provider:
    name = "base"

    def fetch(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        raise NotImplementedError


def _http_get_json(url: str, timeout: float = 15.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "xauusd-signal-bot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise DataError(f"richiesta fallita a {urllib.parse.urlsplit(url).netloc}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise DataError(f"risposta non JSON da {urllib.parse.urlsplit(url).netloc}") from exc


class YahooProvider(Provider):
    """Dati gratuiti da Yahoo Finance (nessuna chiave richiesta)."""

    name = "yahoo"
    SYMBOLS = {"XAUUSD": ["XAUUSD=X", "GC=F"], "GOLD": ["GC=F"]}
    INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
                 "1h": "60m", "60m": "60m", "1d": "1d"}

    def fetch(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        interval = self.INTERVALS.get(timeframe.lower())
        if interval is None:
            raise DataError(f"Yahoo non espone il timeframe {timeframe!r}")
        span_days = max(2, int(np.ceil(bars * timeframe_minutes(timeframe) / (60 * 24) * 2.2)))
        rng = "1d" if span_days <= 1 else f"{min(span_days, 59 if interval != '1d' else 3650)}d"

        errors = []
        for ticker in self.SYMBOLS.get(symbol.upper(), [symbol]):
            url = (
                "https://query1.finance.yahoo.com/v8/finance/chart/"
                f"{urllib.parse.quote(ticker)}?interval={interval}&range={rng}"
            )
            try:
                payload = _http_get_json(url)
                return self._parse(payload).tail(bars)
            except DataError as exc:
                errors.append(f"{ticker}: {exc}")
        raise DataError("Yahoo: nessun ticker utilizzabile -> " + " | ".join(errors))

    @staticmethod
    def _parse(payload: dict) -> pd.DataFrame:
        chart = (payload or {}).get("chart") or {}
        if chart.get("error"):
            raise DataError(str(chart["error"]))
        results = chart.get("result") or []
        if not results:
            raise DataError("risposta priva di dati")
        result = results[0]
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        idx = pd.to_datetime(result.get("timestamp") or [], unit="s", utc=True)
        if len(idx) == 0:
            raise DataError("nessun timestamp nella risposta")
        df = pd.DataFrame(
            {
                "open": quote.get("open"),
                "high": quote.get("high"),
                "low": quote.get("low"),
                "close": quote.get("close"),
                "volume": quote.get("volume"),
            },
            index=idx,
        )
        df["volume"] = df["volume"].fillna(0.0)
        return normalize(df)


class TwelveDataProvider(Provider):
    """Dati da twelvedata.com (richiede una API key gratuita)."""

    name = "twelvedata"
    INTERVALS = {"1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
                 "1h": "1h", "60m": "1h", "4h": "4h", "1d": "1day"}

    def __init__(self, api_key_env: str = "MARKET_DATA_API_KEY") -> None:
        self.api_key_env = api_key_env

    def fetch(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        key = os.environ.get(self.api_key_env, "").strip()
        if not key:
            raise DataError(f"variabile d'ambiente {self.api_key_env} non impostata")
        interval = self.INTERVALS.get(timeframe.lower())
        if interval is None:
            raise DataError(f"TwelveData non espone il timeframe {timeframe!r}")
        pair = "XAU/USD" if symbol.upper() in {"XAUUSD", "GOLD"} else symbol
        query = urllib.parse.urlencode(
            {"symbol": pair, "interval": interval, "outputsize": min(bars, 5000),
             "format": "JSON", "apikey": key}
        )
        payload = _http_get_json(f"https://api.twelvedata.com/time_series?{query}")
        if str(payload.get("status", "ok")).lower() == "error":
            raise DataError(f"TwelveData: {payload.get('message', 'errore sconosciuto')}")
        values = payload.get("values") or []
        if not values:
            raise DataError("TwelveData: serie vuota")
        df = pd.DataFrame(values)
        df.index = pd.to_datetime(df.pop("datetime"), utc=True)
        for col in OHLCV:
            df[col] = pd.to_numeric(df.get(col), errors="coerce") if col in df else 0.0
        return normalize(df).tail(bars)


class CsvProvider(Provider):
    """Dati storici da file CSV locale (per backtest e sviluppo offline)."""

    name = "csv"

    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def fetch(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        if not self.path.exists():
            raise DataError(f"CSV non trovato: {self.path}")
        df = pd.read_csv(self.path)
        cols = {c.lower().strip(): c for c in df.columns}
        time_col = next((cols[c] for c in ("time", "datetime", "date", "timestamp") if c in cols), None)
        if time_col is None:
            raise DataError("il CSV deve avere una colonna time/datetime/date/timestamp")
        df.index = pd.to_datetime(df.pop(time_col), utc=True, format="mixed")
        df.columns = [c.lower().strip() for c in df.columns]
        if "volume" not in df.columns:
            df["volume"] = 0.0
        return normalize(df).tail(bars)


@dataclass
class SyntheticProvider(Provider):
    """Serie deterministica per demo e test senza rete.

    Genera un random walk a regimi (trend/laterale) con volatilità
    tipica dell'oro; utile per verificare la pipeline, non per validare
    la redditività della strategia.
    """

    name = "synthetic"
    seed: int = 7
    start_price: float = 2350.0
    annual_vol: float = 0.16

    def fetch(self, symbol: str, timeframe: str, bars: int) -> pd.DataFrame:
        rng = np.random.default_rng(self.seed)
        minutes = timeframe_minutes(timeframe)
        n = int(bars)
        per_year = 365 * 24 * 60 / minutes
        sigma = self.annual_vol / np.sqrt(per_year)

        # Regimi di drift alternati per creare trend riconoscibili.
        regimes = rng.integers(30, 90, size=n)
        drift = np.concatenate(
            [np.full(k, d) for k, d in zip(regimes, rng.normal(0, 0.35 * sigma, size=len(regimes)))]
        )[:n]
        rets = drift + rng.normal(0.0, sigma, size=n)
        close = self.start_price * np.exp(np.cumsum(rets))
        open_ = np.concatenate([[self.start_price], close[:-1]])
        wick = np.abs(rng.normal(0.0, sigma, size=n)) * close
        high = np.maximum(open_, close) + wick
        low = np.minimum(open_, close) - wick
        end = pd.Timestamp.now(tz="UTC").floor(f"{minutes}min")
        idx = pd.date_range(end=end, periods=n, freq=f"{minutes}min", tz="UTC")
        return normalize(
            pd.DataFrame(
                {"open": open_, "high": high, "low": low, "close": close,
                 "volume": rng.integers(500, 5000, size=n).astype(float)},
                index=idx,
            )
        )


def get_provider(cfg: DataConfig) -> Provider:
    name = cfg.provider.lower()
    if name == "yahoo":
        return YahooProvider()
    if name in {"twelvedata", "twelve_data"}:
        return TwelveDataProvider(cfg.api_key_env)
    if name == "csv":
        if not cfg.csv_path:
            raise DataError("provider 'csv' richiede data.csv_path")
        return CsvProvider(cfg.csv_path)
    if name == "synthetic":
        return SyntheticProvider()
    raise DataError(f"provider sconosciuto: {cfg.provider!r}")
