import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const lobby = await prisma.lobby.findUnique({ where: { id }, include: { players: true } });
  if (!lobby) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.lobbyPlayer.deleteMany({ where: { lobbyId: lobby.id, userId: user.id } });
  // if host left and no one else, delete lobby
  const rest = await prisma.lobbyPlayer.count({ where: { lobbyId: lobby.id } });
  if (rest === 0) {
    await prisma.lobby.delete({ where: { id: lobby.id } });
  } else if (lobby.hostId === user.id) {
    // transfer host to earliest joiner
    const nextHost = await prisma.lobbyPlayer.findFirst({ where: { lobbyId: lobby.id }, orderBy: { joinedAt: 'asc' } });
    if (nextHost) await prisma.lobby.update({ where: { id: lobby.id }, data: { hostId: nextHost.userId } });
  }
  return NextResponse.json({ ok: true });
}
