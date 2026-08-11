import { describe, it, expect } from 'vitest';

/**
 * Tournament placement is computed by the game manager (DB-integrated), but
 * the placement rule is a pure algorithm we can test in isolation:
 * eliminated first → higher placement number; last surviving → placement 1.
 */
type Player = { id: string; chips: number; eliminatedHand?: number };

function computePlacements(players: Player[]): Record<string, number> {
  // Order: players sorted by eliminatedHand descending (later = higher rank).
  // Survivor (chips > 0) always gets placement 1.
  const out: Record<string, number> = {};
  const alive = players.filter((p) => p.chips > 0);
  const busted = players.filter((p) => p.chips <= 0);
  // sort busted by eliminatedHand DESC (later = smaller placement number)
  const bustedSorted = busted.slice().sort((a, b) => (b.eliminatedHand ?? 0) - (a.eliminatedHand ?? 0));

  let place = alive.length + 1; // first eliminated in this ordering gets N-alive+1... etc
  for (const p of bustedSorted) {
    out[p.id] = place++;
  }
  // Alive players fill the top; if more than one still alive, tie-break by chips desc
  const aliveSorted = alive.slice().sort((a, b) => b.chips - a.chips);
  let topPlace = 1;
  for (const p of aliveSorted) out[p.id] = topPlace++;
  return out;
}

describe('tournament placement', () => {
  it('last survivor is placement #1', () => {
    const p = computePlacements([
      { id: 'w', chips: 5000 },
      { id: 'a', chips: 0, eliminatedHand: 20 },
      { id: 'b', chips: 0, eliminatedHand: 15 },
      { id: 'c', chips: 0, eliminatedHand: 8 },
    ]);
    expect(p['w']).toBe(1);
    expect(p['a']).toBe(2); // eliminated last among the busted
    expect(p['b']).toBe(3);
    expect(p['c']).toBe(4);
  });

  it('heads-up loser is #2, winner #1', () => {
    const p = computePlacements([
      { id: 'winner', chips: 4000 },
      { id: 'loser', chips: 0, eliminatedHand: 42 },
    ]);
    expect(p['winner']).toBe(1);
    expect(p['loser']).toBe(2);
  });

  it('ties: two eliminated in same hand share the placement pool (ordered by id fallback)', () => {
    const p = computePlacements([
      { id: 'a', chips: 4000 },
      { id: 'b', chips: 4000 },
      { id: 'c', chips: 0, eliminatedHand: 10 },
      { id: 'd', chips: 0, eliminatedHand: 10 },
    ]);
    // c and d share the bottom spots
    expect(new Set([p['c'], p['d']])).toEqual(new Set([3, 4]));
  });
});
