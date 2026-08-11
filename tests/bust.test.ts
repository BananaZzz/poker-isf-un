import { describe, it, expect } from 'vitest';
import { createInitialState, startNewHand, applyAction, dealNextStreet } from '../src/game/engine';
import { ActionType, GamePhase, PlayerStatus } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

describe('bust behavior at engine level', () => {
  it('starting a hand with < 2 funded players yields HAND_COMPLETE', () => {
    const s0 = createInitialState(
      [{ id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 2000 }],
      cfg
    );
    const s = startNewHand(s0);
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    expect(s.currentPlayerSeat).toBeNull();
  });

  it('funded players continue when one busts (excluded from next hand)', () => {
    // Only 2 players; make A tiny stack so he busts on all-in call from B.
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 20 }, // exactly BB
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
      ],
      cfg
    );
    s = startNewHand(s);
    // HU: dealer=0 = SB (posts 10). BB = seat 1 (posts 20). Preflop first-to-act = SB.
    // a is all-in-ish (has 10 left after SB). Push a to all-in, b calls.
    // But 'a' has 10 chips left after SB, current currentBet = 20, so callAmount for a = 10.
    // If a calls, a is all-in.
    s = applyAction(s, 'a', { type: ActionType.CALL });
    // b (BB) checks — a is all-in so runout is pending; engine no longer auto-advances
    s = applyAction(s, 'b', { type: ActionType.CHECK });
    expect(s.runoutPending).toBe(true);
    // The game manager would call dealNextStreet on a timer; here we do it inline.
    while (s.phase !== GamePhase.HAND_COMPLETE && s.runoutPending) {
      // mirror the manager's per-round reset before each street
      for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
      s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
      s = dealNextStreet(s);
    }
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    // whichever way it goes, a either wins and has chips, or loses and is at 0
    const a = s.players.find((p) => p.id === 'a')!;
    const b = s.players.find((p) => p.id === 'b')!;
    // A's + B's chips should conserve to the initial 2020 total (no chips created/destroyed)
    expect(a.chips + b.chips).toBe(2020);
  });

  it('starting a new hand ignores 0-chip players by marking ELIMINATED', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 0 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 2000 },
      ],
      cfg
    );
    s = startNewHand(s);
    expect(s.players.find((p) => p.id === 'a')!.status).toBe(PlayerStatus.ELIMINATED);
    expect(s.phase).toBe(GamePhase.PRE_FLOP);
  });
});
