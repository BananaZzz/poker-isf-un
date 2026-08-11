import { describe, it, expect } from 'vitest';

/**
 * Profile-visibility rules, mirrored as a pure predicate so tests don't
 * need Prisma. The real page enforces the same rules via its DB queries
 * (WHERE clauses scoped to viewer + profile only).
 */

interface Obligation {
  debtorUserId: string;
  creditorUserId: string;
}

/** Given a viewer, a profile owner, and the world's obligations, return
 *  which ones may be shown on the profile page's "Between you and X" panel. */
function visibleOnProfile(viewer: string, profile: string, all: Obligation[]): Obligation[] {
  if (viewer === profile) return all.filter((o) => o.debtorUserId === viewer || o.creditorUserId === viewer);
  return all.filter(
    (o) =>
      (o.debtorUserId === viewer && o.creditorUserId === profile) ||
      (o.debtorUserId === profile && o.creditorUserId === viewer)
  );
}

const world: Obligation[] = [
  { debtorUserId: 'V', creditorUserId: 'P' },   // viewer owes profile
  { debtorUserId: 'P', creditorUserId: 'V' },   // profile owes viewer
  { debtorUserId: 'V', creditorUserId: 'X' },   // viewer owes third party — private on P's page
  { debtorUserId: 'P', creditorUserId: 'Y' },   // profile owes third party — must NOT leak
  { debtorUserId: 'Y', creditorUserId: 'P' },   // third party owes profile — must NOT leak
];

describe('profile settlement visibility', () => {
  it('shows only obligations that involve both viewer and profile', () => {
    const shown = visibleOnProfile('V', 'P', world);
    expect(shown).toHaveLength(2);
    expect(shown).toEqual(expect.arrayContaining([
      { debtorUserId: 'V', creditorUserId: 'P' },
      { debtorUserId: 'P', creditorUserId: 'V' },
    ]));
  });
  it('hides profile-owner debts to unrelated third parties', () => {
    const shown = visibleOnProfile('V', 'P', world);
    for (const o of shown) {
      expect(o.debtorUserId === 'V' || o.debtorUserId === 'P').toBe(true);
      expect(o.creditorUserId === 'V' || o.creditorUserId === 'P').toBe(true);
    }
  });
  it('own profile shows all my obligations', () => {
    const shown = visibleOnProfile('V', 'V', world);
    // 3 rows involve V
    expect(shown).toHaveLength(3);
  });
});
