import numpy as np
import pandas as pd
import pytest

from bot.config import StrategyConfig
from bot.data import resample
from bot.strategy import LONG, SHORT, analyze, compute_features, evaluate, trend_bias


def make_trend(n=900, drift=0.0006, seed=1, start=2300.0):
    """Serie 15m con drift costante: trend pulito e riconoscibile."""
    rng = np.random.default_rng(seed)
    rets = drift + rng.normal(0, 0.0006, n)
    close = start * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start], close[:-1]])
    wick = np.abs(rng.normal(0, 0.0005, n)) * close
    idx = pd.date_range("2024-03-01 00:00", periods=n, freq="15min", tz="UTC")
    return pd.DataFrame(
        {
            "open": open_,
            "high": np.maximum(open_, close) + wick,
            "low": np.minimum(open_, close) - wick,
            "close": close,
            "volume": 100.0,
        },
        index=idx,
    )


@pytest.fixture
def cfg():
    return StrategyConfig()


def test_bias_is_long_in_an_uptrend(cfg):
    df = compute_features(resample(make_trend(), "1h"), cfg)
    bias, strength, _ = trend_bias(df.iloc[-1], cfg)
    assert bias == LONG
    assert strength > 0.7


def test_bias_is_short_in_a_downtrend(cfg):
    df = compute_features(resample(make_trend(drift=-0.0006), "1h"), cfg)
    bias, strength, _ = trend_bias(df.iloc[-1], cfg)
    assert bias == SHORT
    assert strength > 0.7


def test_analyze_requires_enough_history(cfg):
    small = make_trend(n=100)
    with pytest.raises(ValueError, match="almeno"):
        analyze(small, resample(small, "1h"), cfg)


def test_signals_are_internally_consistent(cfg):
    """Su ogni segnale: stop dal lato giusto, target crescenti in R."""
    df = make_trend(n=1500)
    ent = compute_features(df, cfg)
    tre = compute_features(resample(df, "1h"), cfg)
    signals = [
        a.signal
        for i in range(cfg.ema_slow + 5, len(ent))
        if (a := evaluate(ent, tre, cfg, index=i, check_session=False)).signal
    ]
    assert signals, "la strategia non ha prodotto segnali su un trend pulito"
    for sig in signals:
        risk = sig.risk_distance
        assert risk > 0
        if sig.side == LONG:
            assert sig.stop_loss < sig.entry < min(sig.take_profits)
        else:
            assert sig.stop_loss > sig.entry > max(sig.take_profits)
        for mult, tp in zip(cfg.take_profit_r, sig.take_profits):
            assert abs(tp - sig.entry) == pytest.approx(mult * risk)
        assert 0 <= sig.confidence <= 100
        assert sig.confidence >= cfg.min_confidence


def test_signal_side_follows_the_higher_timeframe_bias(cfg):
    for drift, expected in ((0.0006, LONG), (-0.0006, SHORT)):
        df = make_trend(n=1500, drift=drift, seed=5)
        ent = compute_features(df, cfg)
        tre = compute_features(resample(df, "1h"), cfg)
        sides = {
            a.signal.side
            for i in range(cfg.ema_slow + 5, len(ent))
            if (a := evaluate(ent, tre, cfg, index=i, check_session=False)).signal
        }
        assert sides <= {expected}


def test_session_filter_blocks_out_of_hours(cfg):
    cfg.sessions_utc = (("07:00", "16:00"),)
    df = make_trend(n=1500)
    ent = compute_features(df, cfg)
    tre = compute_features(resample(df, "1h"), cfg)
    times = [
        a.time
        for i in range(cfg.ema_slow + 5, len(ent))
        if (a := evaluate(ent, tre, cfg, index=i, check_session=True)).signal
    ]
    assert all(7 <= t.hour < 16 for t in times)


def test_overnight_session_wraps_midnight(cfg):
    cfg.sessions_utc = (("22:00", "02:00"),)
    df = make_trend(n=1500)
    ent = compute_features(df, cfg)
    tre = compute_features(resample(df, "1h"), cfg)
    times = [
        a.time
        for i in range(cfg.ema_slow + 5, len(ent))
        if (a := evaluate(ent, tre, cfg, index=i, check_session=True)).signal
    ]
    assert times, "nessun segnale nella sessione notturna"
    assert all(t.hour >= 22 or t.hour < 2 for t in times)


def test_flat_market_produces_no_signal(cfg):
    """Mercato laterale senza trend: nessun trade di continuazione."""
    df = make_trend(n=1200, drift=0.0, seed=11)
    result = analyze(df, resample(df, "1h"), cfg, check_session=False)
    assert result.signal is None or result.signal.confidence >= cfg.min_confidence
    if result.signal is None:
        assert result.blockers


def test_evaluation_does_not_depend_on_future_bars(cfg):
    """L'analisi della barra i deve essere identica con o senza barre successive."""
    df = make_trend(n=1000)
    ent_full = compute_features(df, cfg)
    tre_full = compute_features(resample(df, "1h"), cfg)
    i = len(ent_full) - 30
    a_full = evaluate(ent_full, tre_full, cfg, index=i, check_session=False)

    truncated = df.iloc[: i + 1]
    a_trunc = evaluate(
        compute_features(truncated, cfg),
        compute_features(resample(truncated, "1h"), cfg),
        cfg, index=-1, check_session=False,
    )
    assert a_full.bias == a_trunc.bias
    assert (a_full.signal is None) == (a_trunc.signal is None)
    if a_full.signal:
        assert a_full.signal.entry == pytest.approx(a_trunc.signal.entry)
        assert a_full.signal.stop_loss == pytest.approx(a_trunc.signal.stop_loss)


def test_signal_serialization(cfg):
    df = make_trend(n=1500)
    ent = compute_features(df, cfg)
    tre = compute_features(resample(df, "1h"), cfg)
    sig = next(
        a.signal
        for i in range(cfg.ema_slow + 5, len(ent))
        if (a := evaluate(ent, tre, cfg, index=i, check_session=False)).signal
    )
    data = sig.as_dict()
    assert data["side"] in {LONG, SHORT}
    assert len(data["take_profits"]) == len(cfg.take_profit_r)
    assert data["rr_final"] == pytest.approx(cfg.take_profit_r[-1], abs=0.05)
