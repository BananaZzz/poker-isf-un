'use client';
import { AVATARS } from '@/lib/avatars';
import clsx from 'clsx';

export function AvatarBadge({ id, size = 40, url }: { id: string; size?: number; url?: string | null }) {
  const a = AVATARS.find((x) => x.id === id) ?? AVATARS[0];
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
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
