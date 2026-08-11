import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AVATARS } from '@/lib/avatars';

const Schema = z.object({ avatar: z.string() });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (!AVATARS.some((a) => a.id === parsed.data.avatar)) {
    return NextResponse.json({ error: 'unknown avatar' }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { avatar: parsed.data.avatar } });
  return NextResponse.json({ ok: true });
}
