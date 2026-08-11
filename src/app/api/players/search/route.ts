import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Paginated username search. Auth-required so signed-out visitors can't
 * enumerate the user table. Case-insensitive substring match, capped at 20.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 32);
  if (q.length < 1) return NextResponse.json({ results: [] });
  const rows = await prisma.user.findMany({
    where: { username: { contains: q, mode: 'insensitive' } },
    orderBy: { username: 'asc' },
    take: 20,
    select: {
      id: true,
      username: true,
      avatar: true,
      avatarUpdatedAt: true,
    },
  });
  return NextResponse.json({
    results: rows.map((r) => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      avatarUpdatedAt: r.avatarUpdatedAt?.getTime() ?? null,
    })),
  });
}
