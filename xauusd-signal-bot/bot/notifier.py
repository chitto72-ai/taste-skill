"""Canali di invio dei segnali: console, file JSONL, Telegram, webhook."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import NotifierConfig
from .risk import PositionPlan
from .strategy import Signal

log = logging.getLogger(__name__)


def format_signal(signal: Signal, plan: PositionPlan, currency: str = "USD") -> str:
    """Messaggio operativo leggibile (usato da console e Telegram)."""
    arrow = "🟢 LONG" if signal.side == "LONG" else "🔴 SHORT"
    tps = "\n".join(
        f"  TP{i}: {tp:,.2f}   ({plan.r_multiple_at(tp):+.1f}R  →  {plan.pnl_at(tp):+,.2f} {currency})"
        for i, tp in enumerate(signal.take_profits, start=1)
    )
    lines = [
        f"{arrow}  {signal.symbol}  [{signal.timeframe}]  {signal.setup}",
        f"Barra: {signal.time:%Y-%m-%d %H:%M} UTC   Confidenza: {signal.confidence:.0f}/100",
        "",
        f"  Entry: {signal.entry:,.2f}",
        f"  SL:    {signal.stop_loss:,.2f}   ({plan.stop_distance:,.2f}$ = "
        f"{plan.risk_amount:,.2f} {currency} = {plan.risk_pct:.2f}% del conto)",
        tps,
        "",
        f"  Size: {plan.lots:.2f} lotti ({plan.units:,.0f} oz)   "
        f"1$ di movimento = {plan.value_per_dollar_move:,.2f} {currency}",
        f"  Leva {plan.leverage:.0f}x → margine {plan.required_margin:,.2f} {currency} "
        f"({plan.margin_pct:.1f}% del conto), esposizione {plan.notional:,.0f} {currency}",
        f"  Liquidazione stimata: {plan.liquidation_price:,.2f} "
        f"({plan.liquidation_distance:,.2f}$ = {plan.liquidation_buffer_ratio:.1f}x lo stop)",
        f"  Costi stimati (spread+commissioni): {plan.cost_estimate:,.2f} {currency}",
    ]
    if plan.warnings:
        lines += ["", "⚠️  " + "\n⚠️  ".join(plan.warnings)]
    if not plan.accepted:
        lines += ["", f"⛔ SEGNALE NON OPERATIVO: {plan.reject_reason}"]
    lines += ["", "Motivazioni:"] + [f"  {r}" for r in signal.reasons]
    lines += ["", "Segnale informativo, non consulenza finanziaria. Il bot non invia ordini."]
    return "\n".join(lines)


class Notifier:
    name = "base"

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        raise NotImplementedError


class ConsoleNotifier(Notifier):
    name = "console"

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        print("\n" + "─" * 72)
        print(format_signal(signal, plan))
        print("─" * 72, flush=True)
        return True


class JsonlNotifier(Notifier):
    """Storico append-only dei segnali, una riga JSON per segnale."""

    name = "jsonl"

    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        record = {"signal": signal.as_dict(), "position": plan.as_dict()}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        return True


class TelegramNotifier(Notifier):
    name = "telegram"

    def __init__(self, token_env: str, chat_id_env: str) -> None:
        self.token = os.environ.get(token_env, "").strip()
        self.chat_id = os.environ.get(chat_id_env, "").strip()
        if not self.token or not self.chat_id:
            raise ValueError(
                f"Telegram non configurato: imposta {token_env} e {chat_id_env} nell'ambiente"
            )

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        text = format_signal(signal, plan)
        payload = urllib.parse.urlencode(
            {"chat_id": self.chat_id, "text": f"```\n{text}\n```", "parse_mode": "Markdown"}
        ).encode()
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=payload), timeout=15) as r:
                return json.loads(r.read().decode()).get("ok", False)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            log.error("invio Telegram fallito: %s", exc)
            return False


class WebhookNotifier(Notifier):
    name = "webhook"

    def __init__(self, url: str) -> None:
        self.url = url

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        body = json.dumps({"signal": signal.as_dict(), "position": plan.as_dict()}).encode()
        req = urllib.request.Request(
            self.url, data=body, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, TimeoutError) as exc:
            log.error("invio webhook fallito: %s", exc)
            return False


class MultiNotifier(Notifier):
    """Inoltra a più canali; un canale rotto non blocca gli altri."""

    name = "multi"

    def __init__(self, channels: list[Notifier]) -> None:
        self.channels = channels

    def send(self, signal: Signal, plan: PositionPlan) -> bool:
        results = []
        for channel in self.channels:
            try:
                results.append(bool(channel.send(signal, plan)))
            except Exception as exc:  # un canale non deve fermare il bot
                log.error("canale %s in errore: %s", channel.name, exc)
                results.append(False)
        return any(results)


def build_notifier(cfg: NotifierConfig) -> MultiNotifier:
    channels: list[Notifier] = []
    if cfg.console:
        channels.append(ConsoleNotifier())
    if cfg.jsonl_path:
        channels.append(JsonlNotifier(cfg.jsonl_path))
    if cfg.telegram_enabled:
        channels.append(TelegramNotifier(cfg.telegram_token_env, cfg.telegram_chat_id_env))
    if cfg.webhook_url:
        channels.append(WebhookNotifier(cfg.webhook_url))
    if not channels:
        channels.append(ConsoleNotifier())
    return MultiNotifier(channels)
