import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { LobbyRoom } from '@/components/LobbyRoom';

export const dynamic = 'force-dynamic';

export default async function LobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login`);
  const lobby = await prisma.lobby.findUnique({
    where: { id },
    include: { players: { include: { user: true }, orderBy: { seat: 'asc' } } },
  });
  if (!lobby) notFound();
  const isMember = lobby.players.some((p) => p.userId === user.id);
  if (!isMember) redirect(`/invite/${lobby.inviteCode}`);
  return (
    <LobbyRoom
      me={{ id: user.id, username: user.username, avatar: user.avatar }}
      initial={{
        id: lobby.id,
        name: lobby.name,
        status: lobby.status,
        hostId: lobby.hostId,
        inviteCode: lobby.inviteCode,
        maxPlayers: lobby.maxPlayers,
        gameType: lobby.gameType,
        startingStack: lobby.startingStack,
        smallBlind: lobby.smallBlind,
        bigBlind: lobby.bigBlind,
        allowRebuy: lobby.allowRebuy,
        blindsIncrease: lobby.blindsIncrease,
        blindMultiplier: lobby.blindMultiplier,
        blindIntervalSec: lobby.blindIntervalSec,
        players: lobby.players.map((p) => ({
          userId: p.userId,
          username: p.user.username,
          avatar: p.user.avatar,
          avatarUrl: p.user.avatarUrl,
          avatarUpdatedAt: p.user.avatarUpdatedAt?.getTime() ?? null,
          seat: p.seat,
          ready: p.ready,
          chips: p.chips,
          initialBuyIn: p.initialBuyIn,
          totalRebuys: p.totalRebuys,
          bustedOut: p.bustedOut,
          sittingOut: p.sittingOut,
        })),
      }}
    />
  );
}
