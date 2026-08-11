import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { inviteCode } from '@/lib/codes';

const Schema = z.object({
  name: z.string().min(1).max(50),
  gameType: z.enum(['CASH', 'TOURNAMENT']),
  maxPlayers: z.number().int().min(2).max(10),
  startingStack: z.number().int().min(100).max(1_000_000),
  smallBlind: z.number().int().min(1).max(100_000),
  bigBlind: z.number().int().min(2).max(200_000),
  blindSpeed: z.enum(['SLOW', 'NORMAL', 'TURBO']).default('NORMAL'),
  actionTimer: z.number().int().min(10).max(120),
  password: z.string().max(50).optional().nullable(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.bigBlind < parsed.data.smallBlind * 2)
    return NextResponse.json({ error: 'Big blind must be >= 2x small blind' }, { status: 400 });

  let code = inviteCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.lobby.findUnique({ where: { inviteCode: code } });
    if (!exists) break;
    code = inviteCode();
  }

  const lobby = await prisma.lobby.create({
    data: {
      name: parsed.data.name,
      hostId: user.id,
      inviteCode: code,
      gameType: parsed.data.gameType,
      maxPlayers: parsed.data.maxPlayers,
      startingStack: parsed.data.startingStack,
      smallBlind: parsed.data.smallBlind,
      bigBlind: parsed.data.bigBlind,
      blindSpeed: parsed.data.blindSpeed,
      actionTimer: parsed.data.actionTimer,
      password: parsed.data.password || null,
      players: {
        create: { userId: user.id, seat: 0, chips: parsed.data.startingStack },
      },
    },
  });
  return NextResponse.json({ ok: true, lobbyId: lobby.id, inviteCode: lobby.inviteCode });
}
