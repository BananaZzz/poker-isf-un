import { describe, it, expect } from 'vitest';

/**
 * The game manager guards against double-crediting via:
 *   - room.finalizedUsers: never runs finalizePlayer twice for a user in one session
 *   - room.persistedHands: never writes HandTransfer / handsPlayed++ twice for a hand
 *   - rebuyLocks debounce: identical rebuy events within 1500ms collapse
 * We test the *rules* in isolation (pure) so the DB layer stays out of unit tests.
 */

function guardOnce<T>(seen: Set<string>, key: string, fn: () => T): T | null {
  if (seen.has(key)) return null;
  seen.add(key);
  return fn();
}

describe('idempotency guards', () => {
  it('finalizePlayer guard triggers only on first call per user', () => {
    const seen = new Set<string>();
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      guardOnce(seen, 'user-A', () => { hits++; });
    }
    expect(hits).toBe(1);
  });

  it('per-hand persistence guard triggers only once', () => {
    const seen = new Set<string>();
    let hands = 0;
    for (let i = 0; i < 5; i++) guardOnce(seen, 'hand-3', () => { hands++; });
    for (let i = 0; i < 5; i++) guardOnce(seen, 'hand-4', () => { hands++; });
    expect(hands).toBe(2);
  });

  it('rebuy debounce window blocks duplicates within N ms', () => {
    const locks = new Map<string, number>();
    const attempt = (key: string, now: number, windowMs = 1500): boolean => {
      const last = locks.get(key);
      if (last !== undefined && now - last < windowMs) return false;
      locks.set(key, now);
      return true;
    };
    expect(attempt('u:A', 1000)).toBe(true);
    expect(attempt('u:A', 1100)).toBe(false); // duplicate rapid click
    expect(attempt('u:A', 2600)).toBe(true);  // >1.5s later
  });
});
