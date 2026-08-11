'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socketClient';
import { AvatarBadge } from './AvatarPicker';
import { PokerTable } from './PokerTable';

interface LobbyPlayer {
  userId: string;
  username: string;
  avatar: string;
  seat: number;
  ready: boolean;
  chips: number;
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
  players: LobbyPlayer[];
}
interface Me {
  id: string;
  username: string;
  avatar: string;
}

export function LobbyRoom({ me, initial }: { me: Me; initial: LobbySnap }) {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbySnap>(initial);
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState<{ user: string; text: string; at: number }[]>([]);
  const [chatMsg, setChatMsg] = useState('');
  const [gameState, setGameState] = useState<any | null>(null);
  const [legal, setLegal] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    const onLobby = (snap: LobbySnap) => {
      if (snap.id === lobby.id) setLobby(snap);
    };
    const onChat = (m: any) => setChat((prev) => [...prev, m].slice(-50));
    const onChatHist = (m: any[]) => setChat(m);
    const onState = (payload: { state: any; legal: any }) => {
      setGameState(payload.state);
      setLegal(payload.legal);
    };
    const onError = (m: string) => {
      setErr(m);
      setTimeout(() => setErr(null), 3000);
    };
    s.on('lobby', onLobby);
    s.on('chat', onChat);
    s.on('chat:history', onChatHist);
    s.on('state', onState);
    s.on('error:msg', onError);
    return () => {
      s.emit('lobby:unsubscribe', lobby.id);
      s.emit('game:leave', { lobbyId: lobby.id });
      s.off('lobby', onLobby);
      s.off('chat', onChat);
      s.off('chat:history', onChatHist);
      s.off('state', onState);
      s.off('error:msg', onError);
    };
  }, [lobby.id]);

  function toggleReady() {
    const s = getSocket();
    s.emit('lobby:ready', { lobbyId: lobby.id, ready: !myPlayer?.ready });
  }
  function startGame() {
    getSocket().emit('lobby:start', { lobbyId: lobby.id });
  }
  async function leave() {
    await fetch(`/api/lobby/${lobby.id}/leave`, { method: 'POST' });
    router.push('/dashboard');
    router.refresh();
  }
  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const t = chatMsg.trim();
    if (!t) return;
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
                {lobby.players.length}/{lobby.maxPlayers} players ·
                SB {lobby.smallBlind}/BB {lobby.bigBlind} · Stack {lobby.startingStack.toLocaleString()}
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
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>

        {showTable ? (
          <PokerTable state={gameState} legal={legal} meId={me.id} lobbyId={lobby.id} />
        ) : (
          <div className="card-panel">
            <h2 className="text-lg font-display brass-text mb-3">Waiting Room</h2>
            <div className="grid gap-2">
              {lobby.players.map((p) => (
                <div key={p.userId} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2">
                  <AvatarBadge id={p.avatar} />
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
                >
                  Start game
                </button>
              )}
              <button className="btn btn-danger" onClick={leave}>Leave lobby</button>
            </div>
          </div>
        )}
      </div>

      <div className="card-panel flex flex-col h-[500px]">
        <h3 className="font-display brass-text mb-3">Chat</h3>
        <div className="flex-1 overflow-y-auto space-y-1 text-sm">
          {chat.map((m, i) => (
            <div key={i}>
              <span className="text-brass-400">{m.user}:</span> <span className="text-white/90">{m.text}</span>
            </div>
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
