'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AvatarBadge } from './AvatarPicker';
import { PlayingCard } from './PlayingCard';
import { getSocket } from '@/lib/socketClient';
import { formatCurrency } from '@/lib/money';

enum ActionType { FOLD = 'FOLD', CHECK = 'CHECK', CALL = 'CALL', BET = 'BET', RAISE = 'RAISE', ALL_IN = 'ALL_IN' }
enum PlayerStatus { ACTIVE = 'ACTIVE', FOLDED = 'FOLDED', ALL_IN = 'ALL_IN', SITTING_OUT = 'SITTING_OUT', ELIMINATED = 'ELIMINATED' }

interface PlayerState {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  chips: number;
  currentBet: number;
  totalContribution: number;
  holeCards: any[];
  status: PlayerStatus;
  hasActedThisRound: boolean;
}
interface GameState {
  handNumber: number;
  phase: string;
  players: PlayerState[];
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  community: any[];
  currentBet: number;
  minRaise: number;
  pot: number;
  currentPlayerSeat: number | null;
  showdown: { playerId: string; amount: number; handName: string; potIndex?: number }[] | null;
  history: string[];
  actionDeadline: number | null;
}
interface Legal {
  actions: ActionType[];
  callAmount: number;
  minRaiseTo: number;
  maxBetTo: number;
}
interface Meta {
  currentSmallBlind: number;
  currentBigBlind: number;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  nextBlindMs: number | null;
  allowRebuy: boolean;
  startingStack: number;
  gameType: 'CASH' | 'TOURNAMENT';
  lobbyId: string;
  pacing?: {
    showdownRevealPerPlayerMs?: number;
    showdownExtraForBannerMs?: number;
  };
}

function seatPos(seatIndex: number, total: number) {
  const angle = (Math.PI * 2 * seatIndex) / total - Math.PI / 2;
  const rx = 42, ry = 36;
  return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) };
}

function useCountdown(deadlineMs: number | null) {
  const [remaining, setRemaining] = useState(deadlineMs ?? 0);
  useEffect(() => {
    if (deadlineMs === null) { setRemaining(0); return; }
    const start = performance.now();
    const initial = deadlineMs;
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      setRemaining(Math.max(0, initial - elapsed));
      if (initial - elapsed > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadlineMs]);
  return remaining;
}

export function PokerTable({
  state, legal, meta, meId, lobbyId, isHost,
  onSessionEnded,
}: {
  state: GameState;
  legal: Legal | null;
  meta: Meta | null;
  meId: string;
  lobbyId: string;
  isHost: boolean;
  onSessionEnded?: () => void;
}) {
  const seats = state.players.slice().sort((a, b) => a.seat - b.seat);
  const total = Math.max(seats.length, 2);
  const meIndex = seats.findIndex((p) => p.id === meId);
  const rotate = meIndex >= 0 ? (Math.floor(total / 2) - meIndex + total) % total : 0;

  const me = seats.find((p) => p.id === meId) ?? null;
  const [betTo, setBetTo] = useState<number>(0);

  useEffect(() => {
    if (legal) {
      setBetTo(legal.minRaiseTo || state.bigBlind);
    }
  }, [legal, state.bigBlind, state.handNumber, state.phase]);

  const myTurn = me !== null && state.currentPlayerSeat === me.seat;

  // Winner banner — delayed until per-seat showdown reveals finish
  const [banner, setBanner] = useState<{ lines: { title: string; sub: string }[] } | null>(null);
  const shownHandRef = useRef<number>(-1);
  useEffect(() => {
    if (!state.showdown || state.showdown.length === 0) return;
    if (shownHandRef.current === state.handNumber) return;
    shownHandRef.current = state.handNumber;

    // Count players whose cards are being revealed (excluding me)
    const revealed = state.players.filter(
      (p) => p.holeCards.length === 2 && p.id !== meId && p.status !== PlayerStatus.FOLDED
    ).length;
    const perPlayer = meta?.pacing?.showdownRevealPerPlayerMs ?? 700;
    const extra = meta?.pacing?.showdownExtraForBannerMs ?? 400;
    const revealDelay = revealed * perPlayer + extra;

    // Group winners by potIndex so split/side pots show correctly
    const grouped = new Map<number, { players: string[]; amount: number; handName: string }>();
    for (const w of state.showdown) {
      const key = w.potIndex ?? 0;
      const p = state.players.find((x) => x.id === w.playerId);
      const cur = grouped.get(key) ?? { players: [], amount: 0, handName: w.handName };
      cur.players.push(p?.username ?? 'Winner');
      cur.amount += w.amount;
      cur.handName = w.handName;
      grouped.set(key, cur);
    }
    const lines = [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, v]) => ({
        title: `${v.players.join(' & ')} wins ${formatCurrency(v.amount, { showSign: true })}${grouped.size > 1 ? (idx === 0 ? ' · main pot' : ` · side pot ${idx}`) : ''}`,
        sub: v.handName,
      }));

    const showT = setTimeout(() => setBanner({ lines }), revealDelay);
    const hideT = setTimeout(() => setBanner(null), revealDelay + 3200);
    return () => { clearTimeout(showT); clearTimeout(hideT); };
  }, [state.handNumber, state.showdown, state.players, meId, meta]);

  function send(type: ActionType, amount?: number) {
    getSocket().emit('game:action', { lobbyId, type, amount });
  }
  function rebuy() { getSocket().emit('game:rebuy', { lobbyId }); }
  function sitOut(v: boolean) { getSocket().emit('game:sitout', { lobbyId, sitOut: v }); }
  function leaveTable() {
    if (!confirm('Leave the table? Your current stack will be recorded as your cash-out.')) return;
    getSocket().emit('game:leaveTable', { lobbyId });
  }
  function endGame() {
    if (!confirm('End the game for everyone? Final stacks will be persisted.')) return;
    getSocket().emit('game:end', { lobbyId });
  }

  // Blind timer
  const [nextBlindLocalMs, setNextBlindLocalMs] = useState<number | null>(null);
  useEffect(() => { setNextBlindLocalMs(meta?.nextBlindMs ?? null); }, [meta?.nextBlindMs, state.handNumber]);
  const blindRem = useCountdown(nextBlindLocalMs);
  const blindLabel = nextBlindLocalMs ? `${Math.floor(blindRem / 60000).toString().padStart(2, '0')}:${Math.floor((blindRem / 1000) % 60).toString().padStart(2, '0')}` : null;

  // Bust panel for me
  const myLobbyPlayer = null; // fed via lobby snapshot elsewhere; we detect bust via engine chips
  const iAmBust = me ? me.chips <= 0 && state.phase !== 'HAND_COMPLETE' && !state.players.some((p) => p.id === meId && p.status === PlayerStatus.ACTIVE) : false;

  return (
    <div className="card-panel relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm text-ink-500">
          Hand #{state.handNumber} · <span className="text-brass-400">{state.phase}</span>
        </div>
        <div className="text-sm text-ink-500 flex items-center gap-3">
          <span>SB {formatCurrency(state.smallBlind)} / BB {formatCurrency(state.bigBlind)}</span>
          {meta?.nextSmallBlind && (
            <span className="text-brass-400">
              next {formatCurrency(meta.nextSmallBlind)}/{formatCurrency(meta.nextBigBlind ?? 0)}
              {blindLabel && ` in ${blindLabel}`}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="relative aspect-[16/10] felt rounded-[45%_/_30%] mx-auto max-w-4xl">
        {/* Pot + community */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="chip px-3 py-1 text-sm">Pot {formatCurrency(state.pot)}</div>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={`${state.handNumber}-${i}`}
                className={clsx(state.community[i] && 'card-appear')}
                style={{ animationDelay: `${i * 220}ms` }}
              >
                <PlayingCard card={state.community[i]} size="md" hidden={!state.community[i]} />
              </div>
            ))}
          </div>
        </div>

        {/* Seats */}
        {seats.map((p, idx) => {
          const uiIdx = (idx + rotate) % total;
          const pos = seatPos(uiIdx, total);
          const isCurrent = state.currentPlayerSeat === p.seat;
          const isDealer = state.dealerSeat === p.seat;
          const win = state.showdown?.find((w) => w.playerId === p.id);
          const showAtShowdown = (state.phase === 'SHOWDOWN' || state.phase === 'HAND_COMPLETE') && p.holeCards.length === 2;
          return (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-500"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <div className={clsx(
                'rounded-xl px-2 py-1 min-w-[132px] text-center border transition',
                isCurrent ? 'border-brass-400 shadow-[0_0_18px_rgba(212,175,81,.55)]' : 'border-ink-700',
                'bg-ink-900/80 backdrop-blur',
                (p.status === PlayerStatus.FOLDED) && 'opacity-40',
                win && 'ring-2 ring-brass-400'
              )}>
                <div className="flex items-center gap-2">
                  <AvatarBadge id={p.avatar} size={28} />
                  <div className="text-left flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{p.username}</div>
                    <div className="text-[10px] text-brass-400">{formatCurrency(p.chips)}</div>
                  </div>
                  {isDealer && (
                    <div className="text-[10px] font-bold bg-white text-black rounded-full w-5 h-5 flex items-center justify-center">D</div>
                  )}
                </div>
                <div className="mt-1 flex justify-center gap-1 min-h-[44px]">
                  {p.id === meId ? (
                    [0, 1].map((i) => (
                      <div
                        key={`${state.handNumber}-me-${i}`}
                        className={clsx(p.holeCards[i] && 'card-appear')}
                        style={{ animationDelay: `${i * 250 + idx * 90}ms` }}
                      >
                        <PlayingCard card={p.holeCards[i]} size="sm" hidden={!p.holeCards[i]} />
                      </div>
                    ))
                  ) : showAtShowdown ? (
                    p.holeCards.map((c, i) => (
                      <div key={i} className="card-appear" style={{ animationDelay: `${i * 200 + idx * 300}ms` }}>
                        <PlayingCard card={c} size="sm" />
                      </div>
                    ))
                  ) : p.status !== PlayerStatus.FOLDED ? (
                    [0, 1].map((i) => (
                      <div
                        key={`${state.handNumber}-${p.id}-${i}`}
                        className="card-appear"
                        style={{ animationDelay: `${i * 250 + idx * 90}ms` }}
                      >
                        <PlayingCard size="sm" hidden />
                      </div>
                    ))
                  ) : null}
                </div>
                {p.currentBet > 0 && (
                  <div className="mt-1 chip inline-block px-2 py-0.5 text-[10px]">{formatCurrency(p.currentBet)}</div>
                )}
                {p.status === PlayerStatus.ALL_IN && <div className="text-[10px] text-red-400 mt-1">ALL-IN</div>}
                {win && <div className="text-[10px] text-brass-400 mt-1">{formatCurrency(win.amount, { showSign: true })}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Winner banner (per pot, split-pot aware) */}
      {banner && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none z-30">
          <div className="rounded-2xl bg-black/70 border border-brass-500/70 backdrop-blur px-8 py-4 text-center shadow-2xl banner-in space-y-1">
            {banner.lines.map((l, i) => (
              <div key={i}>
                <div className="text-2xl font-display brass-text">{l.title}</div>
                <div className="text-sm text-white/70">{l.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action panel */}
      <div className="mt-4 flex flex-wrap items-center gap-2 justify-center min-h-[52px]">
        {myTurn && legal ? (
          <>
            {legal.actions.includes(ActionType.FOLD) && (
              <button className="btn btn-danger" onClick={() => send(ActionType.FOLD)}>Fold</button>
            )}
            {legal.actions.includes(ActionType.CHECK) && (
              <button className="btn" onClick={() => send(ActionType.CHECK)}>Check</button>
            )}
            {legal.actions.includes(ActionType.CALL) && (
              <button className="btn" onClick={() => send(ActionType.CALL)}>Call {formatCurrency(legal.callAmount)}</button>
            )}
            {(legal.actions.includes(ActionType.BET) || legal.actions.includes(ActionType.RAISE)) && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={legal.minRaiseTo}
                  max={legal.maxBetTo}
                  value={Math.max(legal.minRaiseTo, Math.min(betTo, legal.maxBetTo))}
                  onChange={(e) => setBetTo(Number(e.target.value))}
                  className="w-40"
                />
                <input
                  type="number"
                  className="input w-28"
                  min={legal.minRaiseTo}
                  max={legal.maxBetTo}
                  value={betTo}
                  onChange={(e) => setBetTo(Number(e.target.value))}
                />
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    send(legal.actions.includes(ActionType.BET) ? ActionType.BET : ActionType.RAISE, betTo)
                  }
                >
                  {legal.actions.includes(ActionType.BET) ? `Bet ${formatCurrency(betTo)}` : `Raise to ${formatCurrency(betTo)}`}
                </button>
                <div className="flex gap-1">
                  {[
                    { l: '½', v: Math.max(legal.minRaiseTo, Math.floor(state.pot / 2)) },
                    { l: '¾', v: Math.max(legal.minRaiseTo, Math.floor((state.pot * 3) / 4)) },
                    { l: 'Pot', v: Math.max(legal.minRaiseTo, state.pot) },
                  ].map((b) => (
                    <button key={b.l} className="btn text-xs px-2 py-1" onClick={() => setBetTo(Math.min(b.v, legal.maxBetTo))}>{b.l}</button>
                  ))}
                </div>
              </div>
            )}
            {legal.actions.includes(ActionType.ALL_IN) && (
              <button className="btn" onClick={() => send(ActionType.ALL_IN)}>All-in</button>
            )}
          </>
        ) : (
          <div className="text-ink-500 text-sm">
            {state.phase === 'WAITING'
              ? 'Waiting for at least 2 funded players…'
              : state.currentPlayerSeat === null
                ? 'Waiting for next hand…'
                : `${state.players.find((p) => p.seat === state.currentPlayerSeat)?.username ?? 'Player'} is thinking…`}
          </div>
        )}
      </div>

      {/* Table controls */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button className="btn text-xs" onClick={() => sitOut(true)}>Sit out</button>
        <button className="btn text-xs" onClick={() => sitOut(false)}>Return to seat</button>
        <button className="btn btn-danger text-xs" onClick={leaveTable}>Leave table</button>
        {isHost && (
          <button className="btn btn-danger text-xs" onClick={endGame}>End game</button>
        )}
      </div>

      {/* Rebuy overlay */}
      {iAmBust && meta?.gameType === 'CASH' && (
        <div className="absolute inset-x-0 bottom-16 flex justify-center z-30">
          <div className="rounded-xl bg-black/80 border border-brass-500/70 px-5 py-3 flex items-center gap-3">
            <div className="text-sm">You are out of chips.</div>
            {meta.allowRebuy && (
              <button className="btn btn-primary text-xs" onClick={rebuy}>
                Rebuy {formatCurrency(meta.startingStack)}
              </button>
            )}
            <button className="btn text-xs" onClick={() => sitOut(true)}>Sit out</button>
            <button className="btn btn-danger text-xs" onClick={leaveTable}>Leave</button>
          </div>
        </div>
      )}

      {/* Hand history */}
      <details className="mt-4 text-xs text-ink-500">
        <summary className="cursor-pointer">Hand history</summary>
        <div className="max-h-48 overflow-y-auto mt-2 space-y-1">
          {state.history.map((h, i) => <div key={i}>{h}</div>)}
        </div>
      </details>
    </div>
  );
}
