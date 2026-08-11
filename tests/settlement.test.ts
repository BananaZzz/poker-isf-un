import { describe, it, expect } from 'vitest';
import { computeSettlement, type Obligation } from '../src/lib/settlement';

function sumBy<T>(arr: T[], f: (t: T) => number) { return arr.reduce((s, x) => s + f(x), 0); }
function outFrom(ob: Obligation[], user: string) { return sumBy(ob.filter((o) => o.debtorUserId === user), (o) => o.amountCents); }
function inTo(ob: Obligation[], user: string) { return sumBy(ob.filter((o) => o.creditorUserId === user), (o) => o.amountCents); }

describe('settlement algorithm', () => {
  it('example from spec: A +1420, B -740, C -680 → B→A 740, C→A 680', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 1420 },
      { userId: 'B', netCents: -740 },
      { userId: 'C', netCents: -680 },
    ]);
    expect(ob).toHaveLength(2);
    expect(ob).toEqual(expect.arrayContaining([
      expect.objectContaining({ debtorUserId: 'B', creditorUserId: 'A', amountCents: 740 }),
      expect.objectContaining({ debtorUserId: 'C', creditorUserId: 'A', amountCents: 680 }),
    ]));
  });

  it('two creditors, two debtors: A +10 B +4 C -6 D -8', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 10 },
      { userId: 'B', netCents: 4 },
      { userId: 'C', netCents: -6 },
      { userId: 'D', netCents: -8 },
    ]);
    // largest-first pairs: D-A(8), C-A(2), C-B(4)
    expect(ob).toEqual(expect.arrayContaining([
      { debtorUserId: 'D', creditorUserId: 'A', amountCents: 8 },
      { debtorUserId: 'C', creditorUserId: 'A', amountCents: 2 },
      { debtorUserId: 'C', creditorUserId: 'B', amountCents: 4 },
    ]));
    expect(ob).toHaveLength(3);
  });

  it('exact split: A +5 B +5 C -10', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 5 },
      { userId: 'B', netCents: 5 },
      { userId: 'C', netCents: -10 },
    ]);
    expect(sumBy(ob, (o) => o.amountCents)).toBe(10);
    expect(inTo(ob, 'A')).toBe(5);
    expect(inTo(ob, 'B')).toBe(5);
    expect(outFrom(ob, 'C')).toBe(10);
  });

  it('multiple debtors: A +10 B -4 C -3 D -3', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 10 },
      { userId: 'B', netCents: -4 },
      { userId: 'C', netCents: -3 },
      { userId: 'D', netCents: -3 },
    ]);
    expect(sumBy(ob, (o) => o.amountCents)).toBe(10);
    expect(inTo(ob, 'A')).toBe(10);
    expect(outFrom(ob, 'B') + outFrom(ob, 'C') + outFrom(ob, 'D')).toBe(10);
  });

  it('rebuy included via net result: A invested 40 finished 31 → net -9', () => {
    // A -9 (invested 4000 cent, final 3100 → -900), B +9
    const ob = computeSettlement([
      { userId: 'A', netCents: -900 },
      { userId: 'B', netCents:  900 },
    ]);
    expect(ob).toEqual([{ debtorUserId: 'A', creditorUserId: 'B', amountCents: 900 }]);
  });

  it('zero result creates no obligation for that player', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 100 },
      { userId: 'B', netCents: 0 },
      { userId: 'C', netCents: -100 },
    ]);
    expect(ob).toEqual([{ debtorUserId: 'C', creditorUserId: 'A', amountCents: 100 }]);
    expect(ob.some((o) => o.debtorUserId === 'B' || o.creditorUserId === 'B')).toBe(false);
  });

  it('nobody won or lost → no obligations', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents: 0 },
      { userId: 'B', netCents: 0 },
    ]);
    expect(ob).toEqual([]);
  });

  it('no self-obligation, no non-positive amount', () => {
    const ob = computeSettlement([
      { userId: 'A', netCents:  100 },
      { userId: 'B', netCents: -100 },
    ]);
    for (const o of ob) {
      expect(o.debtorUserId).not.toBe(o.creditorUserId);
      expect(o.amountCents).toBeGreaterThan(0);
    }
  });

  it('deterministic ordering: same input → identical output on repeat', () => {
    const nets = [
      { userId: 'X', netCents: 500 },
      { userId: 'Y', netCents: 500 },
      { userId: 'A', netCents: -400 },
      { userId: 'B', netCents: -400 },
      { userId: 'C', netCents: -200 },
    ];
    const a = computeSettlement(nets);
    const b = computeSettlement(nets);
    expect(a).toEqual(b);
  });

  it('invariants hold: Σ obligations == total positive session result', () => {
    const nets = [
      { userId: 'A', netCents: 1234 },
      { userId: 'B', netCents: -567 },
      { userId: 'C', netCents: -667 },
    ];
    const ob = computeSettlement(nets);
    const totalOb = sumBy(ob, (o) => o.amountCents);
    const totalPositive = sumBy(nets.filter((n) => n.netCents > 0), (n) => n.netCents);
    expect(totalOb).toBe(totalPositive);
    for (const n of nets) {
      if (n.netCents > 0) expect(inTo(ob, n.userId)).toBe(n.netCents);
      else if (n.netCents < 0) expect(outFrom(ob, n.userId)).toBe(-n.netCents);
    }
  });

  it('4-player example from README: A+10 B+4 C-6 D-8 balances to zero', () => {
    const nets = [
      { userId: 'A', netCents: 10 },
      { userId: 'B', netCents: 4 },
      { userId: 'C', netCents: -6 },
      { userId: 'D', netCents: -8 },
    ];
    const ob = computeSettlement(nets);
    // Everyone's balance is zero after applying obligations
    const bal = new Map(nets.map((n) => [n.userId, n.netCents]));
    for (const o of ob) {
      bal.set(o.debtorUserId, (bal.get(o.debtorUserId) ?? 0) + o.amountCents);
      bal.set(o.creditorUserId, (bal.get(o.creditorUserId) ?? 0) - o.amountCents);
    }
    for (const v of bal.values()) expect(v).toBe(0);
  });
});
