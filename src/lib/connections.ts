import { prisma } from './db';

/**
 * Symmetric connection status between viewer and target.
 * NONE           — no PlayerConnection row (or DECLINED and neither side re-requested)
 * PENDING_SENT   — viewer requested target
 * PENDING_RECEIVED — target requested viewer
 * CONNECTED      — ACCEPTED (either direction)
 * SELF           — same user
 */
export type ConnectionState = 'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'CONNECTED' | 'SELF';

export interface ConnectionSnapshot {
  state: ConnectionState;
  connectionId?: string;   // present when state != NONE and != SELF
}

export async function getConnectionState(viewerId: string, targetId: string): Promise<ConnectionSnapshot> {
  if (viewerId === targetId) return { state: 'SELF' };
  const rows = await prisma.playerConnection.findMany({
    where: {
      OR: [
        { requesterId: viewerId, recipientId: targetId },
        { requesterId: targetId, recipientId: viewerId },
      ],
    },
    take: 2,
  });
  // Prefer an ACCEPTED row if one exists (there could be at most one per pair
  // per direction; symmetric conceptually)
  const accepted = rows.find((r) => r.status === 'ACCEPTED');
  if (accepted) return { state: 'CONNECTED', connectionId: accepted.id };
  const outbound = rows.find((r) => r.requesterId === viewerId && r.status === 'PENDING');
  if (outbound) return { state: 'PENDING_SENT', connectionId: outbound.id };
  const inbound = rows.find((r) => r.recipientId === viewerId && r.status === 'PENDING');
  if (inbound) return { state: 'PENDING_RECEIVED', connectionId: inbound.id };
  return { state: 'NONE' };
}

export async function countPendingIncoming(userId: string): Promise<number> {
  return prisma.playerConnection.count({
    where: { recipientId: userId, status: 'PENDING' },
  });
}

export async function listAcceptedConnections(userId: string) {
  const rows = await prisma.playerConnection.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { recipientId: userId }],
    },
    include: { requester: true, recipient: true },
    orderBy: { respondedAt: 'desc' },
  });
  return rows.map((r) => {
    const other = r.requesterId === userId ? r.recipient : r.requester;
    return { id: r.id, other, connectedAt: r.respondedAt ?? r.createdAt };
  });
}
