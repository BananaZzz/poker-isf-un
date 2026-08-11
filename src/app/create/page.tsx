'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, parseCurrencyToCents } from '@/lib/money';

function CurrencyInput({ valueCents, onChange, className = '' }: { valueCents: number; onChange: (cents: number) => void; className?: string }) {
  const [text, setText] = useState((valueCents / 100).toFixed(2));
  return (
    <input
      className={`input ${className}`}
      value={text}
      inputMode="decimal"
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        setText(raw);
        const cents = parseCurrencyToCents(raw);
        if (cents !== null) onChange(cents);
      }}
      onBlur={() => setText((valueCents / 100).toFixed(2))}
    />
  );
}

export default function CreatePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: 'Friday Poker',
    gameType: 'CASH' as 'CASH' | 'TOURNAMENT',
    maxPlayers: 6,
    startingStack: 2000, // €20.00
    smallBlind: 10,      // €0.10
    bigBlind: 20,        // €0.20
    blindSpeed: 'NORMAL' as 'SLOW' | 'NORMAL' | 'TURBO',
    actionTimer: 30,
    password: '',
    allowRebuy: true,
    blindsIncrease: false,
    blindMultiplier: 1.5,
    blindIntervalSec: 300,
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
    const body: any = {
      ...form,
      startingStack: Number(form.startingStack),
      smallBlind: Number(form.smallBlind),
      bigBlind: Number(form.bigBlind),
      maxPlayers: Number(form.maxPlayers),
      actionTimer: Number(form.actionTimer),
      password: form.password || null,
    };
    if (!form.blindsIncrease) {
      body.blindMultiplier = null;
      body.blindIntervalSec = null;
    }
    const r = await fetch('/api/lobby', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
            <div className="mb-1 text-white/80">Buy-in ({formatCurrency(form.startingStack)})</div>
            <CurrencyInput valueCents={form.startingStack} onChange={(c) => up('startingStack', c)} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Small blind ({formatCurrency(form.smallBlind)})</div>
            <CurrencyInput valueCents={form.smallBlind} onChange={(c) => up('smallBlind', c)} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Big blind ({formatCurrency(form.bigBlind)})</div>
            <CurrencyInput valueCents={form.bigBlind} onChange={(c) => up('bigBlind', c)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {form.gameType === 'CASH' && (
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={form.allowRebuy} onChange={(e) => up('allowRebuy', e.target.checked)} />
              <span>Allow rebuy</span>
            </label>
          )}
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={form.blindsIncrease} onChange={(e) => up('blindsIncrease', e.target.checked)} />
            <span>Increase blinds automatically</span>
          </label>
        </div>
        {form.gameType === 'TOURNAMENT' && (
          <div className="text-xs text-ink-500">
            Tournaments do not allow rebuys. Players are eliminated on €0; final placement is by
            elimination order (last remaining = 1st).
          </div>
        )}
        {form.blindsIncrease && (
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm">
              <div className="mb-1 text-white/80">Multiplier</div>
              <select className="input" value={form.blindMultiplier} onChange={(e) => up('blindMultiplier', Number(e.target.value))}>
                <option value={1.5}>1.5×</option>
                <option value={1.8}>1.8×</option>
                <option value={2}>2×</option>
              </select>
            </label>
            <label className="text-sm">
              <div className="mb-1 text-white/80">Interval</div>
              <select className="input" value={form.blindIntervalSec} onChange={(e) => up('blindIntervalSec', Number(e.target.value))}>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
                <option value={600}>10 minutes</option>
                <option value={900}>15 minutes</option>
                <option value={1200}>20 minutes</option>
              </select>
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <div className="mb-1 text-white/80">Action timer (seconds)</div>
            <select className="input" value={form.actionTimer} onChange={(e) => up('actionTimer', Number(e.target.value))}>
              {[15, 30, 45, 60].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-white/80">Password (optional)</div>
            <input className="input" value={form.password} onChange={(e) => up('password', e.target.value)} />
          </label>
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Create lobby'}</button>
      </form>
    </div>
  );
}
