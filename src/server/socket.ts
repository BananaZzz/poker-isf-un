import type { Server, Socket } from 'socket.io';
import { getUserByToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  ensureRoom,
  joinRoom,
  leaveRoom,
  startGame,
  handlePlayerAction,
  toggleReady,
  broadcastLobby,
  chat,
  getChat,
} from './gameManager';
import { ActionType } from '@/game/types';
import { prisma } from '@/lib/db';

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function attachSocketServer(io: Server) {
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.request.headers.cookie;
      const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
      if (!token) return next(new Error('unauthorized'));
      const user = await getUserByToken(token);
      if (!user) return next(new Error('unauthorized'));
      (socket.data as any).userId = user.id;
      (socket.data as any).username = user.username;
      next();
    } catch (e) {
      next(new Error('auth failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket.data as any).userId as string;
    const username = (socket.data as any).username as string;

    socket.on('lobby:subscribe', async (lobbyId: string) => {
      socket.join(`lobby:${lobbyId}`);
      await broadcastLobby(io, lobbyId);
      socket.emit('chat:history', getChat(lobbyId));
    });

    socket.on('lobby:unsubscribe', (lobbyId: string) => {
      socket.leave(`lobby:${lobbyId}`);
    });

    socket.on('lobby:ready', async ({ lobbyId, ready }: { lobbyId: string; ready: boolean }) => {
      try {
        await toggleReady(io, lobbyId, userId, Boolean(ready));
      } catch (e) {
        socket.emit('error:msg', (e as Error).message);
      }
    });

    socket.on('lobby:start', async ({ lobbyId }: { lobbyId: string }) => {
      try {
        await startGame(io, lobbyId, userId);
        await broadcastLobby(io, lobbyId);
      } catch (e) {
        socket.emit('error:msg', (e as Error).message);
      }
    });

    socket.on('game:join', async ({ lobbyId }: { lobbyId: string }) => {
      try {
        // ensure user is a member
        const lp = await prisma.lobbyPlayer.findFirst({ where: { lobbyId, userId } });
        if (!lp) return socket.emit('error:msg', 'not in lobby');
        await ensureRoom(lobbyId);
        joinRoom(io, socket, lobbyId);
      } catch (e) {
        socket.emit('error:msg', (e as Error).message);
      }
    });

    socket.on('game:leave', ({ lobbyId }: { lobbyId: string }) => {
      leaveRoom(io, socket, lobbyId);
    });

    socket.on(
      'game:action',
      async ({ lobbyId, type, amount }: { lobbyId: string; type: string; amount?: number }) => {
        try {
          const t = type as ActionType;
          if (!Object.values(ActionType).includes(t)) throw new Error('bad action');
          await handlePlayerAction(io, lobbyId, userId, { type: t, amount });
        } catch (e) {
          socket.emit('error:msg', (e as Error).message);
        }
      }
    );

    socket.on('chat:send', ({ lobbyId, text }: { lobbyId: string; text: string }) => {
      try {
        chat(io, lobbyId, username, String(text ?? ''));
      } catch (e) {
        socket.emit('error:msg', (e as Error).message);
      }
    });

    socket.on('disconnect', () => {
      // rooms are cleaned automatically; connectedUsers is best-effort
    });
  });
}
