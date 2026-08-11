import { describe, it, expect } from 'vitest';
import { computePots } from '../src/game/pots';

describe('side pots', () => {
  it('single pot when everyone puts equal', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ]);
    expect(pots.length).toBe(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds).toEqual(['a', 'b', 'c']);
  });

  it('three-way all-in with different stacks', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 500, folded: false },
      { playerId: 'c', amount: 1000, folded: false },
    ]);
    expect(pots.length).toBe(3);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds).toEqual(['a', 'b', 'c']);
    expect(pots[1].amount).toBe(800);
    expect(pots[1].eligiblePlayerIds).toEqual(['b', 'c']);
    expect(pots[2].amount).toBe(500);
    expect(pots[2].eligiblePlayerIds).toEqual(['c']);
  });

  it('folded player contributes to pot but cannot win', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: true },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ]);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds).toEqual(['b', 'c']);
  });
});
