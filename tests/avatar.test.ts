import { describe, it, expect } from 'vitest';

// Mirrors the magic-byte detector in src/app/api/profile/avatar/route.ts —
// kept in a pure form so we can test without spinning up Next.
function detectMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

describe('avatar MIME detection', () => {
  it('detects JPEG magic bytes', () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
    expect(detectMime(b)).toBe('image/jpeg');
  });
  it('detects PNG magic bytes', () => {
    const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMime(b)).toBe('image/png');
  });
  it('detects WebP (RIFF ... WEBP)', () => {
    const b = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
    ]);
    expect(detectMime(b)).toBe('image/webp');
  });
  it('rejects unknown bytes (e.g. a text file pretending to be an image)', () => {
    expect(detectMime(Buffer.from('not an image at all'))).toBeNull();
    expect(detectMime(Buffer.from([0x00, 0x00, 0x00]))).toBeNull();
  });
  it('rejects truncated header', () => {
    expect(detectMime(Buffer.from([0xff]))).toBeNull();
  });
});

describe('avatar cache-busting URL shape', () => {
  it('resolveImage yields a versioned /api/users/[id]/avatar URL', () => {
    // Mirror of the logic in AvatarBadge.resolveImage
    function resolve(u: { id?: string | null; avatarUrl?: string | null; avatarUpdatedAt?: number | string | null }) {
      if (u.id && u.avatarUpdatedAt) {
        const v = typeof u.avatarUpdatedAt === 'number' ? u.avatarUpdatedAt : new Date(u.avatarUpdatedAt).getTime();
        return `/api/users/${u.id}/avatar?v=${v}`;
      }
      if (u.avatarUrl) return u.avatarUrl;
      return null;
    }
    expect(resolve({ id: 'u1', avatarUpdatedAt: 1700000000000 })).toBe('/api/users/u1/avatar?v=1700000000000');
    expect(resolve({ id: 'u1' })).toBeNull(); // no upload
    expect(resolve({ avatarUrl: '/legacy.png' })).toBe('/legacy.png');
  });
});
