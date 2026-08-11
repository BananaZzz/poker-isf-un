'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AvatarPicker } from '@/components/AvatarPicker';

export default function RegisterPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const invite = sp?.get('invite') ?? null;
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [avatar, setAvatar] = useState('avatar-1');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) return setErr('Passwords do not match');
    if (pw.length < 6) return setErr('Password must be at least 6 characters');
    setBusy(true);
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: pw, avatar }),
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
      <h1 className="text-2xl font-display brass-text mb-4">Create your account</h1>
      <form onSubmit={submit} className="grid gap-3">
        <label className="text-sm">
          <div className="mb-1 text-white/80">Username</div>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={24} />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-white/80">Password</div>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-white/80">Repeat password</div>
          <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} />
        </label>
        <div>
          <div className="mb-2 text-white/80 text-sm">Choose an avatar</div>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Create account'}</button>
        <div className="text-sm text-ink-500">
          Already have one? <Link href={invite ? `/login?invite=${invite}` : '/login'} className="underline">Log in</Link>
        </div>
      </form>
    </div>
  );
}
