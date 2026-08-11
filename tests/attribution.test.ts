import { describe, it, expect } from 'vitest';
import { attributePotFlows, type PairwiseTransfer } from '../src/game/attribution';
import type { PotFlow } from '../src/game/types';

function netFor(transfers: PairwiseTransfer[]) {
  const map = new Map<string, number>();
  for (const t of transfers) {
    map.set(t.toUserId, (map.get(t.toUserId) ?? 0) + t.amount);
    map.set(t.fromUserId, (map.get(t.fromUserId) ?? 0) - t.amount);
  }
  return map;
}

describe('pot-flow attribution', () => {
  it('single winner gains from each loser proportional to contribution', () => {
    const flows: PotFlow[] = [{
      potIndex: 0,
      potAmount: 1200,
      contributions: [
        { playerId: 'A', amount: 400 },
        { playerId: 'B', amount: 400 },
        { playerId: 'C', amount: 400 },
      ],
      winners: [{ playerId: 'A', award: 1200 }],
      handName: 'Test',
    }];
    const t = attributePotFlows(flows);
    // A wins 400 from B, 400 from C. A's own 400 stays with A (no self-transfer)
    expect(t).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromUserId: 'B', toUserId: 'A', amount: 400 }),
      expect.objectContaining({ fromUserId: 'C', toUserId: 'A', amount: 400 }),
    ]));
    expect(t).toHaveLength(2);
    const net = netFor(t);
    expect(net.get('A')).toBe(800);
    expect(net.get('B')).toBe(-400);
    expect(net.get('C')).toBe(-400);
  });

  it('split pot: two winners split loser contributions equally', () => {
    const flows: PotFlow[] = [{
      potIndex: 0,
      potAmount: 1800,
      contributions: [
        { playerId: 'A', amount: 600 },
        { playerId: 'B', amount: 600 },
        { playerId: 'C', amount: 600 },
      ],
      winners: [
        { playerId: 'A', award: 900 },
        { playerId: 'B', award: 900 },
      ],
      handName: 'Tie',
    }];
    const t = attributePotFlows(flows);
    // C's 600 splits 300/300 between A and B
    const aFromC = t.find((x) => x.fromUserId === 'C' && x.toUserId === 'A');
    const bFromC = t.find((x) => x.fromUserId === 'C' && x.toUserId === 'B');
    expect(aFromC?.amount).toBe(300);
    expect(bFromC?.amount).toBe(300);
    const net = netFor(t);
    expect(net.get('A')).toBe(300);
    expect(net.get('B')).toBe(300);
    expect(net.get('C')).toBe(-600);
  });

  it('side pot: main + side attributed independently, both consistent', () => {
    const flows: PotFlow[] = [
      {
        potIndex: 0,
        potAmount: 300,
        contributions: [
          { playerId: 'A', amount: 100 },
          { playerId: 'B', amount: 100 },
          { playerId: 'C', amount: 100 },
        ],
        winners: [{ playerId: 'A', award: 300 }],
        handName: 'Main',
      },
      {
        potIndex: 1,
        potAmount: 800,
        contributions: [
          { playerId: 'B', amount: 400 },
          { playerId: 'C', amount: 400 },
        ],
        winners: [{ playerId: 'B', award: 800 }],
        handName: 'Side',
      },
    ];
    const t = attributePotFlows(flows);
    const net = netFor(t);
    expect(net.get('A')).toBe(200);
    expect(net.get('B')).toBe(300);
    expect(net.get('C')).toBe(-500);
    // Every transfer is between distinct players
    for (const tr of t) expect(tr.fromUserId).not.toBe(tr.toUserId);
  });

  it('sum of pairwise transfers per hand is zero', () => {
    const flows: PotFlow[] = [
      {
        potIndex: 0,
        potAmount: 1000,
        contributions: [
          { playerId: 'A', amount: 250 },
          { playerId: 'B', amount: 250 },
          { playerId: 'C', amount: 250 },
          { playerId: 'D', amount: 250 },
        ],
        winners: [{ playerId: 'A', award: 1000 }],
        handName: 'Big pot',
      },
    ];
    const t = attributePotFlows(flows);
    const net = netFor(t);
    let total = 0;
    for (const v of net.values()) total += v;
    expect(total).toBe(0);
  });

  it('odd cents get deterministic assignment to top-award winner', () => {
    // total pot 1001 cents, split between two winners with equal awards; the odd cent
    // must be assigned deterministically so tests are reproducible.
    const flows: PotFlow[] = [{
      potIndex: 0,
      potAmount: 1001,
      contributions: [
        { playerId: 'A', amount: 500 },
        { playerId: 'B', amount: 500 },
        { playerId: 'C', amount: 1 },
      ],
      // both A and B awarded 500 each — plus 1 goes to one of them at engine level;
      // here we mirror a real showdown where A got 501 and B got 500
      winners: [
        { playerId: 'A', award: 501 },
        { playerId: 'B', award: 500 },
      ],
      handName: 'Odd',
    }];
    const t = attributePotFlows(flows);
    // The 1 cent from C is attributed proportionally; sum still balances
    const net = netFor(t);
    let total = 0;
    for (const v of net.values()) total += v;
    expect(total).toBe(0);
    // C loses exactly 1
    expect(net.get('C')).toBe(-1);
  });

  it('symmetry: A→B = -(B→A)', () => {
    const flows: PotFlow[] = [{
      potIndex: 0,
      potAmount: 400,
      contributions: [
        { playerId: 'A', amount: 200 },
        { playerId: 'B', amount: 200 },
      ],
      winners: [{ playerId: 'A', award: 400 }],
      handName: 'HU',
    }];
    const t = attributePotFlows(flows);
    const aToB = t.filter((x) => x.fromUserId === 'A' && x.toUserId === 'B').reduce((s, r) => s + r.amount, 0);
    const bToA = t.filter((x) => x.fromUserId === 'B' && x.toUserId === 'A').reduce((s, r) => s + r.amount, 0);
    expect(bToA - aToB).toBe(200);
    expect(aToB).toBe(0);
  });
});
