'use client';
import { AVATARS } from '@/lib/avatars';
import clsx from 'clsx';

interface AvatarUser {
  id?: string | null;                    // user id, used to build the Postgres-backed URL
  avatar?: string | null;                // standard avatar id (fallback)
  avatarUrl?: string | null;             // legacy Phase-2 filesystem URL (still honored)
  avatarUpdatedAt?: string | number | null; // ms/ISO — used for cache-busting
}

/**
 * Resolve the best avatar image source, with three-tier fallback:
 *   1. Postgres-backed uploaded avatar (via /api/users/[id]/avatar?v=...)
 *   2. Legacy ephemeral avatarUrl (Phase-2 only; probably 404 in prod)
 *   3. Standard casino avatar glyph (rendered inline, no network)
 */
function resolveImage(u: AvatarUser | undefined): string | null {
  if (!u) return null;
  if (u.id && u.avatarUpdatedAt) {
    const v = typeof u.avatarUpdatedAt === 'number' ? u.avatarUpdatedAt : new Date(u.avatarUpdatedAt).getTime();
    return `/api/users/${u.id}/avatar?v=${v}`;
  }
  if (u.avatarUrl) return u.avatarUrl;
  return null;
}

/**
 * Backward-compatible props: callers still pass { id, size, url } for legacy
 * paths, or the new { user, size } shape.
 */
export function AvatarBadge({
  id, size = 40, url, user,
}: {
  id?: string;
  size?: number;
  url?: string | null;
  user?: AvatarUser;
}) {
  const resolvedUser: AvatarUser | undefined = user ?? (id ? { avatar: id, avatarUrl: url ?? null } : undefined);
  const a = AVATARS.find((x) => x.id === (resolvedUser?.avatar ?? id)) ?? AVATARS[0];
  const src = resolveImage(resolvedUser);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        className="rounded-full object-cover border border-black/40"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold border border-black/40"
      style={{ width: size, height: size, background: a.bg, color: a.fg, fontSize: size * 0.4 }}
      title={a.label}
    >
      {a.glyph}
    </div>
  );
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {AVATARS.map((a) => (
        <button
          type="button"
          key={a.id}
          onClick={() => onChange(a.id)}
          className={clsx(
            'rounded-full aspect-square border-2 flex items-center justify-center transition',
            value === a.id ? 'border-brass-500 scale-105' : 'border-transparent opacity-70 hover:opacity-100'
          )}
          style={{ background: a.bg, color: a.fg, fontSize: 20 }}
          title={a.label}
        >
          {a.glyph}
        </button>
      ))}
    </div>
  );
}
