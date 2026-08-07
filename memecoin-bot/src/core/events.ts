import type {
  EntryEvaluation,
  EntrySignal,
  ExitSignal,
  OrderRequest,
  OrderResult,
  Position,
  TokenProfile,
  TokenScore,
  TradeRecord,
  TxReceipt,
  WalletActivity,
} from './domain/index.js';
import type { AppError } from './errors.js';

/**
 * The single source of truth for cross-module communication. Modules never
 * import each other's classes to react to something — they publish and
 * subscribe here, which is what keeps discovery, strategy, risk and execution
 * independently testable.
 */
export interface EventMap {
  'engine.started': { mode: string; at: number };
  'engine.stopping': { reason: string; at: number };
  'engine.stopped': { at: number };
  'engine.tick': { seq: number; at: number };

  'token.discovered': { profile: TokenProfile };
  'token.updated': { profile: TokenProfile };
  'token.scored': { profile: TokenProfile; score: TokenScore };
  'token.rejected': { profile: TokenProfile; score: TokenScore; reason: string };
  'token.evaluated': { evaluation: EntryEvaluation };

  'signal.entry': { signal: EntrySignal };
  'signal.exit': { signal: ExitSignal };

  'order.submitted': { order: OrderRequest };
  'order.filled': { order: OrderRequest; result: OrderResult };
  'order.rejected': { order: OrderRequest; result: OrderResult };

  'position.opened': { position: Position };
  'position.updated': { position: Position };
  'position.partial_exit': { position: Position; fraction: number; reason: string };
  'position.closed': { position: Position; trade: TradeRecord };

  'risk.rejected': { reason: string; context: Record<string, unknown> };
  'risk.halted': { reason: string; until: number };
  'risk.resumed': { at: number };
  'risk.updated': { equity: number; drawdownPct: number; openPositions: number };

  'wallet.activity': { activity: WalletActivity };
  'wallet.promoted': { address: string; chain: string; reason: string };
  'wallet.demoted': { address: string; chain: string; reason: string };

  'chain.tx_confirmed': { receipt: TxReceipt };
  'chain.rpc_failover': { chain: string; from: string; to: string; reason: string };

  'health.changed': { component: string; healthy: boolean; detail: string };
  'error.occurred': { error: AppError; component: string };
}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K];
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;
export type AnyEventHandler = (name: EventName, payload: EventMap[EventName]) => void | Promise<void>;
