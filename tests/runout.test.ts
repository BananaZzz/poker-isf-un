import { describe, it, expect, vi } from 'vitest';
import {
  createInitialState, startNewHand, applyAction, dealNextStreet, legalActions,
} from '../src/game/engine';
import { ActionType, GamePhase } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

/**
 * Force a pre-flop all-in scenario in a 2-player game and simulate the
 * server's paced runout with fake timers.
 */
describe('all-in runout event ordering', () => {
  it('runout does not auto-advance; game manager pace goes PRE_FLOP → FLOP → TURN → RIVER → SHOWDOWN', async () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 40 }, // small stack
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
      ],
      cfg
    );
    s = startNewHand(s);
    // In HU: dealer=0 = SB. currentPlayerSeat = 0. SB posted 10, BB posted 20.
    // Force A all-in: A has 30 left after SB. Total to = 40.
    s = applyAction(s, 'a', { type: ActionType.ALL_IN });
    // B calls the all-in — the manager auto-advances one street synchronously
    // via applyAction's `advance` (betting round is complete); further streets
    // are deferred to the pacer.
    s = applyAction(s, 'b', { type: ActionType.CALL });
    expect(s.phase).toBe(GamePhase.FLOP);
    expect(s.community.length).toBe(3);
    expect(s.runoutPending).toBe(true);

    // Simulate the pacer via fake timers — the manager's scheduleRunout
    // calls dealNextStreet inside a setTimeout. Verify exact ordering.
    const events: string[] = [];
    vi.useFakeTimers();
    try {
      const pump = () => {
        for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
        s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
        s = dealNextStreet(s);
        events.push(s.phase);
      };
      // Remaining streets: TURN, RIVER, SHOWDOWN(→HAND_COMPLETE)
      setTimeout(pump, 950);
      setTimeout(pump, 950 + 950);
      setTimeout(pump, 950 + 950 + 800);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(events).toEqual([
      GamePhase.TURN,
      GamePhase.RIVER,
      GamePhase.HAND_COMPLETE, // dealNextStreet(RIVER) transitions to SHOWDOWN and then to HAND_COMPLETE inside doShowdown
    ]);
    // Community always 5 cards at showdown
    expect(s.community.length).toBe(5);
  });

  it('single hand emits pot flows for showdown', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 40 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 2000 },
      ],
      cfg
    );
    s = startNewHand(s);
    s = applyAction(s, 'a', { type: ActionType.ALL_IN });
    s = applyAction(s, 'b', { type: ActionType.CALL });
    // pump streets
    while (s.phase !== GamePhase.HAND_COMPLETE) {
      for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
      s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
      s = dealNextStreet(s);
    }
    expect(s.potFlows).not.toBeNull();
    expect(s.potFlows!.length).toBeGreaterThan(0);
    const totalContribution = s.potFlows!.reduce((sum, pot) => sum + pot.contributions.reduce((k, c) => k + c.amount, 0), 0);
    const totalAward = s.potFlows!.reduce((sum, pot) => sum + pot.winners.reduce((k, w) => k + w.award, 0), 0);
    expect(totalAward).toBe(totalContribution);
  });
});
