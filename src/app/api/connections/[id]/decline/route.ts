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
  // We delete rather than storing DECLINED, so the requester can freely try
  // again later (avoids "why can I never re-request" surprise).
  await prisma.playerConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
