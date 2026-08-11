import { describe, it, expect } from 'vitest';
import { buildDeck, shuffle } from '../src/game/cards';

describe('deck', () => {
  it('has 52 unique cards', () => {
    const d = buildDeck();
    expect(d.length).toBe(52);
    const keys = new Set(d.map((c) => `${c.rank}${c.suit}`));
    expect(keys.size).toBe(52);
  });
  it('shuffle preserves cards', () => {
    const d = buildDeck();
    const s = shuffle(d);
    expect(s.length).toBe(52);
    const keys = new Set(s.map((c) => `${c.rank}${c.suit}`));
    expect(keys.size).toBe(52);
  });
});
