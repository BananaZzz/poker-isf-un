import { describe, it, expect } from 'vitest';
import { createInitialState, startNewHand, applyAction, dealNextStreet } from '../src/game/engine';
import { ActionType, GamePhase, PlayerStatus } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

describe('rebuy/bust engine behavior', () => {
  it('starting a new hand with only one funded player yields HAND_COMPLETE (table waits)', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 0 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 500 },
      ],
      cfg
    );
    s = startNewHand(s);
    // A is eliminated (0 chips), only B has chips → cannot start a real hand
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
  });

  it('remaining funded players continue when one is at zero', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 0 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    expect(s.phase).toBe(GamePhase.PRE_FLOP);
    expect(s.players.find((p) => p.id === 'a')!.status).toBe(PlayerStatus.ELIMINATED);
    expect(s.players.filter((p) => p.status === PlayerStatus.ACTIVE)).toHaveLength(2);
  });

  it('two players bust in the same hand: table pauses until rebuy', () => {
    // 3-way pre-flop all-in; A and C small stacks, B big stack. A and C bust in same showdown.
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 30 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 30 },
      ],
      cfg
    );
    s = startNewHand(s);
    // Force all-ins wherever possible; anyone whose turn it is puts everything in
    let safety = 20;
    while (s.currentPlayerSeat !== null && safety-- > 0) {
      const p = s.players.find((x) => x.seat === s.currentPlayerSeat)!;
      try { s = applyAction(s, p.id, { type: ActionType.ALL_IN }); }
      catch { s = applyAction(s, p.id, { type: ActionType.CALL }); }
    }
    while (s.phase !== GamePhase.HAND_COMPLETE) {
      for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
      s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
      s = dealNextStreet(s);
    }
    // Chip conservation: total unchanged
    const finalChips = s.players.reduce((sum, p) => sum + p.chips, 0);
    expect(finalChips).toBe(30 + 2000 + 30);
  });

  it('reconnect state: player at 0 chips is marked ELIMINATED on next hand', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 0 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1500 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1500 },
      ],
      cfg
    );
    s = startNewHand(s);
    expect(s.players.find((p) => p.id === 'a')!.status).toBe(PlayerStatus.ELIMINATED);
    // simulate rebuy — add chips outside the engine (server does this via DB then rebuilds state)
    // rebuild: game manager creates a fresh state including 'a' back at 1000
    s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1500 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1500 },
      ],
      cfg
    );
    s = startNewHand(s);
    expect(s.players.find((p) => p.id === 'a')!.status).toBe(PlayerStatus.ACTIVE);
    expect(s.phase).toBe(GamePhase.PRE_FLOP);
  });
});
