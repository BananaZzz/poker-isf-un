import { buildDeck, shuffle, cardToString, type Card } from './cards';
import { evaluateBest7, compareHandRank } from './handEval';
import { computePots, type PlayerContribution } from './pots';
import {
  ActionType,
  GamePhase,
  PlayerStatus,
  type GameState,
  type PlayerAction,
  type PlayerState,
  type WinnerInfo,
} from './types';

export interface EngineConfig {
  smallBlind: number;
  bigBlind: number;
  actionTimerMs: number;
}

export interface SeatInput {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  chips: number;
}

export function createInitialState(seats: SeatInput[], cfg: EngineConfig): GameState {
  const players: PlayerState[] = seats
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      id: s.id,
      username: s.username,
      avatar: s.avatar,
      seat: s.seat,
      chips: s.chips,
      currentBet: 0,
      totalContribution: 0,
      holeCards: [],
      status: PlayerStatus.ACTIVE,
      hasActedThisRound: false,
    }));

  return {
    handNumber: 0,
    phase: GamePhase.WAITING,
    players,
    dealerSeat: players[0]?.seat ?? 0,
    smallBlind: cfg.smallBlind,
    bigBlind: cfg.bigBlind,
    community: [],
    deck: [],
    currentBet: 0,
    minRaise: cfg.bigBlind,
    lastRaiseAmount: cfg.bigBlind,
    pot: 0,
    currentPlayerSeat: null,
    lastAggressorSeat: null,
    actionTimerMs: cfg.actionTimerMs,
    actionDeadline: null,
    showdown: null,
    history: [],
  };
}

function alivePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.status !== PlayerStatus.ELIMINATED);
}

function inHand(s: GameState): PlayerState[] {
  return s.players.filter(
    (p) => p.status === PlayerStatus.ACTIVE || p.status === PlayerStatus.ALL_IN
  );
}

function activeToAct(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.status === PlayerStatus.ACTIVE);
}

function seatsInOrderFrom(s: GameState, startSeat: number, includeSelf = true): PlayerState[] {
  const seats = alivePlayers(s).map((p) => p.seat).sort((a, b) => a - b);
  if (seats.length === 0) return [];
  const idx = seats.findIndex((x) => x >= startSeat);
  const start = idx === -1 ? 0 : idx;
  const ordered: number[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[(start + i) % seats.length];
    if (!includeSelf && seat === startSeat && i === 0) continue;
    ordered.push(seat);
  }
  return ordered.map((seat) => s.players.find((p) => p.seat === seat)!);
}

function nextActiveSeat(s: GameState, fromSeat: number): number | null {
  const order = seatsInOrderFrom(s, fromSeat, false);
  for (const p of order) {
    if (p.status === PlayerStatus.ACTIVE) return p.seat;
  }
  return null;
}

export function startNewHand(state: GameState): GameState {
  const s: GameState = structuredClone(state);
  // reset per-hand player state, remove eliminated
  for (const p of s.players) {
    if (p.chips <= 0) {
      p.status = PlayerStatus.ELIMINATED;
    }
    if (p.status !== PlayerStatus.ELIMINATED) {
      p.status = PlayerStatus.ACTIVE;
    }
    p.holeCards = [];
    p.currentBet = 0;
    p.totalContribution = 0;
    p.hasActedThisRound = false;
  }
  const alive = alivePlayers(s);
  if (alive.length < 2) {
    s.phase = GamePhase.HAND_COMPLETE;
    s.showdown = null;
    s.currentPlayerSeat = null;
    return s;
  }
  s.handNumber += 1;
  s.community = [];
  s.pot = 0;
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.lastRaiseAmount = s.bigBlind;
  s.showdown = null;
  s.history = [`Hand #${s.handNumber} — deck shuffled`];
  s.deck = shuffle(buildDeck());

  // move dealer button
  if (s.handNumber === 1) {
    s.dealerSeat = alive[0].seat;
  } else {
    const next = nextActiveSeat(s, s.dealerSeat);
    if (next !== null) s.dealerSeat = next;
  }

  // deal hole cards, dealer-first-clockwise convention: start with SB
  const order = seatsInOrderFrom(s, s.dealerSeat).filter(
    (p) => p.status === PlayerStatus.ACTIVE
  );
  // deal two cards, one at a time, starting from first player after dealer
  const afterDealer = order.slice(1).concat(order[0]); // put dealer last for hole dealing convention (SB first)
  for (let round = 0; round < 2; round++) {
    for (const p of afterDealer) {
      const c = s.deck.pop()!;
      p.holeCards.push(c);
    }
  }

  // blinds
  const sbPlayer = heads_up(s, order) ? order[0] : afterDealer[0];
  // In heads-up: dealer/button is SB; other is BB
  // Otherwise: first player left of dealer = SB, next = BB
  let sb: PlayerState;
  let bb: PlayerState;
  if (order.length === 2) {
    sb = order[0]; // dealer is SB
    bb = order[1];
  } else {
    sb = afterDealer[0];
    bb = afterDealer[1];
  }
  postBlind(sb, s.smallBlind, s);
  postBlind(bb, s.bigBlind, s);
  s.currentBet = s.bigBlind;
  s.lastRaiseAmount = s.bigBlind;
  s.minRaise = s.bigBlind;
  s.lastAggressorSeat = bb.seat;

  // first to act preflop: player left of BB (or SB in heads-up)
  let firstToAct: PlayerState;
  if (order.length === 2) {
    firstToAct = sb; // dealer/SB acts first preflop in HU
  } else {
    const bbIdx = afterDealer.findIndex((p) => p.id === bb.id);
    firstToAct = afterDealer[(bbIdx + 1) % afterDealer.length];
  }
  s.phase = GamePhase.PRE_FLOP;
  s.currentPlayerSeat = firstToAct.seat;
  s.actionDeadline = Date.now() + s.actionTimerMs;

  return s;
}

function heads_up(_s: GameState, order: PlayerState[]): boolean {
  return order.length === 2;
}

function postBlind(p: PlayerState, amount: number, s: GameState): void {
  const put = Math.min(amount, p.chips);
  p.chips -= put;
  p.currentBet += put;
  p.totalContribution += put;
  s.pot += put;
  if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
  s.history.push(`${p.username} posts ${put}`);
}

export function legalActions(s: GameState, playerId: string): {
  actions: ActionType[];
  callAmount: number;
  minRaiseTo: number;
  maxBetTo: number;
} {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || s.currentPlayerSeat !== p.seat || p.status !== PlayerStatus.ACTIVE) {
    return { actions: [], callAmount: 0, minRaiseTo: 0, maxBetTo: 0 };
  }
  const toCall = Math.max(0, s.currentBet - p.currentBet);
  const actions: ActionType[] = [ActionType.FOLD];
  if (toCall === 0) actions.push(ActionType.CHECK);
  if (toCall > 0) actions.push(ActionType.CALL);
  if (s.currentBet === 0) {
    actions.push(ActionType.BET);
  } else if (p.chips > toCall) {
    actions.push(ActionType.RAISE);
  }
  actions.push(ActionType.ALL_IN);
  const minRaiseTo = s.currentBet + s.minRaise;
  const maxBetTo = p.currentBet + p.chips;
  return { actions, callAmount: toCall, minRaiseTo, maxBetTo };
}

export function applyAction(state: GameState, playerId: string, action: PlayerAction): GameState {
  const s: GameState = structuredClone(state);
  const p = s.players.find((x) => x.id === playerId);
  if (!p) throw new Error('unknown player');
  if (s.currentPlayerSeat !== p.seat) throw new Error('not your turn');
  if (p.status !== PlayerStatus.ACTIVE) throw new Error('not active');

  const toCall = Math.max(0, s.currentBet - p.currentBet);

  switch (action.type) {
    case ActionType.FOLD: {
      p.status = PlayerStatus.FOLDED;
      p.hasActedThisRound = true;
      s.history.push(`${p.username} folds`);
      break;
    }
    case ActionType.CHECK: {
      if (toCall !== 0) throw new Error('cannot check');
      p.hasActedThisRound = true;
      s.history.push(`${p.username} checks`);
      break;
    }
    case ActionType.CALL: {
      if (toCall === 0) throw new Error('nothing to call');
      const put = Math.min(toCall, p.chips);
      p.chips -= put;
      p.currentBet += put;
      p.totalContribution += put;
      s.pot += put;
      if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
      p.hasActedThisRound = true;
      s.history.push(`${p.username} calls ${put}`);
      break;
    }
    case ActionType.BET: {
      if (s.currentBet !== 0) throw new Error('cannot bet, use raise');
      const to = action.amount ?? 0;
      if (to < s.bigBlind && to !== p.chips) throw new Error('bet below big blind');
      if (to > p.chips + p.currentBet) throw new Error('bet exceeds chips');
      const put = to - p.currentBet;
      p.chips -= put;
      p.currentBet = to;
      p.totalContribution += put;
      s.pot += put;
      s.currentBet = to;
      s.lastRaiseAmount = to;
      s.minRaise = to;
      s.lastAggressorSeat = p.seat;
      resetActedExceptAggressor(s, p.seat);
      p.hasActedThisRound = true;
      if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
      s.history.push(`${p.username} bets ${to}`);
      break;
    }
    case ActionType.RAISE: {
      const to = action.amount ?? 0;
      const minRaiseTo = s.currentBet + s.minRaise;
      // allow all-in short raise
      const isAllIn = to === p.chips + p.currentBet;
      if (!isAllIn && to < minRaiseTo) throw new Error('raise below minimum');
      if (to > p.chips + p.currentBet) throw new Error('raise exceeds chips');
      const put = to - p.currentBet;
      p.chips -= put;
      const raiseIncrement = to - s.currentBet;
      p.currentBet = to;
      p.totalContribution += put;
      s.pot += put;
      if (raiseIncrement >= s.minRaise) {
        s.lastRaiseAmount = raiseIncrement;
        s.minRaise = raiseIncrement;
        s.lastAggressorSeat = p.seat;
        resetActedExceptAggressor(s, p.seat);
      }
      s.currentBet = to;
      p.hasActedThisRound = true;
      if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
      s.history.push(`${p.username} raises to ${to}`);
      break;
    }
    case ActionType.ALL_IN: {
      const to = p.currentBet + p.chips;
      const put = p.chips;
      const raiseIncrement = to - s.currentBet;
      p.chips = 0;
      p.currentBet = to;
      p.totalContribution += put;
      s.pot += put;
      if (to > s.currentBet) {
        // aggressive all-in
        if (raiseIncrement >= s.minRaise) {
          s.lastRaiseAmount = raiseIncrement;
          s.minRaise = raiseIncrement;
          s.lastAggressorSeat = p.seat;
          resetActedExceptAggressor(s, p.seat);
        }
        s.currentBet = to;
      }
      p.status = PlayerStatus.ALL_IN;
      p.hasActedThisRound = true;
      s.history.push(`${p.username} is all-in for ${to}`);
      break;
    }
  }

  return advance(s);
}

function resetActedExceptAggressor(s: GameState, aggressorSeat: number): void {
  for (const p of s.players) {
    if (p.status === PlayerStatus.ACTIVE && p.seat !== aggressorSeat) {
      p.hasActedThisRound = false;
    }
  }
}

function isBettingRoundComplete(s: GameState): boolean {
  const contenders = s.players.filter(
    (p) => p.status === PlayerStatus.ACTIVE || p.status === PlayerStatus.ALL_IN
  );
  if (contenders.length <= 1) return true;
  const active = contenders.filter((p) => p.status === PlayerStatus.ACTIVE);
  if (active.length === 0) return true;
  // all active players have matched current bet AND acted
  return active.every((p) => p.hasActedThisRound && p.currentBet === s.currentBet);
}

function advance(s: GameState): GameState {
  // check if only one non-folded remains → award pot
  const remaining = s.players.filter((p) => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.ELIMINATED);
  if (remaining.length === 1) {
    return finishHandUncalled(s, remaining[0]);
  }

  if (!isBettingRoundComplete(s)) {
    // move turn to next active player
    const nextSeat = nextActiveSeat(s, s.currentPlayerSeat ?? s.dealerSeat);
    if (nextSeat === null) {
      // no one left to act
      return advanceRound(s);
    }
    s.currentPlayerSeat = nextSeat;
    s.actionDeadline = Date.now() + s.actionTimerMs;
    return s;
  }
  return advanceRound(s);
}

function advanceRound(s: GameState): GameState {
  // collect currentBets into totalContribution already done incrementally; just reset currentBet
  for (const p of s.players) {
    p.currentBet = 0;
    p.hasActedThisRound = false;
  }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.lastRaiseAmount = s.bigBlind;
  s.lastAggressorSeat = null;

  // if no active players (all-ins), deal remaining board then showdown
  const activeCount = s.players.filter((p) => p.status === PlayerStatus.ACTIVE).length;

  const nextPhase = ((): GamePhase => {
    switch (s.phase) {
      case GamePhase.PRE_FLOP: return GamePhase.FLOP;
      case GamePhase.FLOP: return GamePhase.TURN;
      case GamePhase.TURN: return GamePhase.RIVER;
      case GamePhase.RIVER: return GamePhase.SHOWDOWN;
      default: return s.phase;
    }
  })();

  if (nextPhase === GamePhase.FLOP) {
    s.deck.pop(); // burn
    s.community.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
    s.history.push(`Flop: ${s.community.slice(0, 3).map(cardToString).join(' ')}`);
  } else if (nextPhase === GamePhase.TURN) {
    s.deck.pop();
    s.community.push(s.deck.pop()!);
    s.history.push(`Turn: ${cardToString(s.community[3])}`);
  } else if (nextPhase === GamePhase.RIVER) {
    s.deck.pop();
    s.community.push(s.deck.pop()!);
    s.history.push(`River: ${cardToString(s.community[4])}`);
  }

  s.phase = nextPhase;

  if (nextPhase === GamePhase.SHOWDOWN) {
    return doShowdown(s);
  }

  if (activeCount <= 1) {
    // no one can act; auto-run through remaining streets
    return advanceRound(s);
  }

  // first to act post-flop: first active player left of dealer
  const nextSeat = firstToActPostFlop(s);
  s.currentPlayerSeat = nextSeat;
  s.actionDeadline = nextSeat !== null ? Date.now() + s.actionTimerMs : null;
  return s;
}

function firstToActPostFlop(s: GameState): number | null {
  const order = seatsInOrderFrom(s, s.dealerSeat, false);
  for (const p of order) {
    if (p.status === PlayerStatus.ACTIVE) return p.seat;
  }
  return null;
}

function finishHandUncalled(s: GameState, winner: PlayerState): GameState {
  winner.chips += s.pot;
  s.showdown = [{ playerId: winner.id, amount: s.pot, handName: 'Uncontested' }];
  s.history.push(`${winner.username} wins ${s.pot} (uncontested)`);
  s.pot = 0;
  s.phase = GamePhase.HAND_COMPLETE;
  s.currentPlayerSeat = null;
  s.actionDeadline = null;
  return s;
}

function doShowdown(s: GameState): GameState {
  const contenders = s.players.filter(
    (p) => p.status === PlayerStatus.ACTIVE || p.status === PlayerStatus.ALL_IN
  );
  const contribs: PlayerContribution[] = s.players.map((p) => ({
    playerId: p.id,
    amount: p.totalContribution,
    folded: p.status === PlayerStatus.FOLDED,
  }));
  const pots = computePots(contribs);

  const evals = new Map<string, ReturnType<typeof evaluateBest7>>();
  for (const p of contenders) {
    evals.set(p.id, evaluateBest7([...p.holeCards, ...s.community]));
  }

  const winners: WinnerInfo[] = [];
  for (const pot of pots) {
    const eligibleContenders = contenders.filter((p) => pot.eligiblePlayerIds.includes(p.id));
    if (eligibleContenders.length === 0) continue;
    // find best hand(s)
    let best = evals.get(eligibleContenders[0].id)!;
    let bestPlayers: PlayerState[] = [eligibleContenders[0]];
    for (let i = 1; i < eligibleContenders.length; i++) {
      const r = evals.get(eligibleContenders[i].id)!;
      const cmp = compareHandRank(r, best);
      if (cmp > 0) {
        best = r;
        bestPlayers = [eligibleContenders[i]];
      } else if (cmp === 0) {
        bestPlayers.push(eligibleContenders[i]);
      }
    }
    // split pot
    const each = Math.floor(pot.amount / bestPlayers.length);
    let remainder = pot.amount - each * bestPlayers.length;
    // odd chip: give to first player left of dealer among winners
    const orderFromDealer = seatsInOrderFrom(s, s.dealerSeat, false)
      .filter((p) => bestPlayers.some((w) => w.id === p.id));
    const oddOrder = orderFromDealer.length ? orderFromDealer : bestPlayers;
    for (const w of bestPlayers) {
      let award = each;
      if (remainder > 0 && oddOrder[0].id === w.id) {
        award += remainder;
        remainder = 0;
      }
      w.chips += award;
      winners.push({
        playerId: w.id,
        amount: award,
        handName: best.name,
        handCards: best.cards,
      });
      s.history.push(`${w.username} wins ${award} with ${best.name}`);
    }
  }
  s.showdown = winners;
  s.pot = 0;
  s.phase = GamePhase.HAND_COMPLETE;
  s.currentPlayerSeat = null;
  s.actionDeadline = null;
  return s;
}

/** Called when player timer expires. Auto CHECK if possible, else FOLD. */
export function timeoutAction(state: GameState, playerId: string): GameState {
  const legal = legalActions(state, playerId);
  if (legal.actions.length === 0) return state;
  if (legal.actions.includes(ActionType.CHECK)) {
    return applyAction(state, playerId, { type: ActionType.CHECK });
  }
  return applyAction(state, playerId, { type: ActionType.FOLD });
}

/** Public redacted view for a specific viewer — hides other players' hole cards. */
export function redactStateFor(state: GameState, viewerId: string | null): GameState {
  const s: GameState = structuredClone(state);
  // deck is server-only
  s.deck = [];
  const showdownOn = s.phase === GamePhase.SHOWDOWN || s.phase === GamePhase.HAND_COMPLETE;
  for (const p of s.players) {
    if (p.id !== viewerId && !showdownOn) {
      p.holeCards = p.holeCards.map(() => ({ suit: 'h' as const, rank: 2 as const })); // hidden marker; UI ignores rank
      // simpler: mark as hidden by emptying
      p.holeCards = [];
    }
  }
  return s;
}
