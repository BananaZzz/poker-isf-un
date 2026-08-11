import { describe, it, expect } from 'vitest';

/**
 * Pure predicates that mirror the connection API's authorization/state rules.
 * Real DB integration lives in the /api/connections routes.
 */

type Row = { requesterId: string; recipientId: string; status: 'PENDING' | 'ACCEPTED' };

function computeState(viewer: string, target: string, rows: Row[]) {
  if (viewer === target) return { state: 'SELF' as const };
  const accepted = rows.find((r) => r.status === 'ACCEPTED');
  if (accepted) return { state: 'CONNECTED' as const };
  const out = rows.find((r) => r.requesterId === viewer && r.status === 'PENDING');
  if (out) return { state: 'PENDING_SENT' as const };
  const inb = rows.find((r) => r.recipientId === viewer && r.status === 'PENDING');
  if (inb) return { state: 'PENDING_RECEIVED' as const };
  return { state: 'NONE' as const };
}

describe('connection state', () => {
  it('SELF when viewer === target', () => {
    expect(computeState('A', 'A', []).state).toBe('SELF');
  });
  it('NONE by default', () => {
    expect(computeState('A', 'B', []).state).toBe('NONE');
  });
  it('PENDING_SENT when viewer requested target', () => {
    expect(computeState('A', 'B', [{ requesterId: 'A', recipientId: 'B', status: 'PENDING' }]).state).toBe('PENDING_SENT');
  });
  it('PENDING_RECEIVED when target requested viewer', () => {
    expect(computeState('A', 'B', [{ requesterId: 'B', recipientId: 'A', status: 'PENDING' }]).state).toBe('PENDING_RECEIVED');
  });
  it('CONNECTED for either-direction ACCEPTED row', () => {
    expect(computeState('A', 'B', [{ requesterId: 'A', recipientId: 'B', status: 'ACCEPTED' }]).state).toBe('CONNECTED');
    expect(computeState('A', 'B', [{ requesterId: 'B', recipientId: 'A', status: 'ACCEPTED' }]).state).toBe('CONNECTED');
  });
});

describe('connection request validation', () => {
  function validateRequest(viewer: string, target: string): { ok: boolean; error?: string } {
    if (viewer === target) return { ok: false, error: 'cannot connect to yourself' };
    return { ok: true };
  }
  it('rejects self-request', () => {
    expect(validateRequest('A', 'A').ok).toBe(false);
  });
  it('accepts distinct users', () => {
    expect(validateRequest('A', 'B').ok).toBe(true);
  });
});

describe('accept / decline authorization', () => {
  function canAct(row: Row, actor: string, action: 'accept' | 'decline'): boolean {
    return actor === row.recipientId && row.status === 'PENDING';
  }
  it('only recipient may accept', () => {
    const row: Row = { requesterId: 'A', recipientId: 'B', status: 'PENDING' };
    expect(canAct(row, 'B', 'accept')).toBe(true);
    expect(canAct(row, 'A', 'accept')).toBe(false);
    expect(canAct(row, 'C', 'accept')).toBe(false);
  });
  it('only recipient may decline', () => {
    const row: Row = { requesterId: 'A', recipientId: 'B', status: 'PENDING' };
    expect(canAct(row, 'B', 'decline')).toBe(true);
    expect(canAct(row, 'A', 'decline')).toBe(false);
  });
  it('cannot accept an already-accepted row', () => {
    const row: Row = { requesterId: 'A', recipientId: 'B', status: 'ACCEPTED' };
    expect(canAct(row, 'B', 'accept')).toBe(false);
  });
});

describe('remove authorization (either party)', () => {
  function canRemove(row: Row, actor: string): boolean {
    return actor === row.requesterId || actor === row.recipientId;
  }
  it('requester may remove', () => {
    expect(canRemove({ requesterId: 'A', recipientId: 'B', status: 'ACCEPTED' }, 'A')).toBe(true);
  });
  it('recipient may remove', () => {
    expect(canRemove({ requesterId: 'A', recipientId: 'B', status: 'ACCEPTED' }, 'B')).toBe(true);
  });
  it('unrelated third party cannot remove', () => {
    expect(canRemove({ requesterId: 'A', recipientId: 'B', status: 'ACCEPTED' }, 'C')).toBe(false);
  });
});
