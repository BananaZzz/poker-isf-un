import { describe, it, expect, vi } from 'vitest';
import { createInitialState, startNewHand, applyAction } from '../src/game/engine';
import { ActionType, GamePhase } from '../src/game/types';

const cfg = { smallBlind: 10, bigBlind: 20, actionTimerMs: 30000 };

describe('turn timer / actionDeadline', () => {
  it('actionDeadline is set at hand start and matches configured timer', () => {
    const t = 1_700_000_000_000;
    vi.setSystemTime(new Date(t));
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    expect(s.actionDeadline).toBe(t + cfg.actionTimerMs);
    vi.useRealTimers();
  });

  it('actionDeadline advances to a fresh window when the next player acts', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
        { id: 'c', username: 'C', avatar: 'x', seat: 2, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    const firstDeadline = s.actionDeadline!;
    // simulate 5 seconds passing
    vi.useFakeTimers();
    vi.setSystemTime(new Date(firstDeadline - cfg.actionTimerMs + 5000));
    s = applyAction(s, 'a', { type: ActionType.CALL });
    expect(s.actionDeadline).not.toBeNull();
    // next player's deadline is later than the first player's
    expect(s.actionDeadline).toBeGreaterThan(firstDeadline);
    vi.useRealTimers();
  });

  it('actionDeadline is cleared at showdown / hand complete', () => {
    let s = createInitialState(
      [
        { id: 'a', username: 'A', avatar: 'x', seat: 0, chips: 1000 },
        { id: 'b', username: 'B', avatar: 'x', seat: 1, chips: 1000 },
      ],
      cfg
    );
    s = startNewHand(s);
    // HU fold-around: SB (seat 0, dealer) folds → BB wins uncontested
    s = applyAction(s, 'a', { type: ActionType.FOLD });
    expect(s.phase).toBe(GamePhase.HAND_COMPLETE);
    expect(s.actionDeadline).toBeNull();
  });
});
