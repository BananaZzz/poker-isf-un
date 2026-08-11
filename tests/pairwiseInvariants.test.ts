import { describe, it, expect } from 'vitest';
import { attributePotFlows } from '../src/game/attribution';
import {
  createInitialState, startNewHand, applyAction, dealNextStreet,
} from '../src/game/engine';
import { ActionType, GamePhase } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

/**
 * Verifies the invariant that Σ (pairwise net) over the hand equals each
 * player's chip delta.
 */
describe('pairwise accounting invariants', () => {
  it('pairwise transfers reconcile with chip deltas in a live hand', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 200 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 200 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 200 },
      ],
      cfg
    );
    const initial = new Map(s.players.map((p) => [p.id, p.chips] as const));
    s = startNewHand(s);
    // Everyone all-in preflop
    // Preflop first-to-act = seat 0 (a). Actually in 3-handed, dealer=0 sb=1 bb=2, first=0.
    s = applyAction(s, 'a', { type: ActionType.ALL_IN });
    s = applyAction(s, 'b', { type: ActionType.ALL_IN });
    s = applyAction(s, 'c', { type: ActionType.ALL_IN });
    // Pump streets — all-in, runout pending
    while (s.phase !== GamePhase.HAND_COMPLETE) {
      for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
      s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
      s = dealNextStreet(s);
    }
    expect(s.potFlows).not.toBeNull();
    const transfers = attributePotFlows(s.potFlows!);
    const net = new Map<string, number>();
    for (const t of transfers) {
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amount);
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amount);
    }
    let totalPairwise = 0;
    let totalChipDelta = 0;
    for (const p of s.players) {
      const delta = p.chips - (initial.get(p.id) ?? 0);
      const pwn = net.get(p.id) ?? 0;
      expect(pwn).toBe(delta);
      totalPairwise += pwn;
      totalChipDelta += delta;
    }
    expect(totalPairwise).toBe(0);
    expect(totalChipDelta).toBe(0);
  });

  it('pairwise sums always net to zero across many random hands', () => {
    // simple randomized fold-round: verify invariants across a variety of endings
    for (let trial = 0; trial < 20; trial++) {
      let s = createInitialState(
        [
          { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
          { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
          { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
        ],
        cfg
      );
      const initial = new Map(s.players.map((p) => [p.id, p.chips] as const));
      s = startNewHand(s);
      // deterministic actions per trial
      const seed = trial;
      const play = (id: string) => {
        const seat = s.players.find((p) => p.id === id)!.seat;
        if (s.currentPlayerSeat !== seat) return;
        const legalActs = ['FOLD', 'CHECK', 'CALL'];
        const chosen = legalActs[(seed + id.charCodeAt(0)) % legalActs.length];
        try {
          if (chosen === 'FOLD') s = applyAction(s, id, { type: ActionType.FOLD });
          else if (chosen === 'CHECK') s = applyAction(s, id, { type: ActionType.CHECK });
          else s = applyAction(s, id, { type: ActionType.CALL });
        } catch {
          // fall back to fold
          try { s = applyAction(s, id, { type: ActionType.FOLD }); } catch { /* */ }
        }
      };
      let safety = 200;
      while (s.phase !== GamePhase.HAND_COMPLETE && safety-- > 0) {
        if (s.runoutPending) {
          for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
          s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
          s = dealNextStreet(s);
          continue;
        }
        const seat = s.currentPlayerSeat;
        if (seat === null) break;
        const p = s.players.find((x) => x.seat === seat)!;
        play(p.id);
      }
      // uncontested folds have no potFlows; skip
      const flows = s.potFlows ?? [];
      const transfers = attributePotFlows(flows);
      const net = new Map<string, number>();
      for (const t of transfers) {
        net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amount);
        net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amount);
      }
      const chipDeltaSum = s.players.reduce((sum, p) => sum + (p.chips - (initial.get(p.id) ?? 0)), 0);
      const netSum = [...net.values()].reduce((s, v) => s + v, 0);
      expect(chipDeltaSum).toBe(0);
      expect(netSum).toBe(0);
    }
  });
});
