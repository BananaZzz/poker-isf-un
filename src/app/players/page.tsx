'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AvatarBadge } from '@/components/AvatarPicker';

interface Row { id: string; username: string; avatar: string; avatarUpdatedAt: number | null }

export default function PlayerSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    const trimmed = q.trim();
    if (trimmed.length === 0) { setRows([]); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/players/search?q=${encodeURIComponent(trimmed)}`);
      if (cancel) return;
      const j = await r.json().catch(() => ({ results: [] }));
      setRows(j.results ?? []);
      setBusy(false);
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="max-w-2xl mx-auto grid gap-4">
      <div className="card-panel">
        <h1 className="font-display brass-text text-xl mb-3">Find players</h1>
        <input
          className="input"
          placeholder="Search by username…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        {busy && <div className="text-xs text-ink-500">Searching…</div>}
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/players/${encodeURIComponent(r.username)}`}
            className="stack-card hover:border-accent-red flex-row items-center"
          >
            <AvatarBadge user={{ id: r.id, avatar: r.avatar, avatarUpdatedAt: r.avatarUpdatedAt }} size={36} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{r.username}</div>
            </div>
            <span className="text-xs text-ink-500">View profile →</span>
          </Link>
        ))}
        {!busy && q.trim().length > 0 && rows.length === 0 && (
          <div className="text-sm text-ink-500">No players match “{q}”.</div>
        )}
      </div>
    </div>
  );
}
