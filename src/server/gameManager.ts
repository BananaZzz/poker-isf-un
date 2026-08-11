import { EventEmitter } from 'node:events';
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

interface RoomRuntime {
  lobbyId: string;
  state: GameState;
  timer: NodeJS.Timeout | null;
  nextHandTimer: NodeJS.Timeout | null;
  actionTimerMs: number;
  isCash: boolean;
  startingStack: number;
  // socket userIds currently connected in this room
  connectedUsers: Set<string>;
}

const rooms = new Map<string, RoomRuntime>();

export const bus = new EventEmitter();

async function loadLobby(lobbyId: string) {
  return prisma.lobby.findUnique({
    where: { id: lobbyId },
    include: { players: { include: { user: true }, orderBy: { seat: 'asc' } } },
  });
}

export async function ensureRoom(lobbyId: string): Promise<RoomRuntime> {
  const existing = rooms.get(lobbyId);
  if (existing) return existing;
  const lobby = await loadLobby(lobbyId);
  if (!lobby) throw new Error('lobby not found');
  const state = createInitialState(
    lobby.players.map((p) => ({
      id: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      seat: p.seat,
      chips: p.chips,
    })),
    { smallBlind: lobby.smallBlind, bigBlind: lobby.bigBlind, actionTimerMs: lobby.actionTimer * 1000 }
  );
  const runtime: RoomRuntime = {
    lobbyId,
    state,
    timer: null,
    nextHandTimer: null,
    actionTimerMs: lobby.actionTimer * 1000,
    isCash: lobby.gameType === 'CASH',
    startingStack: lobby.startingStack,
    connectedUsers: new Set(),
  };
  rooms.set(lobbyId, runtime);
  return runtime;
}

function broadcast(io: Server, room: RoomRuntime) {
  // send a redacted view to each socket in the room
  io.to(room.lobbyId).fetchSockets().then((sockets) => {
    for (const s of sockets) {
      const userId = (s.data as any).userId as string | undefined;
      const redacted = redactStateFor(room.state, userId ?? null);
      const player = room.state.players.find((p) => p.id === userId);
      const legal = player ? legalActions(room.state, player.id) : { actions: [], callAmount: 0, minRaiseTo: 0, maxBetTo: 0 };
      s.emit('state', { state: redacted, legal });
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
    } catch (e) {
      // swallow
    }
  }, room.actionTimerMs + 500);
}

function afterActionOrPhase(io: Server, room: RoomRuntime) {
  broadcast(io, room);
  if (room.state.phase === GamePhase.HAND_COMPLETE) {
    if (room.timer) clearTimeout(room.timer);
    persistStacks(room).catch(() => {});
    // schedule next hand
    if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
    room.nextHandTimer = setTimeout(() => startNext(io, room), 4500);
  } else if (room.state.currentPlayerSeat !== null) {
    scheduleAutoAction(io, room);
  }
}

async function persistStacks(room: RoomRuntime) {
  const lobby = await prisma.lobby.findUnique({ where: { id: room.lobbyId }, include: { players: true } });
  if (!lobby) return;
  for (const p of room.state.players) {
    const lp = lobby.players.find((x) => x.userId === p.id);
    if (lp) {
      await prisma.lobbyPlayer.update({ where: { id: lp.id }, data: { chips: p.chips } });
    }
  }
}

function startNext(io: Server, room: RoomRuntime) {
  const alive = room.state.players.filter((p) => p.chips > 0);
  if (alive.length < 2) {
    room.state.phase = GamePhase.WAITING;
    room.state.currentPlayerSeat = null;
    prisma.lobby.update({ where: { id: room.lobbyId }, data: { status: 'FINISHED' } }).catch(() => {});
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
  const room = await ensureRoom(lobbyId);
  // rebuild state from fresh DB players (in case players joined after lobby created)
  room.state = createInitialState(
    lobby.players.map((p) => ({
      id: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      seat: p.seat,
      chips: p.chips,
    })),
    { smallBlind: lobby.smallBlind, bigBlind: lobby.bigBlind, actionTimerMs: lobby.actionTimer * 1000 }
  );
  room.state = startNewHand(room.state);
  broadcast(io, room);
  scheduleAutoAction(io, room);
}

export async function handlePlayerAction(
  io: Server,
  lobbyId: string,
  userId: string,
  action: { type: ActionType; amount?: number }
) {
  const room = rooms.get(lobbyId);
  if (!room) throw new Error('game not running');
  // validate: it is this user's turn and action is legal
  const state = room.state;
  const p = state.players.find((x) => x.id === userId);
  if (!p) throw new Error('not in game');
  if (state.currentPlayerSeat !== p.seat) throw new Error('not your turn');
  const legal = legalActions(state, userId);
  if (!legal.actions.includes(action.type)) throw new Error('illegal action');
  room.state = applyAction(state, userId, action);
  afterActionOrPhase(io, room);
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
    socket.emit('state', { state: redacted, legal });
  }
}

export function leaveRoom(_io: Server, socket: Socket, lobbyId: string) {
  socket.leave(lobbyId);
  const room = rooms.get(lobbyId);
  if (room) room.connectedUsers.delete((socket.data as any).userId);
}

// simple in-memory chat per lobby
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

// Ready toggle handled via DB update + broadcast lobby snapshot
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
    players: lobby.players.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      avatar: p.user.avatar,
      seat: p.seat,
      ready: p.ready,
      chips: p.chips,
    })),
  });
}
