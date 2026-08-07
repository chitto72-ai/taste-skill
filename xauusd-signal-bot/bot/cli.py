"""Interfaccia a riga di comando del bot."""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .config import Config, ConfigError, load_config
from .data import DataError, drop_unclosed_bar, get_provider, resample
from .engine import SignalEngine
from .notifier import format_signal
from .risk import build_position_plan, leverage_table
from .strategy import analyze

DISCLAIMER = (
    "Questo software genera segnali informativi e NON invia ordini. Il trading su "
    "XAUUSD con leva 100x-250x può azzerare il capitale in pochi minuti: usalo prima "
    "su conto demo e non rischiare denaro che non puoi permetterti di perdere."
)


def _apply_overrides(cfg: Config, args: argparse.Namespace) -> Config:
    if getattr(args, "provider", None):
        cfg.data.provider = args.provider
    if getattr(args, "csv", None):
        cfg.data.provider, cfg.data.csv_path = "csv", args.csv
    if getattr(args, "symbol", None):
        cfg.data.symbol = args.symbol
    if getattr(args, "timeframe", None):
        cfg.data.entry_timeframe = args.timeframe
    if getattr(args, "trend_timeframe", None):
        cfg.data.trend_timeframe = args.trend_timeframe
    if getattr(args, "bars", None):
        cfg.data.bars = args.bars
    if getattr(args, "balance", None) is not None:
        cfg.risk.account_balance = args.balance
    if getattr(args, "leverage", None) is not None:
        cfg.risk.leverage = args.leverage
    if getattr(args, "risk_pct", None) is not None:
        cfg.risk.risk_pct = args.risk_pct
    if getattr(args, "no_session_filter", False):
        cfg.strategy.sessions_utc = ()
    if getattr(args, "quiet", False):
        cfg.notifier.console = False
    cfg.validate()
    return cfg


def _load(args: argparse.Namespace) -> Config:
    return _apply_overrides(load_config(args.config), args)


def cmd_signal(args: argparse.Namespace) -> int:
    cfg = _load(args)
    engine = SignalEngine(cfg)
    result = engine.run_once(notify=not args.no_notify)
    analysis = result.analysis

    if args.json:
        print(json.dumps(
            {
                "time": analysis.time.isoformat(),
                "price": round(analysis.price, 2),
                "bias": analysis.bias,
                "signal": analysis.signal.as_dict() if analysis.signal else None,
                "position": result.plan.as_dict() if result.plan else None,
                "blockers": analysis.blockers,
                "suppressed": result.suppressed,
                "features": analysis.features,
            },
            indent=2, ensure_ascii=False,
        ))
        return 0

    if analysis.signal is None:
        print(f"\nNessun segnale su {cfg.data.symbol} — barra {analysis.time:%Y-%m-%d %H:%M} UTC "
              f"@ {analysis.price:,.2f} (bias H1: {analysis.bias})")
        for blocker in analysis.blockers or ["nessun trigger valido"]:
            print(f"  · {blocker}")
        return 0

    if not result.notified:  # notifica soppressa o disattivata: stampo comunque
        print("\n" + format_signal(analysis.signal, result.plan, cfg.risk.account_currency))
        if result.suppressed:
            print(f"\n(nessun invio ai canali: {result.suppressed})")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    cfg = _load(args)
    print(DISCLAIMER + "\n")
    SignalEngine(cfg).run_forever()
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    from .backtest import format_report, run_backtest

    cfg = _load(args)
    provider = get_provider(cfg.data)
    entry_df = drop_unclosed_bar(
        provider.fetch(cfg.data.symbol, cfg.data.entry_timeframe, cfg.data.bars),
        cfg.data.entry_timeframe,
    )
    trend_df = resample(entry_df, cfg.data.trend_timeframe)
    result = run_backtest(
        entry_df, cfg, trend_df=trend_df,
        max_bars_in_trade=args.max_bars, check_session=not args.no_session_filter,
    )
    if args.json:
        print(json.dumps(result.summary(), indent=2, ensure_ascii=False))
    else:
        print(format_report(result, cfg))
    return 0


def cmd_levels(args: argparse.Namespace) -> int:
    """Confronto della stessa idea di trade alle diverse leve consentite."""
    cfg = _load(args)
    entry, stop_distance = args.entry, args.stop
    rows = leverage_table(cfg.risk, entry, stop_distance)
    print(
        f"\nXAUUSD @ {entry:,.2f} — stop a {stop_distance:.2f}$ — conto "
        f"{cfg.risk.account_balance:,.0f} {cfg.risk.account_currency} — "
        f"rischio {cfg.risk.risk_pct:g}%/trade\n"
    )
    header = (f"{'leva':>6} {'lotti':>7} {'margine':>10} {'%conto':>7} {'rischio%':>9} "
              f"{'dist.liq':>9} {'liq/stop':>9}  stato")
    print(header)
    print("-" * len(header))
    for r in rows:
        stato = "ok" if r["accepted"] else "scartato (sotto il lotto minimo)"
        print(
            f"{r['leverage']:>5.0f}x {r['lots']:>7.2f} {r['margin']:>10.2f} "
            f"{r['margin_pct']:>6.1f}% {r['risk_pct']:>8.2f}% {r['liq_distance']:>9.2f} "
            f"{r['liq_buffer']:>8.2f}x  {stato}"
        )
    print(
        "\nA parità di size il rischio per trade non cambia con la leva: cambia solo il "
        "margine bloccato. Alzare la leva libera margine e allontana la liquidazione; "
        "ciò che azzera il conto è la size, non il moltiplicatore."
    )
    return 0


def cmd_selftest(args: argparse.Namespace) -> int:
    """Verifica end-to-end su dati sintetici, senza rete."""
    cfg = _load(args)
    cfg.data.provider = "synthetic"
    cfg.data.bars = max(cfg.data.bars, 1500)
    cfg.notifier.jsonl_path = None
    cfg.strategy.sessions_utc = ()
    cfg.validate()

    provider = get_provider(cfg.data)
    entry_df = provider.fetch(cfg.data.symbol, cfg.data.entry_timeframe, cfg.data.bars)
    trend_df = resample(entry_df, cfg.data.trend_timeframe)
    analysis = analyze(entry_df, trend_df, cfg.strategy, check_session=False)
    print(f"✓ dati sintetici: {len(entry_df)} barre {cfg.data.entry_timeframe}, "
          f"{len(trend_df)} barre {cfg.data.trend_timeframe}")
    print(f"✓ analisi ultima barra: bias {analysis.bias}, "
          f"segnale={'sì' if analysis.signal else 'no'}")
    if analysis.signal:
        plan = build_position_plan(
            analysis.signal.side, analysis.signal.entry, analysis.signal.stop_loss, cfg.risk
        )
        print("\n" + format_signal(analysis.signal, plan, cfg.risk.account_currency))

    from .backtest import format_report, run_backtest

    result = run_backtest(entry_df, cfg, trend_df=trend_df, check_session=False)
    print("\n" + format_report(result, cfg, max_rows=5))
    print("\n✓ pipeline completa funzionante (dati sintetici: le metriche non hanno "
          "alcun valore predittivo)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xauusd-bot",
        description="Bot di analisi e segnali per XAUUSD (leva 100x-250x). " + DISCLAIMER,
    )
    parser.add_argument("-c", "--config", help="file di configurazione YAML")
    parser.add_argument("-v", "--verbose", action="store_true", help="log di debug")

    common = argparse.ArgumentParser(add_help=False)
    # Ripetuto qui per accettare `-c` anche dopo il sottocomando; SUPPRESS
    # evita che il default sovrascriva il valore passato prima.
    common.add_argument("-c", "--config", default=argparse.SUPPRESS,
                        help="file di configurazione YAML")
    common.add_argument("--provider", choices=["yahoo", "twelvedata", "csv", "synthetic"])
    common.add_argument("--csv", help="percorso CSV storico (imposta provider=csv)")
    common.add_argument("--symbol")
    common.add_argument("--timeframe", help="timeframe di ingresso (es. 15m)")
    common.add_argument("--trend-timeframe", help="timeframe del bias (es. 1h)")
    common.add_argument("--bars", type=int, help="numero di barre da scaricare")
    common.add_argument("--balance", type=float, help="capitale del conto")
    common.add_argument("--leverage", type=float, help="leva usata (100-250)")
    common.add_argument("--risk-pct", type=float, help="%% di capitale a rischio per trade")
    common.add_argument("--no-session-filter", action="store_true",
                        help="ignora il filtro sulle sessioni operative")
    common.add_argument("--quiet", action="store_true", help="niente output su console")

    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("signal", parents=[common], help="analizza ora e mostra l'eventuale segnale")
    p.add_argument("--json", action="store_true")
    p.add_argument("--no-notify", action="store_true", help="non inviare ai canali configurati")
    p.set_defaults(func=cmd_signal)

    p = sub.add_parser("run", parents=[common], help="esegui il bot in continuo")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("backtest", parents=[common], help="backtest della strategia")
    p.add_argument("--max-bars", type=int, default=96, help="durata massima di un trade in barre")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_backtest)

    p = sub.add_parser("levels", parents=[common], help="confronta le leve 100x-250x sullo stesso setup")
    p.add_argument("--entry", type=float, required=True, help="prezzo di ingresso")
    p.add_argument("--stop", type=float, required=True, help="distanza dello stop in dollari")
    p.set_defaults(func=cmd_levels)

    p = sub.add_parser("selftest", parents=[common], help="verifica end-to-end offline")
    p.set_defaults(func=cmd_selftest)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    try:
        return args.func(args)
    except (ConfigError, DataError, ValueError) as exc:
        print(f"errore: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\ninterrotto", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
