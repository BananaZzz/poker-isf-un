import { prisma } from '@/lib/db';

/**
 * Finalize a lobby session for one player: computes their net result,
 * updates lifetime user stats, and writes a GameParticipant row.
 *
 * Idempotent per (sessionId, userId): a participant row is created at most once.
 */
export async function finalizePlayer(params: {
  sessionId: string;
  userId: string;
  username: string;
  initialBuyIn: number;
  totalRebuys: number;
  cashOutStack: number;
  placement?: number | null;
}) {
  const totalInvested = params.initialBuyIn + params.totalRebuys;
  const netResult = params.cashOutStack - totalInvested;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.gameParticipant.findUnique({
      where: { sessionId_userId: { sessionId: params.sessionId, userId: params.userId } },
    });
    if (existing) return existing; // idempotent

    const participant = await tx.gameParticipant.create({
      data: {
        sessionId: params.sessionId,
        userId: params.userId,
        username: params.username,
        initialBuyIn: params.initialBuyIn,
        totalRebuys: params.totalRebuys,
        totalInvested,
        cashOutStack: params.cashOutStack,
        netResult,
        placement: params.placement ?? null,
      },
    });

    const user = await tx.user.findUnique({ where: { id: params.userId } });
    if (!user) return participant;

    const won = netResult > 0 ? netResult : 0;
    const lost = netResult < 0 ? -netResult : 0;
    const biggestWin = Math.max(user.biggestWinCents, won);
    const biggestLoss = Math.max(user.biggestLossCents, lost);

    await tx.user.update({
      where: { id: user.id },
      data: {
        netCents: user.netCents + netResult,
        gamesPlayed: user.gamesPlayed + 1,
        gamesWon: user.gamesWon + (netResult > 0 ? 1 : 0),
        totalWonCents: user.totalWonCents + won,
        totalLostCents: user.totalLostCents + lost,
        biggestWinCents: biggestWin,
        biggestLossCents: biggestLoss,
      },
    });

    return participant;
  });
}

export async function ensureGameSession(params: {
  lobbyId: string;
  name: string;
  gameType: string;
  smallBlind: number;
  bigBlind: number;
}): Promise<string> {
  const existing = await prisma.gameSession.findFirst({
    where: { lobbyId: params.lobbyId, endedAt: null },
  });
  if (existing) return existing.id;
  const s = await prisma.gameSession.create({
    data: {
      lobbyId: params.lobbyId,
      name: params.name,
      gameType: params.gameType,
      smallBlindStart: params.smallBlind,
      bigBlindStart: params.bigBlind,
    },
  });
  return s.id;
}

export async function closeGameSession(sessionId: string, handsPlayed: number) {
  await prisma.gameSession.updateMany({
    where: { id: sessionId, endedAt: null },
    data: { endedAt: new Date(), handsPlayed },
  });
}
