import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Guardrails:
//  - clients resize + re-encode to WebP client-side (see ProfilePanel) so the
//    stored blob is typically 30–150 KB;
//  - server still enforces a hard cap and MIME magic-byte check so a hostile
//    client can't dump a 50 MB PNG or arbitrary bytes into Postgres.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB accepted (client normally sends <200 KB)
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function detectMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'bad form' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5 MB)' }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = detectMime(buf);
  if (!mime || !ALLOWED.has(mime)) {
    return NextResponse.json({ error: 'only JPEG, PNG or WEBP allowed' }, { status: 415 });
  }
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      avatarData: buf,
      avatarMime: mime,
      avatarUpdatedAt: now,
      // clear the legacy ephemeral-filesystem URL if present
      avatarUrl: null,
    },
  });
  return NextResponse.json({ ok: true, avatarUpdatedAt: now.toISOString() });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      avatarData: null,
      avatarMime: null,
      avatarUpdatedAt: new Date(),
      avatarUrl: null,
    },
  });
  return NextResponse.json({ ok: true });
}
