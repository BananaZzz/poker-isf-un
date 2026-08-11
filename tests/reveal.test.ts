import { describe, it, expect } from 'vitest';
import {
  createInitialState, startNewHand, applyAction, dealNextStreet, redactStateFor,
} from '../src/game/engine';
import { ActionType, GamePhase } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

/**
 * A hand ends UNCONTESTED when the winner takes the pot because everyone
 * else folded. In that case:
 *   - mandatoryShowdown is false
 *   - the winner's hole cards are HIDDEN from opponents by default
 *   - the winner may add themselves to state.voluntaryReveals to flip them
 */
describe('voluntary reveal after uncontested win', () => {
  function seatFold3(): any {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    // UTG a folds, sb b folds → c (bb) wins uncontested
    s = applyAction(s, 'a', { type: ActionType.FOLD });
    s = applyAction(s, 'b', { type: ActionType.FOLD });
    return s;
  }

  it('uncontested win sets mandatoryShowdown = false and empty voluntaryReveals', () => {
    const s = seatFold3();
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    expect(s.mandatoryShowdown).toBe(false);
    expect(s.voluntaryReveals).toEqual([]);
  });

  it('winner cards are hidden from opponents by default', () => {
    const s = seatFold3();
    const asA = redactStateFor(s, 'a');
    const asB = redactStateFor(s, 'b');
    const cInA = asA.players.find((p) => p.id === 'c')!;
    const cInB = asB.players.find((p) => p.id === 'c')!;
    expect(cInA.holeCards.length).toBe(0); // A cannot see C's cards
    expect(cInB.holeCards.length).toBe(0); // B cannot see C's cards either

  });

  it('after voluntary reveal, ALL viewers can see the winner cards', () => {
    const s = seatFold3();
    s.voluntaryReveals = ['c'];
    const asA = redactStateFor(s, 'a');
    const asB = redactStateFor(s, 'b');
    const asC = redactStateFor(s, 'c');
    expect(asA.players.find((p) => p.id === 'c')!.holeCards.length).toBe(2);
    expect(asB.players.find((p) => p.id === 'c')!.holeCards.length).toBe(2);
    expect(asC.players.find((p) => p.id === 'c')!.holeCards.length).toBe(2);
  });

  it('viewer always sees their own cards regardless of reveal', () => {
    const s = seatFold3();
    const asC = redactStateFor(s, 'c');
    expect(asC.players.find((p) => p.id === 'c')!.holeCards.length).toBe(2);
  });

  it('voluntary reveal cannot expose a different player\'s cards', () => {
    // Even if the state accidentally listed A in voluntaryReveals, A folded
    // (holeCards preserved in state). Redaction still exposes A because we
    // trust state.voluntaryReveals — so the game-manager guard is what
    // prevents cross-player reveals. Verify that a non-listed player stays hidden.
    const s = seatFold3();
    s.voluntaryReveals = ['c']; // only C explicitly reveals
    const asA = redactStateFor(s, 'a');
    expect(asA.players.find((p) => p.id === 'b')!.holeCards.length).toBe(0);
  });
});

describe('mandatory-showdown reveal is unchanged', () => {
  it('multi-player runout to showdown exposes all non-folded contenders', () => {
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
    while (s.phase !== GamePhase.HAND_COMPLETE) {
      for (const p of s.players) { p.currentBet = 0; p.hasActedThisRound = false; }
      s.currentBet = 0; s.minRaise = s.bigBlind; s.lastRaiseAmount = s.bigBlind; s.lastAggressorSeat = null;
      s = dealNextStreet(s);
    }
    expect(s.mandatoryShowdown).toBe(true);
    const asA = redactStateFor(s, 'a');
    // Both players' cards visible without any voluntary reveal
    expect(asA.players.find((p) => p.id === 'b')!.holeCards.length).toBe(2);
  });
});
