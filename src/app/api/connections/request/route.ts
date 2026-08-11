import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

const Schema = z.object({ targetUserId: z.string().min(1) });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const target = parsed.data.targetUserId;
  if (target === user.id) return NextResponse.json({ error: 'cannot connect to yourself' }, { status: 400 });
  const targetUser = await prisma.user.findUnique({ where: { id: target }, select: { id: true } });
  if (!targetUser) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  // If the other side already sent us a request, treat this as an accept.
  const inbound = await prisma.playerConnection.findUnique({
    where: { requesterId_recipientId: { requesterId: target, recipientId: user.id } },
  });
  if (inbound) {
    if (inbound.status === 'ACCEPTED') return NextResponse.json({ ok: true, alreadyConnected: true });
    if (inbound.status === 'PENDING') {
      const updated = await prisma.playerConnection.update({
        where: { id: inbound.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      return NextResponse.json({ ok: true, connection: updated, becameConnected: true });
    }
  }

  // Try to create; the unique index catches duplicate outbound requests.
  try {
    const c = await prisma.playerConnection.create({
      data: { requesterId: user.id, recipientId: target, status: 'PENDING' },
    });
    return NextResponse.json({ ok: true, connection: c });
  } catch (e: any) {
    if (e.code === 'P2002') {
      // duplicate — return the existing row so the client can update its state
      const existing = await prisma.playerConnection.findUnique({
        where: { requesterId_recipientId: { requesterId: user.id, recipientId: target } },
      });
      return NextResponse.json({ ok: true, connection: existing, duplicate: true });
    }
    throw e;
  }
}
