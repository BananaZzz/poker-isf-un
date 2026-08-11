import type { Card } from './cards';

export enum GamePhase {
  WAITING = 'WAITING',
  PRE_FLOP = 'PRE_FLOP',
  FLOP = 'FLOP',
  TURN = 'TURN',
  RIVER = 'RIVER',
  SHOWDOWN = 'SHOWDOWN',
  HAND_COMPLETE = 'HAND_COMPLETE',
}

export enum PlayerStatus {
  ACTIVE = 'ACTIVE',
  FOLDED = 'FOLDED',
  ALL_IN = 'ALL_IN',
  SITTING_OUT = 'SITTING_OUT',
  ELIMINATED = 'ELIMINATED',
}

export enum ActionType {
  FOLD = 'FOLD',
  CHECK = 'CHECK',
  CALL = 'CALL',
  BET = 'BET',
  RAISE = 'RAISE',
  ALL_IN = 'ALL_IN',
}

export interface PlayerAction {
  type: ActionType;
  amount?: number; // for BET/RAISE = total bet-to amount for the round
}

export interface PlayerState {
  id: string;
  username: string;
  avatar: string;
  avatarUpdatedAt?: number | null;  // ms since epoch, for cache-busting the /api/users/[id]/avatar image
  seat: number;
  chips: number;
  currentBet: number; // amount put in THIS betting round
  totalContribution: number; // amount put in THIS HAND across all rounds
  holeCards: Card[];
  status: PlayerStatus;
  hasActedThisRound: boolean;
}

export interface WinnerInfo {
  playerId: string;
  amount: number;
  handName: string;
  handCards?: Card[];
  potIndex?: number;
}

export interface PotFlow {
  potIndex: number;
  potAmount: number;
  contributions: Array<{ playerId: string; amount: number }>;
  winners: Array<{ playerId: string; award: number }>;
  handName: string;
}

export interface GameState {
  handNumber: number;
  phase: GamePhase;
  players: PlayerState[];
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  community: Card[];
  deck: Card[];
  currentBet: number; // highest bet-to amount this round
  minRaise: number; // minimum raise increment
  lastRaiseAmount: number;
  pot: number; // sum of all contributions this hand
  currentPlayerSeat: number | null;
  lastAggressorSeat: number | null;
  actionTimerMs: number;
  actionDeadline: number | null;
  showdown: WinnerInfo[] | null;
  potFlows: PotFlow[] | null;
  history: string[]; // human-readable log
  /**
   * True when no active player can act any more (all remaining in-hand players
   * are all-in) and there are still community cards to reveal. The game manager
   * paces the runout with timers; this flag tells the client to expect it.
   */
  runoutPending: boolean;
  /**
   * Player IDs who have voluntarily flipped their hole cards face-up after a
   * hand that did NOT reach a mandatory showdown (usually the winner of an
   * everyone-folded pot). Reset at every startNewHand. Reconnecting during
   * the result phase reads the current set so the flip is idempotent.
   */
  voluntaryReveals: string[];
  /**
   * True if this completed hand went to a real (rules-mandated) showdown —
   * i.e. two or more players reached river with cards. False for hands that
   * ended because everyone else folded ("uncontested"), in which case the
   * winner's hole cards are hidden unless they voluntarily reveal them.
   */
  mandatoryShowdown: boolean;
}
