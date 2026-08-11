'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreatePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: 'Home Game',
    gameType: 'CASH' as 'CASH' | 'TOURNAMENT',
    maxPlayers: 6,
    startingStack: 2000,
    smallBlind: 10,
    bigBlind: 20,
    blindSpeed: 'NORMAL' as 'SLOW' | 'NORMAL' | 'TURBO',
    actionTimer: 30,
    password: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function up<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm({ ...form, [k]: v });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      ...form,
      startingStack: Number(form.startingStack),
      smallBlind: Number(form.smallBlind),
      bigBlind: Number(form.bigBlind),
      maxPlayers: Number(form.maxPlayers),
      actionTimer: Number(form.actionTimer),
      password: form.password || null,
    };
    const r = await fetch('/api/lobby', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? 'Failed'); return; }
    const j = await r.json();
    router.push(`/lobby/${j.lobbyId}`);
  }

  return (
    <div className="max-w-xl mx-auto card-panel">
      <h1 className="text-2xl font-display brass-text mb-4">Create a new game</h1>
      <form onSubmit={submit} className="grid gap-4">
        <label className="text-sm">
          <div className="mb-1 text-white/80">Lobby name</div>
          <input className="input" value={form.name} onChange={(e) => up('name', e.target.value)} required />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <div className="mb-1 text-white/80">Game type</div>
            <select className="input" value={form.gameType} onChange={(e) => up('gameType', e.target.value as any)}>
              <option value="CASH">Cash Game</option>
              <option value="TOURNAMENT">Tournament</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Max players</div>
            <select className="input" value={form.maxPlayers} onChange={(e) => up('maxPlayers', Number(e.target.value))}>
              {[2, 4, 6, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="text-sm">
            <div className="mb-1 text-white/80">Starting stack</div>
            <input className="input" type="number" value={form.startingStack} onChange={(e) => up('startingStack', Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Small blind</div>
            <input className="input" type="number" value={form.smallBlind} onChange={(e) => up('smallBlind', Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Big blind</div>
            <input className="input" type="number" value={form.bigBlind} onChange={(e) => up('bigBlind', Number(e.target.value))} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <div className="mb-1 text-white/80">Blind speed (tournament)</div>
            <select className="input" value={form.blindSpeed} onChange={(e) => up('blindSpeed', e.target.value as any)}>
              <option value="SLOW">Slow (10 min)</option>
              <option value="NORMAL">Normal (5 min)</option>
              <option value="TURBO">Turbo (2 min)</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Action timer (seconds)</div>
            <select className="input" value={form.actionTimer} onChange={(e) => up('actionTimer', Number(e.target.value))}>
              {[15, 30, 45, 60].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label className="text-sm">
          <div className="mb-1 text-white/80">Password (optional)</div>
          <input className="input" value={form.password} onChange={(e) => up('password', e.target.value)} />
        </label>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Create lobby'}</button>
      </form>
    </div>
  );
}
