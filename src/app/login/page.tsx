'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const invite = sp?.get('invite') ?? null;
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: pw }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? 'Failed');
      return;
    }
    router.push(invite ? `/invite/${invite}` : '/dashboard');
    router.refresh();
  }

  return (
    <div className="max-w-md mx-auto card-panel">
      <h1 className="text-2xl font-display brass-text mb-4">Log in</h1>
      <form onSubmit={submit} className="grid gap-3">
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Log in'}</button>
        <div className="text-sm text-ink-500">
          No account? <Link href={invite ? `/register?invite=${invite}` : '/register'} className="underline">Register</Link>
        </div>
      </form>
    </div>
  );
}
