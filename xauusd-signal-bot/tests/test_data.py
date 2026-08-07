import json

import pandas as pd
import pytest

from bot.config import DataConfig
from bot.data import (
    DataError,
    CsvProvider,
    SyntheticProvider,
    YahooProvider,
    drop_unclosed_bar,
    get_provider,
    normalize,
    resample,
    timeframe_minutes,
)


def test_timeframe_parsing():
    assert timeframe_minutes("15m") == 15
    assert timeframe_minutes("1H") == 60
    with pytest.raises(DataError):
        timeframe_minutes("3s")


def test_normalize_sorts_dedupes_and_localizes():
    idx = pd.to_datetime(["2024-01-01 01:00", "2024-01-01 00:00", "2024-01-01 01:00"])
    df = pd.DataFrame(
        {"open": [2, 1, 3], "high": [2, 1, 3], "low": [2, 1, 3],
         "close": [2, 1, 3], "volume": [1, 1, 1]},
        index=idx,
    )
    out = normalize(df)
    assert out.index.tz is not None
    assert list(out["close"]) == [1, 3]  # ordinato, ultimo duplicato vince


def test_normalize_requires_ohlc():
    df = pd.DataFrame({"close": [1.0]}, index=pd.date_range("2024-01-01", periods=1, tz="UTC"))
    with pytest.raises(DataError, match="colonne mancanti"):
        normalize(df)


def test_drop_unclosed_bar():
    idx = pd.date_range("2024-01-01 00:00", periods=3, freq="15min", tz="UTC")
    df = pd.DataFrame({"open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0}, index=idx)
    now = idx[-1] + pd.Timedelta(minutes=5)  # ultima barra ancora in formazione
    assert len(drop_unclosed_bar(df, "15m", now=now)) == 2
    now = idx[-1] + pd.Timedelta(minutes=20)  # ultima barra chiusa
    assert len(drop_unclosed_bar(df, "15m", now=now)) == 3


def test_resample_aggregates_correctly():
    idx = pd.date_range("2024-01-01 00:00", periods=8, freq="15min", tz="UTC")
    df = pd.DataFrame(
        {"open": range(8), "high": range(1, 9), "low": range(-1, 7),
         "close": range(8), "volume": [1.0] * 8},
        index=idx,
    ).astype(float)
    out = resample(df, "1h")
    assert len(out) == 2
    assert out.iloc[0]["open"] == 0.0
    assert out.iloc[0]["high"] == 4.0
    assert out.iloc[0]["low"] == -1.0
    assert out.iloc[0]["close"] == 3.0
    assert out.iloc[0]["volume"] == 4.0


def test_synthetic_provider_is_deterministic_and_coherent():
    df = SyntheticProvider(seed=42).fetch("XAUUSD", "15m", 300)
    again = SyntheticProvider(seed=42).fetch("XAUUSD", "15m", 300)
    assert len(df) == 300
    assert (df["high"] >= df[["open", "close"]].max(axis=1) - 1e-9).all()
    assert (df["low"] <= df[["open", "close"]].min(axis=1) + 1e-9).all()
    assert df["close"].round(6).equals(again["close"].round(6))


def test_yahoo_parser_handles_payload():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1700000000, 1700000900],
                    "indicators": {
                        "quote": [
                            {
                                "open": [1990.0, 1991.0],
                                "high": [1995.0, 1996.0],
                                "low": [1988.0, 1989.0],
                                "close": [1993.0, 1994.0],
                                "volume": [10, None],
                            }
                        ]
                    },
                }
            ],
            "error": None,
        }
    }
    df = YahooProvider._parse(json.loads(json.dumps(payload)))
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert df["volume"].iloc[-1] == 0.0
    assert df.index.tz is not None


def test_yahoo_parser_reports_api_error():
    with pytest.raises(DataError):
        YahooProvider._parse({"chart": {"error": {"code": "Not Found"}}})


def test_csv_provider_roundtrip(tmp_path):
    src = SyntheticProvider(seed=3).fetch("XAUUSD", "15m", 120)
    path = tmp_path / "xauusd.csv"
    src.reset_index(names="time").to_csv(path, index=False)
    out = CsvProvider(str(path)).fetch("XAUUSD", "15m", 120)
    assert len(out) == 120
    assert out["close"].iloc[-1] == pytest.approx(src["close"].iloc[-1])


def test_csv_provider_needs_time_column(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("open,high,low,close\n1,1,1,1\n")
    with pytest.raises(DataError, match="colonna time"):
        CsvProvider(str(path)).fetch("XAUUSD", "15m", 10)


def test_get_provider_dispatch():
    assert get_provider(DataConfig(provider="synthetic")).name == "synthetic"
    assert get_provider(DataConfig(provider="yahoo")).name == "yahoo"
    with pytest.raises(DataError, match="sconosciuto"):
        get_provider(DataConfig(provider="mt5"))
    with pytest.raises(DataError, match="csv_path"):
        get_provider(DataConfig(provider="csv"))
