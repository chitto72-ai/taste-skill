"""Orchestrazione: dati → analisi → rischio → notifica, con stato persistente."""

from __future__ import annotations

import json
import logging
import signal as os_signal
import time
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from .config import Config
from .data import DataError, Provider, drop_unclosed_bar, get_provider, resample, timeframe_minutes
from .notifier import MultiNotifier, build_notifier
from .risk import PositionPlan, build_position_plan
from .strategy import Analysis, Signal, analyze

log = logging.getLogger(__name__)


@dataclass
class EngineState:
    last_bar: str | None = None
    last_signal_bar: str | None = None
    last_side: str | None = None
    day: str | None = None
    signals_today: int = 0
    history: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: str) -> EngineState:
        p = Path(path)
        if not p.exists():
            return cls()
        try:
            return cls(**json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, TypeError) as exc:
            log.warning("stato illeggibile in %s (%s): riparto da zero", path, exc)
            return cls()

    def save(self, path: str) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self.__dict__, "history": self.history[-100:]}
        p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


@dataclass
class Result:
    """Esito di un ciclo dell'engine."""

    analysis: Analysis
    plan: PositionPlan | None = None
    notified: bool = False
    suppressed: str | None = None


class SignalEngine:
    def __init__(
        self,
        cfg: Config,
        provider: Provider | None = None,
        notifier: MultiNotifier | None = None,
    ) -> None:
        self.cfg = cfg
        self.provider = provider or get_provider(cfg.data)
        self.notifier = notifier or build_notifier(cfg.notifier)
        self.state = EngineState.load(cfg.engine.state_path)
        self._stop = False

    # ------------------------------------------------------------------ dati
    def fetch_frames(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        d = self.cfg.data
        entry = drop_unclosed_bar(
            self.provider.fetch(d.symbol, d.entry_timeframe, d.bars), d.entry_timeframe
        )
        ratio = max(1, timeframe_minutes(d.trend_timeframe) // timeframe_minutes(d.entry_timeframe))
        try:
            trend = drop_unclosed_bar(
                self.provider.fetch(d.symbol, d.trend_timeframe, d.bars), d.trend_timeframe
            )
        except DataError as exc:
            log.warning("timeframe superiore non disponibile (%s): lo ricostruisco da %s",
                        exc, d.entry_timeframe)
            trend = drop_unclosed_bar(
                resample(
                    self.provider.fetch(d.symbol, d.entry_timeframe, d.bars * ratio),
                    d.trend_timeframe,
                ),
                d.trend_timeframe,
            )
        if entry.empty or trend.empty:
            raise DataError("serie priva di barre chiuse")
        return entry, trend

    # --------------------------------------------------------------- filtri
    def _suppression_reason(self, sig: Signal) -> str | None:
        eng = self.cfg.engine
        day = sig.time.strftime("%Y-%m-%d")
        if self.state.day != day:
            self.state.day, self.state.signals_today = day, 0
        if self.state.signals_today >= eng.max_signals_per_day:
            return f"raggiunto il massimo di {eng.max_signals_per_day} segnali per la giornata"
        if self.state.last_signal_bar:
            last = pd.Timestamp(self.state.last_signal_bar)
            elapsed = (sig.time - last) / pd.Timedelta(
                minutes=timeframe_minutes(self.cfg.data.entry_timeframe)
            )
            if 0 <= elapsed < eng.cooldown_bars and self.state.last_side == sig.side:
                return (
                    f"cooldown attivo: {elapsed:.0f}/{eng.cooldown_bars} barre "
                    f"dall'ultimo segnale {sig.side}"
                )
        return None

    # ------------------------------------------------------------------ ciclo
    def run_once(self, notify: bool = True) -> Result:
        entry_df, trend_df = self.fetch_frames()
        analysis = analyze(
            entry_df,
            trend_df,
            self.cfg.strategy,
            symbol=self.cfg.data.symbol,
            timeframe=self.cfg.data.entry_timeframe,
        )
        bar_id = analysis.time.isoformat()

        if analysis.signal is None:
            self.state.last_bar = bar_id
            self.state.save(self.cfg.engine.state_path)
            return Result(analysis)

        sig = analysis.signal
        plan = build_position_plan(sig.side, sig.entry, sig.stop_loss, self.cfg.risk)

        suppressed = None
        if self.state.last_signal_bar == bar_id:
            suppressed = "segnale già inviato per questa barra"
        elif not plan.accepted:
            suppressed = f"scartato dal rischio: {plan.reject_reason}"
        else:
            suppressed = self._suppression_reason(sig)

        notified = False
        if suppressed is None and notify:
            notified = self.notifier.send(sig, plan)
            self.state.last_signal_bar = bar_id
            self.state.last_side = sig.side
            self.state.signals_today += 1
            self.state.history.append({"signal": sig.as_dict(), "position": plan.as_dict()})

        self.state.last_bar = bar_id
        self.state.save(self.cfg.engine.state_path)
        return Result(analysis, plan, notified, suppressed)

    def request_stop(self, *_: object) -> None:
        self._stop = True
        log.info("arresto richiesto: chiudo dopo il ciclo corrente")

    def run_forever(self) -> None:
        for sig_name in (os_signal.SIGINT, os_signal.SIGTERM):
            try:
                os_signal.signal(sig_name, self.request_stop)
            except (ValueError, OSError):  # thread secondario o piattaforma limitata
                pass

        log.info(
            "bot avviato — %s %s/%s via %s | leva %.0fx | rischio %.2f%% | dry_run=%s",
            self.cfg.data.symbol, self.cfg.data.entry_timeframe, self.cfg.data.trend_timeframe,
            self.provider.name, self.cfg.risk.leverage, self.cfg.risk.risk_pct,
            self.cfg.engine.dry_run,
        )
        backoff = self.cfg.engine.poll_seconds
        while not self._stop:
            try:
                result = self.run_once()
                backoff = self.cfg.engine.poll_seconds
                if result.analysis.signal is None:
                    log.info(
                        "%s | %.2f | bias %s | %s",
                        result.analysis.time.strftime("%Y-%m-%d %H:%M"),
                        result.analysis.price,
                        result.analysis.bias,
                        "; ".join(result.analysis.blockers) or "nessun trigger",
                    )
                elif result.suppressed:
                    log.info("segnale non inviato — %s", result.suppressed)
            except DataError as exc:
                backoff = min(backoff * 2, 900)
                log.warning("errore dati (%s): riprovo tra %ss", exc, backoff)
            except Exception:
                log.exception("errore inatteso nel ciclo")
                backoff = min(backoff * 2, 900)
            self._sleep(backoff)
        log.info("bot fermato")

    def _sleep(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self._stop and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))
