import type { TokenProfile, TokenRef } from './token.js';
import type { TokenScore } from './scoring.js';
import type { CloseReason, Position } from './trading.js';

export interface EntrySignal {
  readonly id: string;
  readonly strategy: string;
  readonly token: TokenRef;
  readonly profile: TokenProfile;
  readonly score: TokenScore;
  /** 0..1 — feeds the Kelly sizer as the edge estimate. */
  readonly conviction: number;
  readonly expectedWinRate: number;
  readonly expectedPayoffRatio: number;
  readonly suggestedStopPct: number;
  readonly maxHoldMs: number;
  readonly reasons: readonly string[];
  readonly at: number;
}

export interface ExitSignal {
  readonly positionId: string;
  readonly reason: CloseReason;
  /** Fraction of the CURRENT quantity to liquidate, 0..1. */
  readonly fraction: number;
  readonly urgency: 'economy' | 'standard' | 'fast' | 'turbo';
  readonly note: string;
  readonly at: number;
}

export interface StrategyContext {
  readonly now: number;
  readonly openPositions: readonly Position[];
  readonly equity: number;
  readonly availableCapital: number;
}

/** Evaluated once per scanner tick against every candidate token. */
export interface EntryCondition {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface EntryEvaluation {
  readonly token: TokenRef;
  readonly conditions: readonly EntryCondition[];
  readonly passed: boolean;
  readonly signal?: EntrySignal;
}
