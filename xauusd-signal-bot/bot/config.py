"""Caricamento e validazione della configurazione."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any

try:  # PyYAML è opzionale: senza di esso resta la configurazione di default
    import yaml
except ImportError:  # pragma: no cover - dipende dall'ambiente
    yaml = None


class ConfigError(ValueError):
    """Configurazione assente, malformata o incoerente."""


@dataclass
class DataConfig:
    provider: str = "yahoo"
    symbol: str = "XAUUSD"
    entry_timeframe: str = "15m"
    trend_timeframe: str = "1h"
    bars: int = 500
    csv_path: str | None = None
    api_key_env: str = "MARKET_DATA_API_KEY"


@dataclass
class StrategyConfig:
    ema_fast: int = 20
    ema_mid: int = 50
    ema_slow: int = 200
    rsi_length: int = 14
    atr_length: int = 14
    adx_length: int = 14
    adx_min: float = 18.0
    breakout_length: int = 20
    # Volatilità minima/massima accettata, in % del prezzo (ATR/close)
    min_atr_pct: float = 0.03
    max_atr_pct: float = 1.20
    # Stop: max(ATR * mult, distanza dalla struttura + buffer)
    atr_sl_mult: float = 1.5
    atr_sl_buffer: float = 0.25
    take_profit_r: tuple[float, ...] = (1.0, 2.0, 3.0)
    # Punteggio minimo (0-100) sotto il quale il setup viene scartato
    min_confidence: float = 55.0
    # Sessioni operative in UTC (inclusive-esclusive). Vuoto = sempre attivo.
    sessions_utc: tuple[tuple[str, str], ...] = (("07:00", "16:00"),)


@dataclass
class RiskConfig:
    account_balance: float = 2000.0
    account_currency: str = "USD"
    risk_pct: float = 1.0  # % del capitale a rischio per trade
    leverage: float = 100.0
    min_leverage: float = 100.0
    max_leverage: float = 250.0
    contract_size: float = 100.0  # 1 lotto XAUUSD = 100 once
    min_lot: float = 0.01
    lot_step: float = 0.01
    max_lot: float = 100.0
    # Stop-out del broker: la posizione viene chiusa quando
    # equity/margine_usato scende sotto questa soglia (in %).
    stop_out_level_pct: float = 50.0
    # Margine massimo impegnabile in % del capitale.
    max_margin_pct: float = 30.0
    # La distanza di liquidazione deve valere almeno N volte lo stop.
    liquidation_buffer: float = 2.0
    # Rifiuta il segnale se lo stop resta oltre la distanza di liquidazione
    # anche dopo aver ridotto la size al lotto minimo.
    reject_if_stop_beyond_liquidation: bool = True
    spread_usd: float = 0.30
    commission_per_lot: float = 0.0


@dataclass
class NotifierConfig:
    console: bool = True
    jsonl_path: str | None = "signals.jsonl"
    telegram_enabled: bool = False
    telegram_token_env: str = "TELEGRAM_BOT_TOKEN"
    telegram_chat_id_env: str = "TELEGRAM_CHAT_ID"
    webhook_url: str | None = None


@dataclass
class EngineConfig:
    poll_seconds: int = 60
    # Barre di attesa prima di riemettere un segnale sullo stesso lato.
    cooldown_bars: int = 4
    max_signals_per_day: int = 6
    state_path: str = ".bot_state.json"
    dry_run: bool = True  # il bot non invia ordini: emette solo segnali


@dataclass
class Config:
    data: DataConfig = field(default_factory=DataConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    notifier: NotifierConfig = field(default_factory=NotifierConfig)
    engine: EngineConfig = field(default_factory=EngineConfig)

    def validate(self) -> None:
        r = self.risk
        if r.account_balance <= 0:
            raise ConfigError("risk.account_balance deve essere > 0")
        if not 0 < r.risk_pct <= 5:
            raise ConfigError("risk.risk_pct deve essere compreso tra 0 e 5 (%)")
        if r.min_leverage <= 0 or r.max_leverage < r.min_leverage:
            raise ConfigError("intervallo di leva non valido")
        if not r.min_leverage <= r.leverage <= r.max_leverage:
            raise ConfigError(
                f"risk.leverage ({r.leverage}x) fuori dall'intervallo consentito "
                f"{r.min_leverage:g}x-{r.max_leverage:g}x"
            )
        if r.contract_size <= 0 or r.lot_step <= 0 or r.min_lot <= 0:
            raise ConfigError("contract_size, min_lot e lot_step devono essere > 0")
        if not 0 < r.max_margin_pct <= 100:
            raise ConfigError("risk.max_margin_pct deve essere compreso tra 0 e 100")
        if r.liquidation_buffer < 1.0:
            raise ConfigError("risk.liquidation_buffer deve essere >= 1.0")
        if not 0 <= r.stop_out_level_pct < 100:
            raise ConfigError("risk.stop_out_level_pct deve essere compreso tra 0 e 100")

        s = self.strategy
        if s.ema_fast >= s.ema_mid or s.ema_mid >= s.ema_slow:
            raise ConfigError("le EMA devono rispettare fast < mid < slow")
        if not s.take_profit_r:
            raise ConfigError("strategy.take_profit_r non può essere vuoto")
        if list(s.take_profit_r) != sorted(s.take_profit_r) or s.take_profit_r[0] <= 0:
            raise ConfigError("strategy.take_profit_r deve essere crescente e positivo")
        if s.min_atr_pct >= s.max_atr_pct:
            raise ConfigError("min_atr_pct deve essere minore di max_atr_pct")

        if self.data.provider == "csv" and not self.data.csv_path:
            raise ConfigError("provider 'csv' richiede data.csv_path")
        if self.engine.poll_seconds < 5:
            raise ConfigError("engine.poll_seconds deve essere >= 5")


def _coerce(value: Any, target_type: Any) -> Any:
    origin = getattr(target_type, "__origin__", None)
    if origin is tuple and isinstance(value, (list, tuple)):
        args = getattr(target_type, "__args__", ())
        if len(args) == 2 and args[1] is Ellipsis:
            return tuple(_coerce(v, args[0]) for v in value)
        return tuple(value)
    if target_type is float and isinstance(value, (int, float)):
        return float(value)
    if target_type is int and isinstance(value, bool):
        return int(value)
    return value


def _build(cls: type, data: dict[str, Any]) -> Any:
    known = {f.name: f.type for f in fields(cls)}
    unknown = set(data) - set(known)
    if unknown:
        raise ConfigError(f"chiavi sconosciute in {cls.__name__}: {sorted(unknown)}")
    kwargs = {name: _coerce(value, known[name]) for name, value in data.items()}
    return cls(**kwargs)


def load_config(path: str | os.PathLike[str] | None = None) -> Config:
    """Legge la configurazione YAML; senza file usa i valori di default."""
    cfg = Config()
    if path is not None:
        p = Path(path)
        if not p.exists():
            raise ConfigError(f"file di configurazione non trovato: {p}")
        if yaml is None:
            raise ConfigError("PyYAML non installato: `pip install pyyaml`")
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise ConfigError("il file di configurazione deve contenere una mappa")
        sections = {f.name: f for f in fields(Config)}
        unknown = set(raw) - set(sections)
        if unknown:
            raise ConfigError(f"sezioni sconosciute: {sorted(unknown)}")
        for name, section in raw.items():
            if section is None:
                continue
            if not isinstance(section, dict):
                raise ConfigError(f"la sezione '{name}' deve essere una mappa")
            target = sections[name].default_factory()  # type: ignore[misc]
            assert is_dataclass(target)
            setattr(cfg, name, _build(type(target), section))
    cfg.validate()
    return cfg
