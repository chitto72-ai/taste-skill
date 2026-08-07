import math

import pytest

from bot.config import ConfigError, Config, RiskConfig
from bot.risk import (
    build_position_plan,
    leverage_table,
    liquidation_price,
    max_units_for_liquidation_buffer,
)


def cfg(**kwargs) -> RiskConfig:
    base = dict(account_balance=10_000.0, risk_pct=1.0, leverage=100.0, spread_usd=0.0)
    return RiskConfig(**{**base, **kwargs})


def test_size_respects_risk_budget():
    plan = build_position_plan("LONG", 2400.0, 2390.0, cfg())
    # 1% di 10.000 = 100$ di rischio su uno stop di 10$ -> 10 once = 0.10 lotti
    assert plan.lots == pytest.approx(0.10)
    assert plan.units == pytest.approx(10.0)
    assert plan.risk_amount == pytest.approx(100.0)
    assert plan.risk_pct == pytest.approx(1.0)
    assert plan.accepted


def test_risk_is_independent_of_leverage():
    """Il rischio per trade dipende da size e stop, non dal moltiplicatore."""
    plans = [build_position_plan("LONG", 2400.0, 2390.0, cfg(leverage=lev))
             for lev in (100.0, 150.0, 250.0)]
    assert len({round(p.risk_amount, 6) for p in plans}) == 1
    assert len({round(p.lots, 6) for p in plans}) == 1
    # La leva cambia solo il margine bloccato...
    assert plans[0].required_margin > plans[-1].required_margin
    # ...e più margine libero significa liquidazione più lontana.
    assert plans[-1].liquidation_distance > plans[0].liquidation_distance


def test_stop_side_validation():
    with pytest.raises(ValueError, match="lato sbagliato"):
        build_position_plan("LONG", 2400.0, 2410.0, cfg())
    with pytest.raises(ValueError, match="lato sbagliato"):
        build_position_plan("SHORT", 2400.0, 2390.0, cfg())
    with pytest.raises(ValueError):
        build_position_plan("LONG", 2400.0, 2400.0, cfg())


def test_short_plan_pnl_direction():
    plan = build_position_plan("SHORT", 2400.0, 2410.0, cfg())
    assert plan.pnl_at(2390.0) > 0
    assert plan.pnl_at(2410.0) == pytest.approx(-plan.risk_amount)
    assert plan.r_multiple_at(2380.0) == pytest.approx(2.0)


def test_liquidation_formula_matches_stop_out_definition():
    balance, entry, units, lev, stop_out = 10_000.0, 2400.0, 20.0, 100.0, 0.5
    price, distance = liquidation_price("LONG", entry, units, balance, lev, stop_out)
    margin = units * entry / lev
    equity_at_liq = balance - units * distance
    assert equity_at_liq == pytest.approx(stop_out * margin)
    assert price == pytest.approx(entry - distance)


def test_max_units_formula_matches_stop_out_definition():
    balance, entry, stop, lev, so, k = 1_000.0, 2400.0, 5.0, 100.0, 0.5, 3.0
    units = max_units_for_liquidation_buffer(balance, entry, stop, lev, so, k)
    _, distance = liquidation_price("LONG", entry, units, balance, lev, so)
    assert distance == pytest.approx(k * stop)


def test_liquidation_buffer_caps_size_when_it_binds():
    """Con un buffer molto conservativo il vincolo di liquidazione taglia la size."""
    aggressive = cfg(account_balance=1_000.0, risk_pct=5.0, liquidation_buffer=30.0,
                     min_lot=0.001, lot_step=0.001)
    plan = build_position_plan("LONG", 2400.0, 2395.0, aggressive)
    assert plan.accepted
    assert plan.liquidation_buffer_ratio >= 30.0 - 0.5
    assert "buffer di liquidazione" in " ".join(plan.notes)
    assert plan.risk_pct < aggressive.risk_pct  # size ridotta sotto il budget di rischio


@pytest.mark.parametrize("balance", [1_000.0, 10_000.0, 100_000.0])
@pytest.mark.parametrize("stop", [1.5, 7.0, 30.0])
@pytest.mark.parametrize("lev", [100.0, 250.0])
def test_size_never_exceeds_any_cap(balance, stop, lev):
    conf = cfg(account_balance=balance, leverage=lev, risk_pct=1.0,
               min_lot=0.001, lot_step=0.001)
    plan = build_position_plan("LONG", 2400.0, 2400.0 - stop, conf)
    caps = [
        balance * conf.risk_pct / 100.0 / stop,
        balance * conf.max_margin_pct / 100.0 * lev / 2400.0,
        max_units_for_liquidation_buffer(
            balance, 2400.0, stop, lev, conf.stop_out_level_pct / 100.0, conf.liquidation_buffer
        ),
    ]
    assert plan.units <= min(caps) + 1e-9


def test_margin_cap_limits_size():
    tight = cfg(account_balance=10_000.0, risk_pct=5.0, max_margin_pct=1.0,
                liquidation_buffer=1.0)
    plan = build_position_plan("LONG", 2400.0, 2399.0, tight)
    assert plan.margin_pct <= 1.0 + 1e-6
    assert "tetto di margine" in " ".join(plan.notes)


def test_rejects_when_min_lot_exceeds_risk_budget():
    """Conto troppo piccolo per il lotto minimo: il segnale non è operativo."""
    tiny = cfg(account_balance=300.0, risk_pct=1.0)
    plan = build_position_plan("LONG", 2400.0, 2390.0, tiny)
    assert not plan.accepted
    assert "lotto minimo" in plan.reject_reason
    # Il piano riportato usa il lotto minimo per mostrare il rischio reale.
    assert plan.lots == pytest.approx(tiny.min_lot)
    assert plan.risk_pct > tiny.risk_pct


def test_rejects_when_liquidation_falls_before_stop():
    over = cfg(account_balance=200.0, risk_pct=5.0, min_lot=1.0, lot_step=1.0,
               leverage=250.0)
    plan = build_position_plan("LONG", 2400.0, 2380.0, over)
    assert not plan.accepted
    assert "liquidazione" in plan.reject_reason.lower()


def test_warning_when_costs_eat_the_risk():
    plan = build_position_plan("LONG", 2400.0, 2398.0, cfg(spread_usd=1.0))
    assert plan.accepted
    assert any("costi stimati" in w for w in plan.warnings)


def test_lots_rounded_down_to_step():
    plan = build_position_plan("LONG", 2400.0, 2393.0, cfg(lot_step=0.01))
    assert plan.lots == pytest.approx(round(plan.lots, 2))
    assert plan.lots * 100 <= 10_000 * 0.01 / 7.0 + 1e-9


def test_leverage_table_covers_allowed_range():
    rows = leverage_table(cfg(), 2400.0, 8.0)
    assert [r["leverage"] for r in rows] == [100.0, 150.0, 200.0, 250.0]
    assert all(r["risk_pct"] == pytest.approx(rows[0]["risk_pct"]) for r in rows)
    assert rows[-1]["margin"] < rows[0]["margin"]


def test_config_rejects_leverage_outside_band():
    conf = Config()
    conf.risk.leverage = 500.0
    with pytest.raises(ConfigError, match="fuori dall'intervallo"):
        conf.validate()
    conf.risk.leverage = 50.0
    with pytest.raises(ConfigError):
        conf.validate()


def test_plan_serialization_is_json_friendly():
    plan = build_position_plan("LONG", 2400.0, 2390.0, cfg())
    data = plan.as_dict()
    assert data["accepted"] is True
    assert all(isinstance(v, (int, float, str, bool, list, type(None)))
               for v in data.values())
    assert not math.isnan(data["liquidation_price"])
