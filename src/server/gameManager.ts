import type { Server, Socket } from 'socket.io';
import { prisma } from '@/lib/db';
import {
  createInitialState,
  startNewHand,
  applyAction,
  timeoutAction,
  legalActions,
  redactStateFor,
} from '@/game/engine';
import { GamePhase, PlayerStatus, ActionType, type GameState } from '@/game/types';
import { nextBlindLevel } from '@/lib/money';
import { ensureGameSession, closeGameSession, finalizePlayer } from './accounting';

interface RoomRuntime {
  lobbyId: string;
  sessionId: string | null;
  state: GameState;
  timer: NodeJS.Timeout | null;
  nextHandTimer: NodeJS.Timeout | null;
  blindTimer: NodeJS.Timeout | null;
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
}

const rooms = new Map<string, RoomRuntime>();

async function loadLobby(lobbyId: string) {
  return prisma.lobby.findUnique({
    where: { id: lobbyId },
    include: { players: { include: { user: true }, orderBy: { seat: 'asc' } } },
  });
}

function computeNextBlinds(sb: number, mul: number) {
  return nextBlindLevel(sb, mul);
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
  room.timer = setTimeout(() => {
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
  } else if (room.state.currentPlayerSeat !== null) {
    scheduleAutoAction(io, room);
  }
}

async function finishHand(io: Server, room: RoomRuntime) {
  room.handsPlayed += 1;
  // persist stacks + bust status
  const lobby = await prisma.lobby.findUnique({ where: { id: room.lobbyId }, include: { players: true } });
  if (lobby) {
    for (const sp of room.state.players) {
      const lp = lobby.players.find((x) => x.userId === sp.id);
      if (!lp) continue;
      const busted = sp.chips <= 0;
      await prisma.lobbyPlayer.update({
        where: { id: lp.id },
        data: {
          chips: sp.chips,
          bustedOut: busted ? true : lp.bustedOut,
        },
      });
    }
  }
  if (room.sessionId) {
    await prisma.gameSession.update({ where: { id: room.sessionId }, data: { handsPlayed: room.handsPlayed } });
  }

  // apply pending blind level between hands
  if (room.pendingBlindLevel) {
    room.currentSmallBlind = room.pendingBlindLevel.sb;
    room.currentBigBlind = room.pendingBlindLevel.bb;
    room.state.smallBlind = room.currentSmallBlind;
    room.state.bigBlind = room.currentBigBlind;
    room.pendingBlindLevel = null;
    scheduleNextBlindLevel(room);
  }

  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  room.nextHandTimer = setTimeout(() => startNext(io, room), 4500);
}

function scheduleNextBlindLevel(room: RoomRuntime) {
  if (!room.blindsIncrease || !room.blindMultiplier || !room.blindIntervalSec) {
    room.nextSmallBlind = null;
    room.nextBigBlind = null;
    room.nextBlindDeadline = null;
    return;
  }
  const nxt = computeNextBlinds(room.currentSmallBlind, room.blindMultiplier);
  room.nextSmallBlind = nxt.smallBlind;
  room.nextBigBlind = nxt.bigBlind;
  room.nextBlindDeadline = Date.now() + room.blindIntervalSec * 1000;
  if (room.blindTimer) clearTimeout(room.blindTimer);
  room.blindTimer = setTimeout(() => {
    // enqueue the level; it applies after current hand
    room.pendingBlindLevel = { sb: nxt.smallBlind, bb: nxt.bigBlind };
  }, room.blindIntervalSec * 1000);
}

async function rebuildEngineFromDb(room: RoomRuntime) {
  const lobby = await loadLobby(room.lobbyId);
  if (!lobby) return;
  // players eligible next hand: not busted (chips > 0) and not sitting out
  const seats = lobby.players
    .filter((p) => p.chips > 0 && !p.sittingOut)
    .map((p) => ({
      id: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
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
    broadcast(io, room);
    return;
  }
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

  // initial buy-in equals starting stack for anyone who hasn't been credited yet
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

  const room: RoomRuntime = rooms.get(lobbyId) ?? ({} as RoomRuntime);
  const seats = lobby.players.map((p) => ({
    id: p.userId,
    username: p.user.username,
    avatar: p.user.avatar,
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
    actionTimerMs: lobby.actionTimer * 1000,
    gameType: (lobby.gameType as 'CASH' | 'TOURNAMENT'),
    allowRebuy: lobby.allowRebuy,
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
    connectedUsers: room.connectedUsers ?? new Set(),
    handsPlayed: 0,
  };
  rooms.set(lobbyId, runtime);
  scheduleNextBlindLevel(runtime);
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

export async function handleRebuy(io: Server, lobbyId: string, userId: string) {
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
  // if waiting, try to start next
  if (room && room.state.phase === GamePhase.WAITING) {
    await startNext(io, room);
  } else if (room) {
    broadcast(io, room);
  }
}

export async function handleSitOut(io: Server, lobbyId: string, userId: string, sitOut: boolean) {
  await prisma.lobbyPlayer.updateMany({
    where: { lobbyId, userId },
    data: { sittingOut: sitOut },
  });
  const room = rooms.get(lobbyId);
  if (room) broadcast(io, room);
}

export async function handleLeaveTable(io: Server, lobbyId: string, userId: string) {
  const room = rooms.get(lobbyId);
  const lobby = await prisma.lobby.findUnique({ where: { id: lobbyId }, include: { players: true } });
  if (!lobby) throw new Error('not found');
  const lp = lobby.players.find((p) => p.userId === userId);
  if (!lp) throw new Error('not in lobby');
  // finalize this participant
  if (room && room.sessionId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await finalizePlayer({
        sessionId: room.sessionId,
        userId,
        username: user.username,
        initialBuyIn: lp.initialBuyIn,
        totalRebuys: lp.totalRebuys,
        cashOutStack: lp.chips,
      });
    }
  }
  await prisma.lobbyPlayer.delete({ where: { id: lp.id } });
  // pause / advance
  if (room) {
    if (room.state.currentPlayerSeat !== null) {
      // if it was their turn, auto-fold
      const p = room.state.players.find((x) => x.id === userId);
      if (p && room.state.currentPlayerSeat === p.seat) {
        try {
          room.state = applyAction(room.state, userId, { type: ActionType.FOLD });
        } catch { /* ignore */ }
      }
    }
    await startNext(io, room);
  }
  await broadcastLobby(io, lobbyId);
}

export async function handleEndGame(io: Server, lobbyId: string, byUserId: string) {
  const room = rooms.get(lobbyId);
  const lobby = await prisma.lobby.findUnique({ where: { id: lobbyId }, include: { players: true } });
  if (!lobby) throw new Error('not found');
  if (lobby.hostId !== byUserId) throw new Error('only host may end game');
  if (room?.timer) clearTimeout(room.timer);
  if (room?.nextHandTimer) clearTimeout(room.nextHandTimer);
  if (room?.blindTimer) clearTimeout(room.blindTimer);

  const sessionId = room?.sessionId ?? null;
  if (sessionId) {
    for (const lp of lobby.players) {
      const user = await prisma.user.findUnique({ where: { id: lp.userId } });
      if (!user) continue;
      await finalizePlayer({
        sessionId,
        userId: lp.userId,
        username: user.username,
        initialBuyIn: lp.initialBuyIn,
        totalRebuys: lp.totalRebuys,
        cashOutStack: lp.chips,
      });
    }
    await closeGameSession(sessionId, room?.handsPlayed ?? 0);
  }
  await prisma.lobby.update({ where: { id: lobbyId }, data: { status: 'FINISHED', finishedAt: new Date() } });
  rooms.delete(lobbyId);
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
    allowRebuy: lobby.allowRebuy,
    blindsIncrease: lobby.blindsIncrease,
    blindMultiplier: lobby.blindMultiplier,
    blindIntervalSec: lobby.blindIntervalSec,
    players: lobby.players.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      avatarUrl: p.user.avatarUrl,
      seat: p.seat,
      ready: p.ready,
      chips: p.chips,
      initialBuyIn: p.initialBuyIn,
      totalRebuys: p.totalRebuys,
      bustedOut: p.bustedOut,
      sittingOut: p.sittingOut,
    })),
  });
}
