/**
 * Regression tests for the winner-banner lifecycle.
 *
 * The Phase-2 bug: banner state was set to null by a setTimeout that could be
 * cancelled by a rerender before firing, so the banner sometimes stayed
 * visible forever. The Phase-3 fix ties the banner to the hand it was
 * produced for, and drops it synchronously when the visible hand advances
 * past the banner's hand OR the phase leaves HAND_COMPLETE/SHOWDOWN.
 *
 * We test the lifecycle predicate in isolation — the same rule the
 * `useEffect(...)` in PokerTable uses.
 */
import { describe, it, expect } from 'vitest';

function shouldClearBanner(banner: { handNumber: number } | null, currentHand: number, currentPhase: string): boolean {
  if (!banner) return false;
  if (banner.handNumber !== currentHand) return true;
  if (currentPhase !== 'HAND_COMPLETE' && currentPhase !== 'SHOWDOWN') return true;
  return false;
}

describe('winner banner lifecycle', () => {
  it('keeps the banner while phase is HAND_COMPLETE for the same hand', () => {
    expect(shouldClearBanner({ handNumber: 5 }, 5, 'HAND_COMPLETE')).toBe(false);
  });
  it('keeps the banner during the SHOWDOWN phase for the same hand', () => {
    expect(shouldClearBanner({ handNumber: 5 }, 5, 'SHOWDOWN')).toBe(false);
  });
  it('clears the banner as soon as a new hand starts', () => {
    expect(shouldClearBanner({ handNumber: 5 }, 6, 'PRE_FLOP')).toBe(true);
  });
  it('clears the banner if we leave HAND_COMPLETE mid-hand somehow', () => {
    expect(shouldClearBanner({ handNumber: 5 }, 5, 'PRE_FLOP')).toBe(true);
    expect(shouldClearBanner({ handNumber: 5 }, 5, 'FLOP')).toBe(true);
  });
  it('is a no-op when there is no banner', () => {
    expect(shouldClearBanner(null, 5, 'PRE_FLOP')).toBe(false);
  });
});
