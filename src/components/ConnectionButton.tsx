'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'CONNECTED' | 'SELF';

export function ConnectionButton({
  targetUserId, initialState, initialConnectionId,
}: {
  targetUserId: string;
  initialState: State;
  initialConnectionId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initialState);
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function req(path: string, method: 'POST' | 'DELETE', body?: any) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? 'Failed'); return null; }
      return j;
    } finally { setBusy(false); router.refresh(); }
  }

  async function sendRequest() {
    const j = await req('/api/connections/request', 'POST', { targetUserId });
    if (!j) return;
    if (j.becameConnected) { setState('CONNECTED'); setConnectionId(j.connection.id); }
    else if (j.connection) { setState('PENDING_SENT'); setConnectionId(j.connection.id); }
  }
  async function accept() {
    if (!connectionId) return;
    await req(`/api/connections/${connectionId}/accept`, 'POST');
    setState('CONNECTED');
  }
  async function decline() {
    if (!connectionId) return;
    await req(`/api/connections/${connectionId}/decline`, 'POST');
    setState('NONE'); setConnectionId(null);
  }
  async function remove() {
    if (!connectionId) return;
    if (!confirm('Remove this connection?')) return;
    await req(`/api/connections/${connectionId}`, 'DELETE');
    setState('NONE'); setConnectionId(null);
  }

  if (state === 'SELF') return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {state === 'NONE' && (
        <button className="btn btn-primary" onClick={sendRequest} disabled={busy}>Connect</button>
      )}
      {state === 'PENDING_SENT' && (
        <>
          <span className="text-xs text-brass-400 uppercase tracking-widest">Request sent</span>
          <button className="btn" onClick={remove} disabled={busy}>Cancel</button>
        </>
      )}
      {state === 'PENDING_RECEIVED' && (
        <>
          <button className="btn btn-primary" onClick={accept} disabled={busy}>Accept</button>
          <button className="btn" onClick={decline} disabled={busy}>Decline</button>
        </>
      )}
      {state === 'CONNECTED' && (
        <>
          <span className="text-xs text-green-400 uppercase tracking-widest">Connected</span>
          <button className="btn" onClick={remove} disabled={busy}>Remove</button>
        </>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
