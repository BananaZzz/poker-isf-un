'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';
import { AvatarBadge } from './AvatarPicker';
import { PokerTable } from './PokerTable';
import { formatCurrency } from '@/lib/money';

interface LobbyPlayer {
  userId: string;
  username: string;
  avatar: string;
  avatarUrl?: string | null;
  seat: number;
  ready: boolean;
  chips: number;
  initialBuyIn: number;
  totalRebuys: number;
  bustedOut: boolean;
  sittingOut: boolean;
}
interface LobbySnap {
  id: string;
  name: string;
  status: string;
  hostId: string;
  inviteCode: string;
  maxPlayers: number;
  gameType: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  allowRebuy?: boolean;
  blindsIncrease?: boolean;
  blindMultiplier?: number | null;
  blindIntervalSec?: number | null;
  players: LobbyPlayer[];
}
interface Me { id: string; username: string; avatar: string }

export function LobbyRoom({ me, initial }: { me: Me; initial: LobbySnap }) {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbySnap>(initial);
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState<{ user: string; text: string; at: number }[]>([]);
  const [chatMsg, setChatMsg] = useState('');
  const [gameState, setGameState] = useState<any | null>(null);
  const [legal, setLegal] = useState<any | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState<{ sessionId: string | null } | null>(null);
  const [sessionResult, setSessionResult] = useState<any | null>(null);

  const isHost = lobby.hostId === me.id;
  const myPlayer = lobby.players.find((p) => p.userId === me.id);
  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/invite/${lobby.inviteCode}`;
  }, [lobby.inviteCode]);

  useEffect(() => {
    const s = getSocket();
    s.emit('lobby:subscribe', lobby.id);
    s.emit('game:join', { lobbyId: lobby.id });
    const onLobby = (snap: LobbySnap) => { if (snap.id === lobby.id) setLobby(snap); };
    const onChat = (m: any) => setChat((prev) => [...prev, m].slice(-50));
    const onChatHist = (m: any[]) => setChat(m);
    const onState = (payload: { state: any; legal: any; meta: any }) => {
      setGameState(payload.state);
      setLegal(payload.legal);
      setMeta(payload.meta);
    };
    const onEnded = async (p: { lobbyId: string; sessionId: string | null }) => {
      if (p.lobbyId !== lobby.id) return;
      setSessionEnded({ sessionId: p.sessionId });
      if (p.sessionId) {
        const r = await fetch(`/api/sessions/${p.sessionId}`).catch(() => null);
        if (r?.ok) setSessionResult(await r.json());
      }
    };
    const onError = (m: string) => { setErr(m); setTimeout(() => setErr(null), 3000); };
    s.on('lobby', onLobby);
    s.on('chat', onChat);
    s.on('chat:history', onChatHist);
    s.on('state', onState);
    s.on('session:ended', onEnded);
    s.on('error:msg', onError);
    return () => {
      s.emit('lobby:unsubscribe', lobby.id);
      s.emit('game:leave', { lobbyId: lobby.id });
      s.off('lobby', onLobby); s.off('chat', onChat); s.off('chat:history', onChatHist);
      s.off('state', onState); s.off('session:ended', onEnded); s.off('error:msg', onError);
    };
  }, [lobby.id]);

  function toggleReady() {
    getSocket().emit('lobby:ready', { lobbyId: lobby.id, ready: !myPlayer?.ready });
  }
  function startGame() { getSocket().emit('lobby:start', { lobbyId: lobby.id }); }
  async function leaveLobby() {
    await fetch(`/api/lobby/${lobby.id}/leave`, { method: 'POST' });
    router.push('/dashboard'); router.refresh();
  }
  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const t = chatMsg.trim(); if (!t) return;
    getSocket().emit('chat:send', { lobbyId: lobby.id, text: t });
    setChatMsg('');
  }

  const showTable = lobby.status !== 'WAITING' && gameState;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="card-panel mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-widest text-brass-400">{lobby.gameType}</div>
              <h1 className="text-2xl font-display">{lobby.name}</h1>
              <div className="text-sm text-ink-500 mt-1">
                {lobby.players.length}/{lobby.maxPlayers} players · SB {formatCurrency(lobby.smallBlind)}/BB {formatCurrency(lobby.bigBlind)} · Buy-in {formatCurrency(lobby.startingStack)}
                {lobby.allowRebuy && lobby.gameType === 'CASH' && ' · rebuy on'}
                {lobby.blindsIncrease && ` · blinds ×${lobby.blindMultiplier} every ${(lobby.blindIntervalSec ?? 0)/60}m`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={inviteUrl} className="input w-64 text-xs" />
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          </div>
        </div>

        {sessionEnded ? (
          <div className="card-panel text-center">
            <h2 className="font-display brass-text text-2xl mb-2">Game complete</h2>
            <div className="text-ink-500 text-sm mb-4">{lobby.name}</div>
            {sessionResult?.participants ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-500">
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">Player</th>
                    <th className="text-right py-2">Buy-in</th>
                    <th className="text-right py-2">Rebuys</th>
                    <th className="text-right py-2">Cash-out</th>
                    <th className="text-right py-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionResult.participants
                    .slice()
                    .sort((a: any, b: any) => {
                      if (sessionResult.gameType === 'TOURNAMENT') {
                        const ap = a.placement ?? 999, bp = b.placement ?? 999;
                        if (ap !== bp) return ap - bp;
                      }
                      return b.netResult - a.netResult;
                    })
                    .map((p: any, i: number) => (
                      <tr key={p.id} className="border-t border-ink-700">
                        <td className="py-2">{sessionResult.gameType === 'TOURNAMENT' ? (p.placement ?? '—') : i + 1}</td>
                        <td className="py-2">{p.username}</td>
                        <td className="py-2 text-right">{formatCurrency(p.initialBuyIn)}</td>
                        <td className="py-2 text-right">{formatCurrency(p.totalRebuys)}</td>
                        <td className="py-2 text-right">{formatCurrency(p.cashOutStack)}</td>
                        <td className={`py-2 text-right ${p.netResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatCurrency(p.netResult, { showSign: true })}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <div className="text-ink-500">No results recorded.</div>
            )}
            <div className="mt-6 flex gap-2 justify-center">
              {sessionEnded.sessionId && (
                <Link href={`/game/${sessionEnded.sessionId}`} className="btn">View game details</Link>
              )}
              <Link href="/dashboard" className="btn btn-primary">Return to dashboard</Link>
            </div>
          </div>
        ) : showTable ? (
          <PokerTable
            state={gameState}
            legal={legal}
            meta={meta}
            meId={me.id}
            lobbyId={lobby.id}
            isHost={isHost}
          />
        ) : (
          <div className="card-panel">
            <h2 className="text-lg font-display brass-text mb-3">Waiting Room</h2>
            <div className="grid gap-2">
              {lobby.players.map((p) => (
                <div key={p.userId} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2">
                  <AvatarBadge id={p.avatar} url={p.avatarUrl ?? undefined} />
                  <div className="flex-1">
                    <div className="font-medium">
                      {p.username}
                      {p.userId === lobby.hostId && <span className="ml-2 text-xs text-brass-400">host</span>}
                    </div>
                    <div className="text-xs text-ink-500">Seat {p.seat + 1}</div>
                  </div>
                  <span className={`text-xs uppercase tracking-widest ${p.ready ? 'text-brass-400' : 'text-ink-500'}`}>
                    {p.ready ? 'Ready' : 'Not ready'}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn" onClick={toggleReady}>{myPlayer?.ready ? 'Unready' : 'Ready'}</button>
              {isHost && (
                <button
                  className="btn btn-primary"
                  onClick={startGame}
                  disabled={lobby.players.length < 2 || !lobby.players.every((p) => p.ready)}
                >Start game</button>
              )}
              <button className="btn btn-danger" onClick={leaveLobby}>Leave lobby</button>
            </div>
          </div>
        )}
      </div>

      <div className="card-panel flex flex-col h-[500px]">
        <h3 className="font-display brass-text mb-3">Chat</h3>
        <div className="flex-1 overflow-y-auto space-y-1 text-sm">
          {chat.map((m, i) => (
            <div key={i}><span className="text-brass-400">{m.user}:</span> <span className="text-white/90">{m.text}</span></div>
          ))}
          {chat.length === 0 && <div className="text-ink-500 text-xs">Say hi to your table.</div>}
        </div>
        <form onSubmit={sendChat} className="mt-3 flex gap-2">
          <input className="input" value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} placeholder="Message…" maxLength={300} />
          <button className="btn">Send</button>
        </form>
        {err && <div className="text-red-400 text-xs mt-2">{err}</div>}
      </div>
    </div>
  );
}
