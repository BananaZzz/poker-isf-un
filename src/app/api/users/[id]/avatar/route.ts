import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Serve a user's uploaded avatar bytes from Postgres.
 *
 * Access rule: requester must be authenticated (any signed-in user can view
 * any avatar — same as seeing it in a shared lobby). We don't enumerate here
 * either: an unknown id returns 404 identically to "no avatar set", which
 * gives no user-enumeration side channel worse than the /register endpoint.
 *
 * Cache: `avatarUpdatedAt` is exposed as ETag / Last-Modified so browsers
 * can round-trip a 304 while still refreshing after upload (the client
 * appends ?v=<updatedAt> to force cache-busting).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getSessionUser();
  if (!viewer) return new NextResponse('unauthorized', { status: 401 });
  const { id } = await params;
  const u = await prisma.user.findUnique({
    where: { id },
    select: { avatarData: true, avatarMime: true, avatarUpdatedAt: true },
  });
  if (!u || !u.avatarData || !u.avatarMime) {
    return new NextResponse('not found', { status: 404 });
  }
  const bytes = u.avatarData;
  const body = new Uint8Array(bytes);
  const etag = `"${u.avatarUpdatedAt?.getTime() ?? 0}"`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': u.avatarMime,
      'Cache-Control': 'private, max-age=86400',
      'ETag': etag,
      ...(u.avatarUpdatedAt ? { 'Last-Modified': u.avatarUpdatedAt.toUTCString() } : {}),
    },
  });
}
