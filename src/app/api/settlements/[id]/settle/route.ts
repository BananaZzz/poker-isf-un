import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Mark a settlement obligation as settled.
 *
 * Authorization rule (documented in README): either the debtor OR the
 * creditor of the obligation can flip it — a debtor announcing "I paid"
 * and a creditor confirming "I got paid" are both legitimate. In practice
 * this is a private-group bookkeeping app, so we trust either side; the
 * settledByUserId column records who did it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const ob = await prisma.settlementObligation.findUnique({ where: { id } });
  if (!ob) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (ob.debtorUserId !== user.id && ob.creditorUserId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (ob.status === 'SETTLED') return NextResponse.json({ ok: true, alreadySettled: true });
  const updated = await prisma.settlementObligation.update({
    where: { id },
    data: { status: 'SETTLED', settledAt: new Date(), settledByUserId: user.id },
  });
  return NextResponse.json({ ok: true, obligation: updated });
}

/**
 * Un-settle: creditor OR debtor can revert a mistaken settle-click.
 * Prevents accidental "I paid" clicks from becoming permanent.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const ob = await prisma.settlementObligation.findUnique({ where: { id } });
  if (!ob) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (ob.debtorUserId !== user.id && ob.creditorUserId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const updated = await prisma.settlementObligation.update({
    where: { id },
    data: { status: 'OPEN', settledAt: null, settledByUserId: null },
  });
  return NextResponse.json({ ok: true, obligation: updated });
}
