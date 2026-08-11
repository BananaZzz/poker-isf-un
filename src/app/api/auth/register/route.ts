import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, createSession } from '@/lib/auth';

const Schema = z.object({
  username: z.string().min(2).max(24).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(6).max(200),
  avatar: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const { username, password, avatar } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, passwordHash, avatar: avatar ?? 'avatar-1' },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, username: user.username } });
}
