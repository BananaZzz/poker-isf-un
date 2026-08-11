import type { Card, Rank } from './cards';

export enum HandCategory {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
}

export interface HandRank {
  category: HandCategory;
  // tiebreaker vector, higher-is-better, lex-compared
  tiebreak: number[];
  name: string;
  cards: Card[]; // the 5 cards that make the hand
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, combo: T[]) => {
    if (combo.length === k) {
      out.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  };
  rec(0, []);
  return out;
}

function rank5(cards: Card[]): HandRank {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  const rankCount = new Map<Rank, number>();
  for (const r of ranks) rankCount.set(r, (rankCount.get(r) ?? 0) + 1);

  const groups = [...rankCount.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = suits.every((s) => s === suits[0]);

  // Straight detection (including wheel A-2-3-4-5)
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh: number | null = null;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      straightHigh = 5; // wheel
    }
  }

  if (straightHigh !== null && isFlush) {
    return {
      category: HandCategory.StraightFlush,
      tiebreak: [straightHigh],
      name: straightHigh === 14 ? 'Royal Flush' : 'Straight Flush',
      cards,
    };
  }
  if (groups[0][1] === 4) {
    const four = groups[0][0];
    const kicker = groups[1][0];
    return {
      category: HandCategory.FourOfAKind,
      tiebreak: [four, kicker],
      name: 'Four of a Kind',
      cards,
    };
  }
  if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
    return {
      category: HandCategory.FullHouse,
      tiebreak: [groups[0][0], groups[1][0]],
      name: 'Full House',
      cards,
    };
  }
  if (isFlush) {
    return {
      category: HandCategory.Flush,
      tiebreak: ranks,
      name: 'Flush',
      cards,
    };
  }
  if (straightHigh !== null) {
    return {
      category: HandCategory.Straight,
      tiebreak: [straightHigh],
      name: 'Straight',
      cards,
    };
  }
  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return {
      category: HandCategory.ThreeOfAKind,
      tiebreak: [trips, ...kickers],
      name: 'Three of a Kind',
      cards,
    };
  }
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const [hi, lo] = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups[2][0];
    return {
      category: HandCategory.TwoPair,
      tiebreak: [hi, lo, kicker],
      name: 'Two Pair',
      cards,
    };
  }
  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return {
      category: HandCategory.OnePair,
      tiebreak: [pair, ...kickers],
      name: 'One Pair',
      cards,
    };
  }
  return {
    category: HandCategory.HighCard,
    tiebreak: ranks,
    name: 'High Card',
    cards,
  };
}

export function compareHandRank(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function evaluateBest7(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  if (cards.length === 5) return rank5(cards);
  const combos = combinations(cards, 5);
  let best = rank5(combos[0]);
  for (let i = 1; i < combos.length; i++) {
    const r = rank5(combos[i]);
    if (compareHandRank(r, best) > 0) best = r;
  }
  return best;
}
