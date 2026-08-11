import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Remove a connection (or cancel a pending request). Either party of the
 * connection may drop it.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const c = await prisma.playerConnection.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ ok: true, alreadyGone: true });
  if (c.requesterId !== user.id && c.recipientId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await prisma.playerConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
