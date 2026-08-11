import { describe, it, expect } from 'vitest';
import { createInitialState, startNewHand, redactStateFor } from '../src/game/engine';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

describe('card visibility security', () => {
  it("redactStateFor strips opponents' hole cards before showdown", () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    const view = redactStateFor(s, 'a');
    // A can see their own cards; B and C cards are empty in the redacted view
    expect(view.players.find((p) => p.id === 'a')!.holeCards.length).toBe(2);
    expect(view.players.find((p) => p.id === 'b')!.holeCards.length).toBe(0);
    expect(view.players.find((p) => p.id === 'c')!.holeCards.length).toBe(0);
    // deck must NEVER go to the client
    expect(view.deck.length).toBe(0);
  });

  it('anonymous viewer sees no hole cards and no deck', () => {
    let s = createInitialState(
      [{ id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
       { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 }],
      cfg
    );
    s = startNewHand(s);
    const view = redactStateFor(s, null);
    for (const p of view.players) expect(p.holeCards.length).toBe(0);
    expect(view.deck.length).toBe(0);
  });
});
