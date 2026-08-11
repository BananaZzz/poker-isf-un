import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const lobby = await prisma.lobby.findUnique({
    where: { id },
    include: { players: true },
  });
  if (!lobby) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (lobby.status !== 'WAITING') return NextResponse.json({ error: 'lobby not accepting new players' }, { status: 400 });
  if (lobby.players.some((p) => p.userId === user.id)) {
    return NextResponse.json({ ok: true, alreadyIn: true, lobbyId: lobby.id });
  }
  if (lobby.players.length >= lobby.maxPlayers) return NextResponse.json({ error: 'lobby full' }, { status: 400 });
  // pick first free seat
  const taken = new Set(lobby.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;
  await prisma.lobbyPlayer.create({
    data: {
      lobbyId: lobby.id,
      userId: user.id,
      seat,
      chips: lobby.startingStack,
      initialBuyIn: lobby.startingStack,
    },
  });
  return NextResponse.json({ ok: true, lobbyId: lobby.id });
}
