import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { LobbyRoom } from '@/components/LobbyRoom';

export const dynamic = 'force-dynamic';

export default async function LobbyPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login`);
  const lobby = await prisma.lobby.findUnique({
    where: { id: params.id },
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
        players: lobby.players.map((p) => ({
          userId: p.userId,
          username: p.user.username,
          avatar: p.user.avatar,
          seat: p.seat,
          ready: p.ready,
          chips: p.chips,
        })),
      }}
    />
  );
}
