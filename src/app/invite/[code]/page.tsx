import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lobby = await prisma.lobby.findUnique({ where: { inviteCode: code } });
  if (!lobby) {
    return <div className="card-panel max-w-md mx-auto text-center">Invite not found or expired.</div>;
  }
  const user = await getSessionUser();
  if (!user) {
    redirect(`/register?invite=${code}`);
  }
  // auto-join if not already in
  const existing = await prisma.lobbyPlayer.findFirst({
    where: { lobbyId: lobby.id, userId: user.id },
  });
  if (!existing && lobby.status === 'WAITING') {
    const count = await prisma.lobbyPlayer.count({ where: { lobbyId: lobby.id } });
    if (count < lobby.maxPlayers) {
      const taken = await prisma.lobbyPlayer.findMany({ where: { lobbyId: lobby.id }, select: { seat: true } });
      const takenSet = new Set(taken.map((t) => t.seat));
      let seat = 0;
      while (takenSet.has(seat)) seat++;
      await prisma.lobbyPlayer.create({
        data: {
          lobbyId: lobby.id,
          userId: user.id,
          seat,
          chips: lobby.startingStack,
          initialBuyIn: lobby.startingStack,
        },
      });
    }
  }
  redirect(`/lobby/${lobby.id}`);
}
