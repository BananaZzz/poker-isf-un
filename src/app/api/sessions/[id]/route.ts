import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const s = await prisma.gameSession.findUnique({
    where: { id: params.id },
    include: { participants: true, lobby: true },
  });
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const isParticipant = s.participants.some((p) => p.userId === user.id);
  if (!isParticipant) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(s);
}
