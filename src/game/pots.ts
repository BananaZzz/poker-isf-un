export interface PlayerContribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

/**
 * Given each player's total contribution to the pot this hand and their fold status,
 * return the main + side pots.
 * Folded players' contributions go into the pot(s) but they cannot win.
 */
export function computePots(contribs: PlayerContribution[]): Pot[] {
  const pots: Pot[] = [];
  let remaining = contribs
    .filter((c) => c.amount > 0)
    .map((c) => ({ ...c }));

  while (remaining.length > 0) {
    const positive = remaining.filter((c) => c.amount > 0);
    if (positive.length === 0) break;
    const min = Math.min(...positive.map((c) => c.amount));
    let amount = 0;
    for (const c of remaining) {
      const take = Math.min(c.amount, min);
      amount += take;
      c.amount -= take;
    }
    // eligible = players who contributed AT this level AND haven't folded
    const eligible = positive.filter((c) => !c.folded).map((c) => c.playerId);
    if (amount > 0) {
      if (pots.length > 0 && eligible.length > 0 &&
          pots[pots.length - 1].eligiblePlayerIds.length === eligible.length &&
          pots[pots.length - 1].eligiblePlayerIds.every((id, i) => id === eligible[i])) {
        pots[pots.length - 1].amount += amount;
      } else {
        pots.push({ amount, eligiblePlayerIds: eligible });
      }
    }
    remaining = remaining.filter((c) => c.amount > 0);
  }
  return pots;
}
