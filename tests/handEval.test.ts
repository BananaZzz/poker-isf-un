import { describe, it, expect } from 'vitest';
import { evaluateBest7, compareHandRank, HandCategory } from '../src/game/handEval';
import type { Card, Rank, Suit } from '../src/game/cards';

const C = (r: Rank, s: Suit): Card => ({ rank: r, suit: s });

describe('hand evaluator', () => {
  it('detects royal flush', () => {
    const r = evaluateBest7([
      C(14, 's'), C(13, 's'), C(12, 's'), C(11, 's'), C(10, 's'),
      C(2, 'h'), C(3, 'd'),
    ]);
    expect(r.category).toBe(HandCategory.StraightFlush);
    expect(r.tiebreak[0]).toBe(14);
    expect(r.name).toBe('Royal Flush');
  });

  it('detects wheel straight (A-2-3-4-5)', () => {
    const r = evaluateBest7([
      C(14, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's'),
      C(9, 'h'), C(13, 'd'),
    ]);
    expect(r.category).toBe(HandCategory.Straight);
    expect(r.tiebreak[0]).toBe(5);
  });

  it('detects four of a kind over full house', () => {
    const quads = evaluateBest7([
      C(9, 's'), C(9, 'h'), C(9, 'd'), C(9, 'c'), C(2, 's'), C(3, 'h'), C(4, 'd'),
    ]);
    const boat = evaluateBest7([
      C(9, 's'), C(9, 'h'), C(9, 'd'), C(2, 'c'), C(2, 's'), C(3, 'h'), C(4, 'd'),
    ]);
    expect(compareHandRank(quads, boat)).toBeGreaterThan(0);
  });

  it('flush beats straight', () => {
    const flush = evaluateBest7([
      C(2, 's'), C(5, 's'), C(9, 's'), C(11, 's'), C(13, 's'), C(3, 'h'), C(4, 'd'),
    ]);
    const straight = evaluateBest7([
      C(6, 's'), C(7, 'h'), C(8, 'd'), C(9, 'c'), C(10, 's'), C(2, 'h'), C(3, 'd'),
    ]);
    expect(flush.category).toBe(HandCategory.Flush);
    expect(compareHandRank(flush, straight)).toBeGreaterThan(0);
  });

  it('compares kickers correctly', () => {
    const a = evaluateBest7([
      C(14, 's'), C(14, 'h'), C(13, 'd'), C(7, 'c'), C(2, 's'), C(5, 'h'), C(3, 'd'),
    ]);
    const b = evaluateBest7([
      C(14, 'd'), C(14, 'c'), C(12, 'd'), C(7, 'h'), C(2, 'c'), C(5, 's'), C(3, 'h'),
    ]);
    expect(compareHandRank(a, b)).toBeGreaterThan(0);
  });

  it('ties give 0', () => {
    const a = evaluateBest7([
      C(14, 's'), C(14, 'h'), C(13, 'd'), C(7, 'c'), C(2, 's'), C(5, 'h'), C(3, 'd'),
    ]);
    const b = evaluateBest7([
      C(14, 'd'), C(14, 'c'), C(13, 's'), C(7, 'h'), C(2, 'c'), C(5, 's'), C(3, 'h'),
    ]);
    expect(compareHandRank(a, b)).toBe(0);
  });
});
