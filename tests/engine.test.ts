import { describe, it, expect } from 'vitest';
import { createInitialState, startNewHand, applyAction, legalActions } from '../src/game/engine';
import { ActionType, GamePhase, PlayerStatus } from '../src/game/types';

const seats = [
  { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 2000 },
  { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
  { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 2000 },
];

describe('engine flow', () => {
  it('starts a hand and posts blinds', () => {
    const s0 = createInitialState(seats, { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 });
    const s = startNewHand(s0);
    expect(s.phase).toBe(GamePhase.PRE_FLOP);
    // dealer=0 -> sb=seat1 (b), bb=seat2 (c) — but seatsInOrderFrom(0) => [0,1,2]; afterDealer=[1,2,0]; sb=1,bb=2
    expect(s.players.find((p) => p.seat === 1)!.currentBet).toBe(10);
    expect(s.players.find((p) => p.seat === 2)!.currentBet).toBe(20);
    expect(s.pot).toBe(30);
    expect(s.currentBet).toBe(20);
    // preflop UTG = seat 0
    expect(s.currentPlayerSeat).toBe(0);
    // each player has 2 hole cards
    for (const p of s.players) expect(p.holeCards.length).toBe(2);
  });

  it('completes a fold-around hand awarding pot to BB', () => {
    let s = createInitialState(seats, { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 });
    s = startNewHand(s);
    // UTG folds
    s = applyAction(s, 'a', { type: ActionType.FOLD });
    // SB folds
    s = applyAction(s, 'b', { type: ActionType.FOLD });
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    const bb = s.players.find((p) => p.seat === 2)!;
    // BB started 2000 - 20 (blind) + 30 (pot) = 2010
    expect(bb.chips).toBe(2010);
  });

  it('legal actions reflect state', () => {
    let s = createInitialState(seats, { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 });
    s = startNewHand(s);
    const la = legalActions(s, 'a');
    expect(la.actions).toContain(ActionType.FOLD);
    expect(la.actions).toContain(ActionType.CALL);
    expect(la.actions).toContain(ActionType.RAISE);
    expect(la.actions).not.toContain(ActionType.CHECK);
    expect(la.callAmount).toBe(20);
  });

  it('goes preflop -> flop -> turn -> river -> showdown when all check/call', () => {
    let s = createInitialState(seats, { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 });
    s = startNewHand(s);
    // preflop: a calls, b (sb) calls, c (bb) checks
    s = applyAction(s, 'a', { type: ActionType.CALL });
    s = applyAction(s, 'b', { type: ActionType.CALL });
    s = applyAction(s, 'c', { type: ActionType.CHECK });
    expect(s.phase).toBe(GamePhase.FLOP);
    expect(s.community.length).toBe(3);
    // flop: everyone checks (first to act post-flop = first active left of dealer = seat 1)
    s = applyAction(s, 'b', { type: ActionType.CHECK });
    s = applyAction(s, 'c', { type: ActionType.CHECK });
    s = applyAction(s, 'a', { type: ActionType.CHECK });
    expect(s.phase).toBe(GamePhase.TURN);
    expect(s.community.length).toBe(4);
    s = applyAction(s, 'b', { type: ActionType.CHECK });
    s = applyAction(s, 'c', { type: ActionType.CHECK });
    s = applyAction(s, 'a', { type: ActionType.CHECK });
    expect(s.phase).toBe(GamePhase.RIVER);
    expect(s.community.length).toBe(5);
    s = applyAction(s, 'b', { type: ActionType.CHECK });
    s = applyAction(s, 'c', { type: ActionType.CHECK });
    s = applyAction(s, 'a', { type: ActionType.CHECK });
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    expect(s.showdown).toBeTruthy();
  });

  it('heads-up: dealer/SB acts first preflop', () => {
    const hu = seats.slice(0, 2);
    let s = createInitialState(hu, { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 });
    s = startNewHand(s);
    // In HU, seat 0 = dealer/SB acts first
    expect(s.currentPlayerSeat).toBe(0);
    expect(s.players.find((p) => p.seat === 0)!.currentBet).toBe(10);
    expect(s.players.find((p) => p.seat === 1)!.currentBet).toBe(20);
  });
});
