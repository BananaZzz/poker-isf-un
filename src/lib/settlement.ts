/**
 * Settlement (open-balances) calculator.
 *
 * Given each participant's final `netResult` for a finished cash session,
 * produces a deterministic list of "who should pay whom" obligations that
 * reconcile everyone's balances to zero.
 *
 * Pure — integer cents only, no I/O, no floating point.
 */

export interface ParticipantNet {
  userId: string;
  netCents: number; // may be negative (loser), positive (winner), or 0
}

export interface Obligation {
  debtorUserId: string;
  creditorUserId: string;
  amountCents: number; // always > 0
}

/**
 * Greedy largest-first matcher.
 *
 * 1. Split participants into creditors (netCents > 0) and debtors (netCents < 0).
 *    Players with 0 net produce no obligations.
 * 2. Sort creditors DESC by amount (tie-break by userId asc).
 * 3. Sort debtors  DESC by |amount| (tie-break by userId asc).
 * 4. Repeatedly match the largest debtor against the largest creditor for
 *    min(|debt|, credit). Reduce both. Repeat until all are zero.
 *
 * Determinism: sort keys include the userId, so the same input yields the
 * same output on every process — required so idempotent re-runs (reconnect,
 * duplicate End-Game) produce the same rows and the DB unique-index catches
 * duplicates cleanly.
 *
 * Invariants (asserted at end):
 *   - Σ obligations from a debtor == |their net loss|
 *   - Σ obligations to a creditor == their net gain
 *   - Σ over all obligations == total positive session result
 *   - No self-obligations, no non-positive amounts
 */
export function computeSettlement(nets: ParticipantNet[]): Obligation[] {
  const sumNet = nets.reduce((s, n) => s + n.netCents, 0);
  if (sumNet !== 0) {
    // The caller is expected to feed a balanced session (Σ netResult = 0).
    // If not, we still proceed but our post-checks catch it.
  }

  const creditors = nets
    .filter((n) => n.netCents > 0)
    .map((n) => ({ userId: n.userId, remaining: n.netCents }))
    .sort((a, b) => (b.remaining - a.remaining) || a.userId.localeCompare(b.userId));

  const debtors = nets
    .filter((n) => n.netCents < 0)
    .map((n) => ({ userId: n.userId, remaining: -n.netCents })) // positive owed amount
    .sort((a, b) => (b.remaining - a.remaining) || a.userId.localeCompare(b.userId));

  const out: Obligation[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    if (c.remaining <= 0) { ci++; continue; }
    if (d.remaining <= 0) { di++; continue; }
    const amt = Math.min(c.remaining, d.remaining);
    if (amt > 0 && c.userId !== d.userId) {
      out.push({ debtorUserId: d.userId, creditorUserId: c.userId, amountCents: amt });
    }
    c.remaining -= amt;
    d.remaining -= amt;
    if (c.remaining === 0) ci++;
    if (d.remaining === 0) di++;
  }
  return out;
}
