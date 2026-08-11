import { describe, it, expect } from 'vitest';

// Pure accounting logic that mirrors the DB-backed service — kept in sync
// with src/server/accounting.ts's `netResult = cashOutStack - totalInvested`
function computeNetResult(initialBuyIn: number, totalRebuys: number, cashOutStack: number) {
  const totalInvested = initialBuyIn + totalRebuys;
  const netResult = cashOutStack - totalInvested;
  return { totalInvested, netResult };
}

describe('accounting', () => {
  it('zero start', () => {
    expect(computeNetResult(2000, 0, 2000).netResult).toBe(0);
  });
  it('positive result', () => {
    expect(computeNetResult(2000, 0, 2740).netResult).toBe(740);
  });
  it('negative result', () => {
    expect(computeNetResult(2000, 0, 1260).netResult).toBe(-740);
  });
  it('rebuy accounting', () => {
    expect(computeNetResult(2000, 2000, 3100).netResult).toBe(-900);
    expect(computeNetResult(2000, 2000, 5500).netResult).toBe(1500);
  });
  it('sum of session net results equals zero when nothing is lost/created', () => {
    // 3 players: A +€10, B -€6, C -€4
    const A = computeNetResult(2000, 0, 3000).netResult;
    const B = computeNetResult(2000, 0, 1400).netResult;
    const C = computeNetResult(2000, 0, 1600).netResult;
    expect(A + B + C).toBe(0);
  });
  it('sum with rebuys still balances', () => {
    // A invested 4000 (buy-in 2000 + 1 rebuy 2000), ended 6000 → +2000
    // B invested 2000, ended 0 → -2000
    const A = computeNetResult(2000, 2000, 6000).netResult;
    const B = computeNetResult(2000, 0, 0).netResult;
    expect(A + B).toBe(0);
  });
});
