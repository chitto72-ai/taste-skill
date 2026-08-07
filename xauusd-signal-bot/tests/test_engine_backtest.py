import json

import pandas as pd
import pytest

from bot.backtest import run_backtest
from bot.config import Config
from bot.data import SyntheticProvider, resample
from bot.engine import SignalEngine
from bot.notifier import JsonlNotifier, MultiNotifier, format_signal
from bot.risk import build_position_plan
from bot.strategy import compute_features, evaluate

from tests.test_strategy import make_trend


class RecordingNotifier(MultiNotifier):
    def __init__(self):
        super().__init__([])
        self.sent = []

    def send(self, signal, plan):
        self.sent.append((signal, plan))
        return True


class FrozenProvider(SyntheticProvider):
    """Provider che restituisce sempre lo stesso storico."""

    name = "frozen"

    def __init__(self, df):
        self.df = df

    def fetch(self, symbol, timeframe, bars):
        return self.df if timeframe == "15m" else resample(self.df, timeframe)


def base_config(tmp_path, **risk):
    cfg = Config()
    cfg.data.provider = "synthetic"
    cfg.strategy.sessions_utc = ()
    cfg.notifier.console = False
    cfg.notifier.jsonl_path = None
    cfg.engine.state_path = str(tmp_path / "state.json")
    # Conto ampio: la serie di test arriva a stop di decine di dollari, che su
    # un conto piccolo verrebbero scartati dal vincolo di lotto minimo.
    cfg.risk.account_balance = 50_000.0
    for key, value in risk.items():
        setattr(cfg.risk, key, value)
    cfg.validate()
    return cfg


def first_signal_frame(cfg):
    """Storico troncato in modo che l'ultima barra chiusa contenga un segnale."""
    df = make_trend(n=1500)
    ent = compute_features(df, cfg.strategy)
    tre = compute_features(resample(df, "1h"), cfg.strategy)
    # Il troncamento deve lasciare abbastanza barre H1 per la EMA lenta.
    start = max(cfg.strategy.ema_slow + 5, (cfg.strategy.ema_slow + 10) * 4)
    for i in range(start, len(ent)):
        if evaluate(ent, tre, cfg.strategy, index=i, check_session=False).signal:
            return df.iloc[: i + 1]
    raise AssertionError("nessun segnale trovato nei dati di test")


def test_engine_emits_signal_and_persists_state(tmp_path):
    cfg = base_config(tmp_path)
    df = first_signal_frame(cfg)
    notifier = RecordingNotifier()
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=notifier)

    result = engine.run_once()
    assert result.analysis.signal is not None
    assert result.notified and len(notifier.sent) == 1
    assert result.plan.accepted

    state = json.loads((tmp_path / "state.json").read_text())
    assert state["last_signal_bar"] == result.analysis.signal.time.isoformat()
    assert state["signals_today"] == 1


def test_engine_does_not_repeat_the_same_bar(tmp_path):
    cfg = base_config(tmp_path)
    df = first_signal_frame(cfg)
    notifier = RecordingNotifier()
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=notifier)

    engine.run_once()
    second = engine.run_once()
    assert len(notifier.sent) == 1
    assert second.suppressed == "segnale già inviato per questa barra"


def test_engine_respects_daily_cap(tmp_path):
    cfg = base_config(tmp_path)
    cfg.engine.max_signals_per_day = 0
    df = first_signal_frame(cfg)
    notifier = RecordingNotifier()
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=notifier)
    result = engine.run_once()
    assert not notifier.sent
    assert "massimo" in result.suppressed


def test_engine_blocks_signal_rejected_by_risk(tmp_path):
    cfg = base_config(tmp_path, account_balance=150.0, risk_pct=0.5)
    df = first_signal_frame(cfg)
    notifier = RecordingNotifier()
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=notifier)
    result = engine.run_once()
    assert not notifier.sent
    assert result.suppressed.startswith("scartato dal rischio")


def test_engine_recovers_from_corrupt_state(tmp_path):
    cfg = base_config(tmp_path)
    (tmp_path / "state.json").write_text("{non json")
    engine = SignalEngine(cfg, provider=FrozenProvider(first_signal_frame(cfg)),
                          notifier=RecordingNotifier())
    assert engine.state.last_signal_bar is None


def test_jsonl_notifier_appends_records(tmp_path):
    cfg = base_config(tmp_path)
    df = first_signal_frame(cfg)
    path = tmp_path / "signals.jsonl"
    notifier = MultiNotifier([JsonlNotifier(str(path))])
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=notifier)
    engine.run_once()
    lines = path.read_text().strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["signal"]["symbol"] == "XAUUSD"
    assert record["position"]["lots"] > 0


def test_format_signal_contains_key_numbers(tmp_path):
    cfg = base_config(tmp_path)
    df = first_signal_frame(cfg)
    engine = SignalEngine(cfg, provider=FrozenProvider(df), notifier=RecordingNotifier())
    result = engine.run_once()
    text = format_signal(result.analysis.signal, result.plan)
    for token in ("Entry", "SL", "TP1", "lotti", "margine", "Liquidazione"):
        assert token in text
    assert "non consulenza finanziaria" in text


def test_backtest_is_consistent(tmp_path):
    cfg = base_config(tmp_path)
    df = make_trend(n=2000)
    result = run_backtest(df, cfg, trend_df=resample(df, "1h"), check_session=False)
    assert result.trades, "nessun trade generato"
    summary = result.summary()

    assert summary["trades"] == len(result.trades)
    assert 0 <= summary["win_rate_pct"] <= 100
    # Il saldo finale è il saldo iniziale più la somma dei P&L.
    total_pnl = sum(t.pnl for t in result.trades)
    assert result.final_balance == pytest.approx(result.initial_balance + total_pnl)
    # Nessun trade può perdere molto più di 1R (stop + costi).
    assert min(t.r_multiple for t in result.trades) > -1.6
    for trade in result.trades:
        assert trade.exit_time >= trade.entry_time
        assert trade.lots > 0


def test_backtest_trades_do_not_overlap(tmp_path):
    cfg = base_config(tmp_path)
    df = make_trend(n=2000)
    result = run_backtest(df, cfg, trend_df=resample(df, "1h"), check_session=False)
    for prev, nxt in zip(result.trades, result.trades[1:]):
        assert nxt.entry_time >= prev.exit_time


def test_backtest_requires_history(tmp_path):
    cfg = base_config(tmp_path)
    with pytest.raises(ValueError, match="storico insufficiente"):
        run_backtest(make_trend(n=120), cfg, check_session=False)


def test_backtest_skips_trades_the_risk_module_rejects(tmp_path):
    cfg = base_config(tmp_path, account_balance=150.0, risk_pct=0.5)
    df = make_trend(n=2000)
    result = run_backtest(df, cfg, trend_df=resample(df, "1h"), check_session=False)
    assert result.trades == []
    assert result.skipped_by_risk > 0


def test_higher_leverage_does_not_change_backtest_pnl(tmp_path):
    """La leva non incide sul P&L: incide solo sul margine richiesto."""
    df = make_trend(n=2000)
    results = []
    for lev in (100.0, 250.0):
        cfg = base_config(tmp_path, leverage=lev)
        results.append(run_backtest(df, cfg, trend_df=resample(df, "1h"), check_session=False))
    assert results[0].final_balance == pytest.approx(results[1].final_balance)


def test_plan_pnl_matches_backtest_r_multiples(tmp_path):
    cfg = base_config(tmp_path)
    plan = build_position_plan("LONG", 2400.0, 2390.0, cfg.risk)
    assert plan.r_multiple_at(2410.0) == pytest.approx(1.0)
    assert plan.r_multiple_at(2380.0) == pytest.approx(-2.0)
