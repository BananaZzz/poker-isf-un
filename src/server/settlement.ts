import { prisma } from '@/lib/db';
import { computeSettlement } from '@/lib/settlement';

/**
 * Idempotent settlement finalization for a cash session.
 *
 * Reads finalized GameParticipant rows, computes settlement obligations,
 * and writes them under a unique (sessionId, debtor, creditor) index so
 * duplicate calls (double End-Game, reconnect races, replayed timers) are
 * safe. Also flips GameSession.settlementDone = true.
 *
 * Only runs for cash sessions — tournaments already have placement rankings
 * and are not part of the settle-up bookkeeping model.
 */
export async function finalizeSettlement(sessionId: string): Promise<{ created: number; skipped: boolean }> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { participants: true },
  });
  if (!session) return { created: 0, skipped: true };
  if (session.gameType !== 'CASH') return { created: 0, skipped: true };
  if (session.settlementDone) return { created: 0, skipped: true };
  if (session.participants.length === 0) return { created: 0, skipped: true };

  const nets = session.participants.map((p) => ({ userId: p.userId, netCents: p.netResult }));
  const obligations = computeSettlement(nets);

  // Use a transaction so the flag flip and the row inserts either all commit
  // or none do. Individual createMany is idempotent thanks to skipDuplicates
  // plus the unique index on (gameSessionId, debtorUserId, creditorUserId).
  await prisma.$transaction(async (tx) => {
    if (obligations.length > 0) {
      await tx.settlementObligation.createMany({
        data: obligations.map((o) => ({
          gameSessionId: sessionId,
          debtorUserId: o.debtorUserId,
          creditorUserId: o.creditorUserId,
          amountCents: o.amountCents,
        })),
        skipDuplicates: true,
      });
    }
    await tx.gameSession.update({
      where: { id: sessionId },
      data: { settlementDone: true },
    });
  });

  return { created: obligations.length, skipped: false };
}
