import type { PotFlow } from './types';

export interface PairwiseTransfer {
  fromUserId: string;
  toUserId: string;
  amount: number; // integer cents; always positive
  potIndex: number;
}

/**
 * Convert a set of PotFlow records for a single hand into per-pair transfers.
 *
 * Algorithm (deterministic proportional attribution):
 *   For each pot:
 *     - winners W ⊆ contributors, each awarded `award_Wk`.
 *     - losers L = contributors \ W, each with contribution `contL_j` to THIS pot slice.
 *     - Each loser's contribution to the pot is distributed among winners in
 *       proportion to that winner's award: transfer(Lj → Wk) = contL_j * (award_Wk / potAmount).
 *     - Winners' own contributions do NOT transfer to themselves.
 *
 *   Properties (verified in tests):
 *     - Σ over pot of transfers into Wk == award_Wk - contW_k (Wk's net profit from this pot).
 *     - Σ over pot of transfers out of Lj == contL_j (loser fully attributed).
 *     - Σ pairwise net == 0 across the hand (cent-level rounding aside).
 *
 * Odd cents from rational rounding are assigned to the highest-award winner
 * deterministically, and any leftover to the last loser encountered — the sum
 * of transfers always equals the total non-winner contribution.
 */
export function attributePotFlows(flows: PotFlow[]): PairwiseTransfer[] {
  const out: PairwiseTransfer[] = [];
  for (const pot of flows) {
    const winnerIds = new Set(pot.winners.map((w) => w.playerId));
    const losers = pot.contributions.filter((c) => !winnerIds.has(c.playerId) && c.amount > 0);
    if (losers.length === 0) continue; // nothing to attribute (winners just get own money back)
    if (pot.winners.length === 0) continue; // shouldn't happen
    // Sort winners deterministically (descending award, then id) so odd cent goes to the biggest
    const winners = pot.winners.slice().sort((a, b) => b.award - a.award || a.playerId.localeCompare(b.playerId));

    for (const loser of losers) {
      let remaining = loser.amount;
      const potAmount = pot.potAmount;
      // Compute each winner's share of THIS loser's contribution
      const raws = winners.map((w) => ({
        winnerId: w.playerId,
        raw: (loser.amount * w.award) / potAmount,
      }));
      // Round-down + track leftover; final leftover goes to the highest-award winner
      const rounded = raws.map((r) => ({ ...r, floor: Math.floor(r.raw) }));
      let allocated = rounded.reduce((s, r) => s + r.floor, 0);
      const leftover = loser.amount - allocated;
      // hand leftover cents to top winners in order
      let idx = 0;
      const shares = rounded.map((r) => r.floor);
      for (let k = 0; k < leftover; k++) {
        shares[idx % shares.length] += 1;
        idx++;
      }
      for (let i = 0; i < winners.length; i++) {
        const amount = shares[i];
        if (amount > 0) {
          out.push({
            fromUserId: loser.playerId,
            toUserId: winners[i].playerId,
            amount,
            potIndex: pot.potIndex,
          });
          remaining -= amount;
        }
      }
      // safety: `remaining` must be 0 by construction
      if (remaining !== 0) {
        // shouldn't happen; keep defensive path
        out.push({
          fromUserId: loser.playerId,
          toUserId: winners[0].playerId,
          amount: remaining,
          potIndex: pot.potIndex,
        });
      }
    }
  }
  return out;
}
