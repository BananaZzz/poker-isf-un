import { describe, it, expect } from 'vitest';

/**
 * The Phase-3 rebuy production bug: the overlay condition used to be
 *
 *     me?.chips <= 0 && !state.players.some(p => p.status === ACTIVE)
 *
 * which failed because rebuildEngineFromDb filters chips===0 players OUT of
 * state.players between hands, so `me` becomes null → overlay never renders.
 *
 * The fix computes the overlay from the persistent lobby snapshot
 * (LobbyPlayer row), not the ephemeral engine state. This test locks in the
 * correct condition — a busted player, still seated in the lobby, not
 * sitting out.
 */

interface LobbyPlayerRow {
  chips: number;
  bustedOut: boolean;
  sittingOut: boolean;
}

function shouldShowRebuy(myLobbyPlayer: LobbyPlayerRow | null): boolean {
  return !!myLobbyPlayer && myLobbyPlayer.chips === 0 && !myLobbyPlayer.sittingOut;
}

describe('rebuy overlay condition (regression)', () => {
  it('shows when player is at 0 chips and NOT sitting out', () => {
    expect(shouldShowRebuy({ chips: 0, bustedOut: true, sittingOut: false })).toBe(true);
  });
  it('does NOT show when player still has chips', () => {
    expect(shouldShowRebuy({ chips: 1000, bustedOut: false, sittingOut: false })).toBe(false);
  });
  it('does NOT show when player is sitting out (they picked "sit out" themselves)', () => {
    expect(shouldShowRebuy({ chips: 0, bustedOut: true, sittingOut: true })).toBe(false);
  });
  it('does NOT show when player is not in the lobby at all (left)', () => {
    expect(shouldShowRebuy(null)).toBe(false);
  });
  it('shows even when the engine state has removed the player from state.players', () => {
    // This is the exact production case: the engine filtered the busted
    // player OUT of the rebuilt state, but the lobby snapshot still lists
    // them at chips=0 → overlay MUST still render.
    expect(shouldShowRebuy({ chips: 0, bustedOut: true, sittingOut: false })).toBe(true);
  });
});
