import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const c = await prisma.playerConnection.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (c.recipientId !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (c.status !== 'PENDING') return NextResponse.json({ ok: true, alreadyResolved: true });
  const updated = await prisma.playerConnection.update({
    where: { id },
    data: { status: 'ACCEPTED', respondedAt: new Date() },
  });
  return NextResponse.json({ ok: true, connection: updated });
}
