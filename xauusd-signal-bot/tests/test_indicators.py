import numpy as np
import pandas as pd
import pytest

from bot import indicators as ind


@pytest.fixture
def ohlc():
    rng = np.random.default_rng(3)
    n = 300
    close = 2300 + np.cumsum(rng.normal(0, 2.0, n))
    high = close + np.abs(rng.normal(0, 1.5, n))
    low = close - np.abs(rng.normal(0, 1.5, n))
    open_ = np.concatenate([[close[0]], close[:-1]])
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1.0}, index=idx
    )


def test_ema_matches_recursive_definition():
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    alpha = 2 / (3 + 1)
    manual = s.iloc[0]
    for value in s.iloc[1:]:
        manual = alpha * value + (1 - alpha) * manual
    out = ind.ema(s, 3)
    assert out.iloc[:2].isna().all()  # min_periods rispettato
    assert out.iloc[-1] == pytest.approx(manual)


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1, 60, dtype=float))
    assert ind.rsi(up, 14).iloc[-1] == pytest.approx(100.0)
    down = pd.Series(np.arange(60, 1, -1, dtype=float))
    assert ind.rsi(down, 14).iloc[-1] == pytest.approx(0.0)


def test_rsi_stays_in_range(ohlc):
    values = ind.rsi(ohlc["close"], 14).dropna()
    assert not values.empty
    assert values.between(0, 100).all()


def test_true_range_uses_previous_close():
    df = pd.DataFrame(
        {"open": [10, 12], "high": [11, 13], "low": [9, 12.5], "close": [10.5, 12.8]},
        index=pd.date_range("2024-01-01", periods=2, freq="h", tz="UTC"),
    )
    tr = ind.true_range(df)
    assert tr.iloc[0] == pytest.approx(2.0)  # solo high-low sulla prima barra
    assert tr.iloc[1] == pytest.approx(2.5)  # high - close precedente


def test_atr_is_positive(ohlc):
    atr = ind.atr(ohlc, 14).dropna()
    assert (atr > 0).all()


def test_adx_components_in_range(ohlc):
    out = ind.adx(ohlc, 14).dropna()
    assert out["adx"].between(0, 100).all()
    assert out["plus_di"].between(0, 100).all()


def test_swing_points_have_no_lookahead(ohlc):
    """Il valore su una barra non deve dipendere da barre future non ancora note."""
    full = ind.swing_points(ohlc, 3, 3)
    truncated = ind.swing_points(ohlc.iloc[:-1], 3, 3)
    common = truncated.index
    pd.testing.assert_frame_equal(full.loc[common], truncated)


def test_donchian_brackets_price(ohlc):
    dc = ind.donchian(ohlc, 20).dropna()
    close = ohlc.loc[dc.index, "close"]
    assert (dc["upper"] >= close).all()
    assert (dc["lower"] <= close).all()
