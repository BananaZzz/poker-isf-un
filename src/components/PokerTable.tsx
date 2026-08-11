'use client';
import { useMemo, useState, useEffect } from 'react';
import clsx from 'clsx';
import { AvatarBadge } from './AvatarPicker';
import { PlayingCard } from './PlayingCard';
import { getSocket } from '@/lib/socketClient';

// mirrors src/game/types.ts
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
  showdown: { playerId: string; amount: number; handName: string }[] | null;
  history: string[];
  actionDeadline: number | null;
}
interface Legal {
  actions: ActionType[];
  callAmount: number;
  minRaiseTo: number;
  maxBetTo: number;
}

// arrange seats around an oval; positions given for max 10
function seatPos(seatIndex: number, total: number): { x: number; y: number } {
  // radial layout
  const angle = (Math.PI * 2 * seatIndex) / total - Math.PI / 2;
  const rx = 42; // percent
  const ry = 36;
  return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) };
}

export function PokerTable({ state, legal, meId, lobbyId }: { state: GameState; legal: Legal | null; meId: string; lobbyId: string }) {
  const seats = state.players.slice().sort((a, b) => a.seat - b.seat);
  const total = Math.max(seats.length, 2);
  // rotate seat indices so meId is at bottom (index that maps to angle Math.PI/2 => seat count/2)
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

  function send(type: ActionType, amount?: number) {
    getSocket().emit('game:action', { lobbyId, type, amount });
  }

  const showdownById = useMemo(() => {
    const m = new Map<string, { amount: number; handName: string }>();
    if (state.showdown) for (const w of state.showdown) m.set(w.playerId, { amount: w.amount, handName: w.handName });
    return m;
  }, [state.showdown]);

  return (
    <div className="card-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-ink-500">Hand #{state.handNumber} · <span className="text-brass-400">{state.phase}</span></div>
        <div className="text-sm text-ink-500">SB {state.smallBlind} / BB {state.bigBlind}</div>
      </div>
      <div className="relative aspect-[16/10] felt rounded-[45%_/_30%] mx-auto max-w-4xl">
        {/* pot + community */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="chip px-3 py-1 text-sm">Pot {state.pot.toLocaleString()}</div>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <PlayingCard key={i} card={state.community[i]} size="md" hidden={!state.community[i]} />
            ))}
          </div>
          {state.showdown && (
            <div className="text-center text-sm text-white/90 mt-2">
              {state.showdown.map((w, i) => {
                const p = state.players.find((x) => x.id === w.playerId);
                return (
                  <div key={i}>
                    <span className="brass-text font-semibold">{p?.username}</span> wins {w.amount.toLocaleString()} — {w.handName}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* seats */}
        {seats.map((p, idx) => {
          const uiIdx = (idx + rotate) % total;
          const pos = seatPos(uiIdx, total);
          const isCurrent = state.currentPlayerSeat === p.seat;
          const isDealer = state.dealerSeat === p.seat;
          const win = showdownById.get(p.id);
          return (
            <div
              key={p.id}
              className={clsx(
                'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center',
                'transition-transform duration-500'
              )}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <div className={clsx(
                'rounded-xl px-2 py-1 min-w-[112px] text-center border transition',
                isCurrent ? 'border-brass-400 shadow-[0_0_18px_rgba(212,175,81,.55)]' : 'border-ink-700',
                'bg-ink-900/80 backdrop-blur',
                p.status === PlayerStatus.FOLDED && 'opacity-40'
              )}>
                <div className="flex items-center gap-2">
                  <AvatarBadge id={p.avatar} size={28} />
                  <div className="text-left flex-1">
                    <div className="text-xs font-semibold truncate">{p.username}</div>
                    <div className="text-[10px] text-brass-400">{p.chips.toLocaleString()}</div>
                  </div>
                  {isDealer && <div className="text-[10px] font-bold bg-white text-black rounded-full w-5 h-5 flex items-center justify-center">D</div>}
                </div>
                <div className="mt-1 flex justify-center gap-1">
                  {p.id === meId
                    ? [0, 1].map((i) => <PlayingCard key={i} card={p.holeCards[i]} size="sm" hidden={!p.holeCards[i]} />)
                    : (state.phase === 'SHOWDOWN' || state.phase === 'HAND_COMPLETE') && p.holeCards.length === 2
                      ? p.holeCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
                      : p.status !== PlayerStatus.FOLDED
                        ? [0, 1].map((i) => <PlayingCard key={i} size="sm" hidden />)
                        : null}
                </div>
                {p.currentBet > 0 && (
                  <div className="mt-1 chip inline-block px-2 py-0.5 text-[10px]">{p.currentBet}</div>
                )}
                {p.status === PlayerStatus.ALL_IN && <div className="text-[10px] text-red-400 mt-1">ALL-IN</div>}
                {win && <div className="text-[10px] text-brass-400 mt-1">+{win.amount}</div>}
              </div>
            </div>
          );
        })}
      </div>

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
              <button className="btn" onClick={() => send(ActionType.CALL)}>Call {legal.callAmount}</button>
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
                  className="input w-24"
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
                  {legal.actions.includes(ActionType.BET) ? `Bet ${betTo}` : `Raise to ${betTo}`}
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
            {state.currentPlayerSeat === null
              ? 'Waiting for next hand…'
              : `${state.players.find((p) => p.seat === state.currentPlayerSeat)?.username ?? 'Player'} is thinking…`}
          </div>
        )}
      </div>

      {/* History */}
      <details className="mt-4 text-xs text-ink-500">
        <summary className="cursor-pointer">Hand history</summary>
        <div className="max-h-48 overflow-y-auto mt-2 space-y-1">
          {state.history.map((h, i) => (
            <div key={i}>{h}</div>
          ))}
        </div>
      </details>
    </div>
  );
}
