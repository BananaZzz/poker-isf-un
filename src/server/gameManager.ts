import type { Server, Socket } from 'socket.io';
import { prisma } from '@/lib/db';
import {
  createInitialState,
  startNewHand,
  applyAction,
  timeoutAction,
  legalActions,
  redactStateFor,
  dealNextStreet,
} from '@/game/engine';
import { GamePhase, PlayerStatus, ActionType, type GameState } from '@/game/types';
import { attributePotFlows } from '@/game/attribution';
import { nextBlindLevel } from '@/lib/money';
import { ensureGameSession, closeGameSession, finalizePlayer } from './accounting';
import { finalizeSettlement } from './settlement';
import { PACING } from './pacing';

interface RoomRuntime {
  lobbyId: string;
  sessionId: string | null;
  state: GameState;
  timer: NodeJS.Timeout | null;
  nextHandTimer: NodeJS.Timeout | null;
  blindTimer: NodeJS.Timeout | null;
  runoutTimer: NodeJS.Timeout | null;
  currentRunoutHand: number; // hand number the current pacing timers belong to
  currentRunoutToken: number; // bumped whenever a new hand starts so stale timers noop
  actionTimerMs: number;
  gameType: 'CASH' | 'TOURNAMENT';
  allowRebuy: boolean;
  startingStack: number;
  blindsIncrease: boolean;
  blindMultiplier: number | null;
  blindIntervalSec: number | null;
  currentSmallBlind: number;
  currentBigBlind: number;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  nextBlindDeadline: number | null;
  pendingBlindLevel: { sb: number; bb: number } | null;
  connectedUsers: Set<string>;
  handsPlayed: number;
  // set of userIds whose participant row has already been finalized (idempotency guard)
  finalizedUsers: Set<string>;
  // ids of hands whose pot flows we've already persisted (idempotency guard)
  persistedHands: Set<number>;
}

const rooms = new Map<string, RoomRuntime>();

async function loadLobby(lobbyId: string) {
  return prisma.lobby.findUnique({
    where: { id: lobbyId },
    include: { players: { include: { user: true }, orderBy: { seat: 'asc' } } },
  });
}

function computeMeta(room: RoomRuntime) {
  const nextBlindMs = room.nextBlindDeadline ? Math.max(0, room.nextBlindDeadline - Date.now()) : null;
  return {
    currentSmallBlind: room.currentSmallBlind,
    currentBigBlind: room.currentBigBlind,
    nextSmallBlind: room.nextSmallBlind,
    nextBigBlind: room.nextBigBlind,
    nextBlindMs,
    allowRebuy: room.allowRebuy,
    startingStack: room.startingStack,
    gameType: room.gameType,
    lobbyId: room.lobbyId,
    pacing: PACING,
  };
}

function broadcast(io: Server, room: RoomRuntime) {
  const meta = computeMeta(room);
  io.to(room.lobbyId).fetchSockets().then((sockets) => {
    for (const s of sockets) {
      const userId = (s.data as any).userId as string | undefined;
      const redacted = redactStateFor(room.state, userId ?? null);
      const player = room.state.players.find((p) => p.id === userId);
      const legal = player
        ? legalActions(room.state, player.id)
        : { actions: [], callAmount: 0, minRaiseTo: 0, maxBetTo: 0 };
      s.emit('state', { state: redacted, legal, meta });
    }
  });
}

function scheduleAutoAction(io: Server, room: RoomRuntime) {
  if (room.timer) clearTimeout(room.timer);
  const seat = room.state.currentPlayerSeat;
  if (seat === null) return;
  const player = room.state.players.find((p) => p.seat === seat);
  if (!player) return;
  const token = room.currentRunoutToken;
  room.timer = setTimeout(() => {
    if (token !== room.currentRunoutToken) return;
    try {
      room.state = timeoutAction(room.state, player.id);
      afterActionOrPhase(io, room);
    } catch { /* ignore */ }
  }, room.actionTimerMs + 500);
}

function afterActionOrPhase(io: Server, room: RoomRuntime) {
  broadcast(io, room);
  if (room.state.phase === GamePhase.HAND_COMPLETE) {
    if (room.timer) clearTimeout(room.timer);
    finishHand(io, room).catch(() => {});
    return;
  }
  if (room.state.runoutPending) {
    // server-paced runout: no player can act — reveal next street on a timer
    scheduleRunout(io, room);
    return;
  }
  if (room.state.currentPlayerSeat !== null) {
    scheduleAutoAction(io, room);
  }
}

function scheduleRunout(io: Server, room: RoomRuntime) {
  if (room.runoutTimer) clearTimeout(room.runoutTimer);
  const token = room.currentRunoutToken;
  const hand = room.state.handNumber;
  // pick delay based on the phase we're about to move to
  const delay =
    room.state.phase === GamePhase.PRE_FLOP ? PACING.runoutBeforeFlopMs :
    room.state.phase === GamePhase.RIVER ? PACING.runoutBeforeShowdownMs :
    PACING.runoutBetweenBoardMs;
  room.runoutTimer = setTimeout(() => {
    if (token !== room.currentRunoutToken) return;
    if (room.state.handNumber !== hand) return;
    // reset per-round state manually (dealNextStreet doesn't do it) — mirror engine's advanceRound reset
    for (const p of room.state.players) { p.currentBet = 0; p.hasActedThisRound = false; }
    room.state.currentBet = 0;
    room.state.minRaise = room.state.bigBlind;
    room.state.lastRaiseAmount = room.state.bigBlind;
    room.state.lastAggressorSeat = null;
    room.state = dealNextStreet(room.state);
    afterActionOrPhase(io, room);
  }, delay);
}

async function finishHand(io: Server, room: RoomRuntime) {
  const hand = room.state.handNumber;
  if (!room.persistedHands.has(hand)) {
    room.persistedHands.add(hand);
    room.handsPlayed += 1;
    // persist stacks + bust
    const lobby = await prisma.lobby.findUnique({ where: { id: room.lobbyId }, include: { players: true } });
    if (lobby) {
      const activeStacks: { userId: string; chips: number; lp: typeof lobby.players[number] }[] = [];
      for (const sp of room.state.players) {
        const lp = lobby.players.find((x) => x.userId === sp.id);
        if (!lp) continue;
        const wasFunded = lp.chips > 0;
        const nowBusted = sp.chips <= 0;
        const eliminating = wasFunded && nowBusted;
        await prisma.lobbyPlayer.update({
          where: { id: lp.id },
          data: {
            chips: sp.chips,
            bustedOut: nowBusted ? true : lp.bustedOut,
            ...(room.gameType === 'TOURNAMENT' && eliminating && !lp.placement
              ? {
                  eliminatedAt: new Date(),
                  eliminatedHand: hand,
                  // temporary placement = count of still-funded participants +1 (fills bottom-up)
                }
              : {}),
          },
        });
        activeStacks.push({ userId: sp.id, chips: sp.chips, lp });
      }
      // Tournament placement: eliminated this hand get placement = (fundedRemaining + 1..N)
      if (room.gameType === 'TOURNAMENT') {
        const eliminatedThisHand = activeStacks
          .filter((x) => x.chips <= 0 && !x.lp.placement && x.lp.chips > 0)
          .map((x) => x.userId);
        // Note: after our update above lp.chips still shows the OLD value from the initial fetch
        if (eliminatedThisHand.length > 0) {
          const stillFunded = activeStacks.filter((x) => x.chips > 0).length;
          // If multiple players bust in the same hand, they share the placements after the top;
          // assign highest placement (largest number) to whoever finished the hand with the least
          // — for MVP we assign them all the same "tied" placement = stillFunded + 1.
          for (const uid of eliminatedThisHand) {
            const lp = activeStacks.find((x) => x.userId === uid)!.lp;
            await prisma.lobbyPlayer.update({ where: { id: lp.id }, data: { placement: stillFunded + 1 } });
          }
        }
      }
    }
    // persist pot flows → HandTransfer
    if (room.sessionId && room.state.potFlows && room.state.potFlows.length > 0) {
      const transfers = attributePotFlows(room.state.potFlows);
      if (transfers.length > 0) {
        await prisma.handTransfer.createMany({
          data: transfers.map((t) => ({
            sessionId: room.sessionId!,
            handNumber: hand,
            potIndex: t.potIndex,
            fromUserId: t.fromUserId,
            toUserId: t.toUserId,
            amountCents: t.amount,
          })),
        });
      }
      await prisma.gameSession.update({
        where: { id: room.sessionId },
        data: { handsPlayed: room.handsPlayed },
      });
    }
    // tournament auto-finalize when only one player has chips
    if (room.gameType === 'TOURNAMENT') {
      const funded = (await prisma.lobbyPlayer.count({ where: { lobbyId: room.lobbyId, chips: { gt: 0 } } }));
      if (funded <= 1) {
        // set winner placement = 1
        const last = await prisma.lobbyPlayer.findFirst({ where: { lobbyId: room.lobbyId, chips: { gt: 0 } } });
        if (last) await prisma.lobbyPlayer.update({ where: { id: last.id }, data: { placement: 1 } });
        await autoEndTournament(io, room);
        return;
      }
    }
  }

  // apply pending blind level between hands (never mid-hand)
  if (room.pendingBlindLevel) {
    room.currentSmallBlind = room.pendingBlindLevel.sb;
    room.currentBigBlind = room.pendingBlindLevel.bb;
    room.state.smallBlind = room.currentSmallBlind;
    room.state.bigBlind = room.currentBigBlind;
    room.pendingBlindLevel = null;
    scheduleNextBlindLevel(room);
  }

  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  const tokenForNextHand = room.currentRunoutToken;
  room.nextHandTimer = setTimeout(() => {
    if (tokenForNextHand !== room.currentRunoutToken) return;
    startNext(io, room);
  }, PACING.betweenHandsMs);
}

function scheduleNextBlindLevel(room: RoomRuntime) {
  if (!room.blindsIncrease || !room.blindMultiplier || !room.blindIntervalSec) {
    room.nextSmallBlind = null;
    room.nextBigBlind = null;
    room.nextBlindDeadline = null;
    return;
  }
  const nxt = nextBlindLevel(room.currentSmallBlind, room.blindMultiplier);
  room.nextSmallBlind = nxt.smallBlind;
  room.nextBigBlind = nxt.bigBlind;
  room.nextBlindDeadline = Date.now() + room.blindIntervalSec * 1000;
  if (room.blindTimer) clearTimeout(room.blindTimer);
  room.blindTimer = setTimeout(() => {
    room.pendingBlindLevel = { sb: nxt.smallBlind, bb: nxt.bigBlind };
  }, room.blindIntervalSec * 1000);
}

async function rebuildEngineFromDb(room: RoomRuntime) {
  const lobby = await loadLobby(room.lobbyId);
  if (!lobby) return;
  const seats = lobby.players
    .filter((p) => p.chips > 0 && !p.sittingOut)
    .map((p) => ({
      id: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      avatarUpdatedAt: p.user.avatarUpdatedAt?.getTime() ?? null,
      seat: p.seat,
      chips: p.chips,
    }));
  const preservedHand = room.state.handNumber;
  room.state = createInitialState(seats, {
    smallBlind: room.currentSmallBlind,
    bigBlind: room.currentBigBlind,
    actionTimerMs: room.actionTimerMs,
  });
  room.state.handNumber = preservedHand;
}

async function startNext(io: Server, room: RoomRuntime) {
  await rebuildEngineFromDb(room);
  const funded = room.state.players.filter((p) => p.chips > 0);
  if (funded.length < 2) {
    room.state.phase = GamePhase.WAITING;
    room.state.currentPlayerSeat = null;
    room.state.showdown = null;
    room.state.runoutPending = false;
    broadcast(io, room);
    return;
  }
  room.currentRunoutToken += 1;
  room.state = startNewHand(room.state);
  broadcast(io, room);
  scheduleAutoAction(io, room);
}

export async function startGame(io: Server, lobbyId: string, byUserId: string) {
  const lobby = await loadLobby(lobbyId);
  if (!lobby) throw new Error('not found');
  if (lobby.hostId !== byUserId) throw new Error('only host may start');
  if (lobby.players.length < 2) throw new Error('need at least 2 players');
  await prisma.lobby.update({ where: { id: lobbyId }, data: { status: 'RUNNING' } });

  for (const lp of lobby.players) {
    if (lp.initialBuyIn === 0) {
      await prisma.lobbyPlayer.update({
        where: { id: lp.id },
        data: { initialBuyIn: lobby.startingStack, chips: lobby.startingStack, bustedOut: false, sittingOut: false },
      });
    }
  }
  const sessionId = await ensureGameSession({
    lobbyId,
    name: lobby.name,
    gameType: lobby.gameType,
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
  });

  const previous = rooms.get(lobbyId);
  const seats = lobby.players.map((p) => ({
    id: p.userId,
    username: p.user.username,
    avatar: p.user.avatar,
    avatarUpdatedAt: p.user.avatarUpdatedAt?.getTime() ?? null,
    seat: p.seat,
    chips: lobby.startingStack,
  }));
  const state = createInitialState(seats, {
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
    actionTimerMs: lobby.actionTimer * 1000,
  });
  const runtime: RoomRuntime = {
    lobbyId,
    sessionId,
    state,
    timer: null,
    nextHandTimer: null,
    blindTimer: null,
    runoutTimer: null,
    currentRunoutHand: 0,
    currentRunoutToken: 0,
    actionTimerMs: lobby.actionTimer * 1000,
    gameType: (lobby.gameType as 'CASH' | 'TOURNAMENT'),
    allowRebuy: lobby.gameType === 'TOURNAMENT' ? false : lobby.allowRebuy,
    startingStack: lobby.startingStack,
    blindsIncrease: lobby.blindsIncrease,
    blindMultiplier: lobby.blindMultiplier ?? null,
    blindIntervalSec: lobby.blindIntervalSec ?? null,
    currentSmallBlind: lobby.smallBlind,
    currentBigBlind: lobby.bigBlind,
    nextSmallBlind: null,
    nextBigBlind: null,
    nextBlindDeadline: null,
    pendingBlindLevel: null,
    connectedUsers: previous?.connectedUsers ?? new Set(),
    handsPlayed: 0,
    finalizedUsers: new Set(),
    persistedHands: new Set(),
  };
  rooms.set(lobbyId, runtime);
  scheduleNextBlindLevel(runtime);
  runtime.currentRunoutToken += 1;
  runtime.state = startNewHand(runtime.state);
  broadcast(io, runtime);
  scheduleAutoAction(io, runtime);
}

export async function handlePlayerAction(
  io: Server,
  lobbyId: string,
  userId: string,
  action: { type: ActionType; amount?: number }
) {
  const room = rooms.get(lobbyId);
  if (!room) throw new Error('game not running');
  const state = room.state;
  const p = state.players.find((x) => x.id === userId);
  if (!p) throw new Error('not in game');
  if (state.currentPlayerSeat !== p.seat) throw new Error('not your turn');
  const legal = legalActions(state, userId);
  if (!legal.actions.includes(action.type)) throw new Error('illegal action');
  room.state = applyAction(state, userId, action);
  afterActionOrPhase(io, room);
}

// Rebuy request idempotency: at most one rebuy per lobby+user per bust cycle
const rebuyLocks = new Map<string, number>();
export async function handleRebuy(io: Server, lobbyId: string, userId: string) {
  const key = `${lobbyId}:${userId}`;
  const now = Date.now();
  const last = rebuyLocks.get(key);
  if (last !== undefined && now - last < 1500) return; // debounce duplicate socket clicks
  rebuyLocks.set(key, now);

  const room = rooms.get(lobbyId);
  const lobby = await prisma.lobby.findUnique({ where: { id: lobbyId }, include: { players: true } });
  if (!lobby) throw new Error('not found');
  if (lobby.gameType !== 'CASH') throw new Error('rebuys only in cash games');
  if (!lobby.allowRebuy) throw new Error('rebuy not allowed');
  const lp = lobby.players.find((p) => p.userId === userId);
  if (!lp) throw new Error('not in lobby');
  if (lp.chips > 0) throw new Error('you still have chips');
  await prisma.lobbyPlayer.update({
    where: { id: lp.id },
    data: {
      chips: lobby.startingStack,
      totalRebuys: lp.totalRebuys + lobby.startingStack,
      bustedOut: false,
      sittingOut: false,
    },
  });
  if (room && room.state.phase === GamePhase.WAITING) {
    await startNext(io, room);
  } else if (room) {
    broadcast(io, room);
  }
}

/**
 * Voluntary card reveal after an uncontested win. Server-authoritative:
 *  - hand must be complete
 *  - the hand must NOT have been a mandatory showdown (rules already exposed those cards)
 *  - only the card owner may reveal their own hole cards
 *  - hand number must match to reject stale-hand payloads
 *  - user must be a real player in this room
 * The state.voluntaryReveals list is mutated in place and re-broadcast; the
 * engine's redactStateFor honours it. State resets on the next startNewHand.
 */
export async function handleRevealCards(
  io: Server,
  lobbyId: string,
  userId: string,
  handNumber: number
) {
  const room = rooms.get(lobbyId);
  if (!room) throw new Error('game not running');
  if (room.state.phase !== GamePhase.HAND_COMPLETE) throw new Error('hand not complete');
  if (room.state.mandatoryShowdown) throw new Error('cards already shown by showdown');
  if (room.state.handNumber !== handNumber) throw new Error('stale hand');
  const player = room.state.players.find((p) => p.id === userId);
  if (!player) throw new Error('not at this table');
  if (player.holeCards.length === 0) throw new Error('no cards to reveal');
  if (!room.state.voluntaryReveals.includes(userId)) {
    room.state.voluntaryReveals = [...room.state.voluntaryReveals, userId];
  }
  broadcast(io, room);
}

export async function handleSitOut(io: Server, lobbyId: string, userId: string, sitOut: boolean) {
  await prisma.lobbyPlayer.updateMany({ where: { lobbyId, userId }, data: { sittingOut: sitOut } });
  const room = rooms.get(lobbyId);
  if (room) broadcast(io, room);
}

export async function handleLeaveTable(io: Server, lobbyId: string, userId: string) {
  const room = rooms.get(lobbyId);
  const lobby = await prisma.lobby.findUnique({ where: { id: lobbyId }, include: { players: true } });
  if (!lobby) throw new Error('not found');
  const lp = lobby.players.find((p) => p.userId === userId);
  if (!lp) throw new Error('not in lobby');
  if (room && room.sessionId && !room.finalizedUsers.has(userId)) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await finalizePlayer({
        sessionId: room.sessionId,
        userId,
        username: user.username,
        initialBuyIn: lp.initialBuyIn,
        totalRebuys: lp.totalRebuys,
        cashOutStack: lp.chips,
        placement: lp.placement ?? null,
      });
      room.finalizedUsers.add(userId);
    }
  }
  await prisma.lobbyPlayer.delete({ where: { id: lp.id } });
  if (room) {
    if (room.state.currentPlayerSeat !== null) {
      const p = room.state.players.find((x) => x.id === userId);
      if (p && room.state.currentPlayerSeat === p.seat) {
        try { room.state = applyAction(room.state, userId, { type: ActionType.FOLD }); } catch { /* ignore */ }
      }
    }
    await startNext(io, room);
  }
  await broadcastLobby(io, lobbyId);
}

async function autoEndTournament(io: Server, room: RoomRuntime) {
  const lobby = await prisma.lobby.findUnique({ where: { id: room.lobbyId }, include: { players: true } });
  if (!lobby) return;
  const sessionId = room.sessionId;
  if (sessionId) {
    for (const lp of lobby.players) {
      if (room.finalizedUsers.has(lp.userId)) continue;
      const user = await prisma.user.findUnique({ where: { id: lp.userId } });
      if (!user) continue;
      await finalizePlayer({
        sessionId,
        userId: lp.userId,
        username: user.username,
        initialBuyIn: lp.initialBuyIn,
        totalRebuys: lp.totalRebuys,
        cashOutStack: lp.chips,
        placement: lp.placement ?? null,
      });
      room.finalizedUsers.add(lp.userId);
    }
    // tourneyWins ++ for placement=1
    const winner = lobby.players.find((p) => p.placement === 1);
    if (winner) {
      await prisma.user.update({ where: { id: winner.userId }, data: { tourneyWins: { increment: 1 } } });
    }
    await closeGameSession(sessionId, room.handsPlayed);
    // Settlement is only computed for CASH sessions; call is a no-op for tournaments.
    await finalizeSettlement(sessionId);
  }
  await prisma.lobby.update({ where: { id: room.lobbyId }, data: { status: 'FINISHED', finishedAt: new Date() } });
  if (room.timer) clearTimeout(room.timer);
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  if (room.blindTimer) clearTimeout(room.blindTimer);
  if (room.runoutTimer) clearTimeout(room.runoutTimer);
  rooms.delete(room.lobbyId);
  io.to(room.lobbyId).emit('session:ended', { lobbyId: room.lobbyId, sessionId });
  await broadcastLobby(io, room.lobbyId);
}

export async function handleEndGame(io: Server, lobbyId: string, byUserId: string) {
  const room = rooms.get(lobbyId);
  const lobby = await prisma.lobby.findUnique({ where: { id: lobbyId }, include: { players: true } });
  if (!lobby) throw new Error('not found');
  if (lobby.hostId !== byUserId) throw new Error('only host may end game');
  if (room?.timer) clearTimeout(room.timer);
  if (room?.nextHandTimer) clearTimeout(room.nextHandTimer);
  if (room?.blindTimer) clearTimeout(room.blindTimer);
  if (room?.runoutTimer) clearTimeout(room.runoutTimer);
  if (room) room.currentRunoutToken += 1;

  const sessionId = room?.sessionId ?? null;
  if (sessionId && room) {
    for (const lp of lobby.players) {
      if (room.finalizedUsers.has(lp.userId)) continue;
      const user = await prisma.user.findUnique({ where: { id: lp.userId } });
      if (!user) continue;
      await finalizePlayer({
        sessionId,
        userId: lp.userId,
        username: user.username,
        initialBuyIn: lp.initialBuyIn,
        totalRebuys: lp.totalRebuys,
        cashOutStack: lp.chips,
        placement: lp.placement ?? null,
      });
      room.finalizedUsers.add(lp.userId);
    }
    await closeGameSession(sessionId, room.handsPlayed);
    await finalizeSettlement(sessionId);
  }
  await prisma.lobby.update({ where: { id: lobbyId }, data: { status: 'FINISHED', finishedAt: new Date() } });
  if (room) rooms.delete(lobbyId);
  io.to(lobbyId).emit('session:ended', { lobbyId, sessionId });
  await broadcastLobby(io, lobbyId);
}

export function joinRoom(io: Server, socket: Socket, lobbyId: string) {
  socket.join(lobbyId);
  const room = rooms.get(lobbyId);
  if (room) {
    room.connectedUsers.add((socket.data as any).userId);
    const userId = (socket.data as any).userId as string | undefined;
    const redacted = redactStateFor(room.state, userId ?? null);
    const player = room.state.players.find((p) => p.id === userId);
    const legal = player ? legalActions(room.state, player.id) : { actions: [], callAmount: 0, minRaiseTo: 0, maxBetTo: 0 };
    const meta = computeMeta(room);
    socket.emit('state', { state: redacted, legal, meta });
  }
}

export function leaveRoom(_io: Server, socket: Socket, lobbyId: string) {
  socket.leave(lobbyId);
  const room = rooms.get(lobbyId);
  if (room) room.connectedUsers.delete((socket.data as any).userId);
}

const chatLogs = new Map<string, { user: string; text: string; at: number }[]>();

export function chat(io: Server, lobbyId: string, username: string, text: string) {
  const trimmed = text.trim().slice(0, 300);
  if (!trimmed) return;
  const log = chatLogs.get(lobbyId) ?? [];
  log.push({ user: username, text: trimmed, at: Date.now() });
  if (log.length > 50) log.shift();
  chatLogs.set(lobbyId, log);
  io.to(lobbyId).emit('chat', { user: username, text: trimmed, at: Date.now() });
}

export function getChat(lobbyId: string) {
  return chatLogs.get(lobbyId) ?? [];
}

export async function toggleReady(io: Server, lobbyId: string, userId: string, ready: boolean) {
  await prisma.lobbyPlayer.updateMany({ where: { lobbyId, userId }, data: { ready } });
  await broadcastLobby(io, lobbyId);
}

export async function broadcastLobby(io: Server, lobbyId: string) {
  const lobby = await loadLobby(lobbyId);
  if (!lobby) return;
  io.to(`lobby:${lobbyId}`).emit('lobby', {
    id: lobby.id,
    name: lobby.name,
    status: lobby.status,
    hostId: lobby.hostId,
    inviteCode: lobby.inviteCode,
    maxPlayers: lobby.maxPlayers,
    gameType: lobby.gameType,
    startingStack: lobby.startingStack,
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
    allowRebuy: lobby.gameType === 'TOURNAMENT' ? false : lobby.allowRebuy,
    blindsIncrease: lobby.blindsIncrease,
    blindMultiplier: lobby.blindMultiplier,
    blindIntervalSec: lobby.blindIntervalSec,
    players: lobby.players.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      avatarUrl: p.user.avatarUrl,
      avatarUpdatedAt: p.user.avatarUpdatedAt?.getTime() ?? null,
      seat: p.seat,
      ready: p.ready,
      chips: p.chips,
      initialBuyIn: p.initialBuyIn,
      totalRebuys: p.totalRebuys,
      bustedOut: p.bustedOut,
      sittingOut: p.sittingOut,
      placement: p.placement,
    })),
  });
}
