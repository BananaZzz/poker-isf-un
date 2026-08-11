'use client';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = fetch('/api/socket').then(() => undefined).catch(() => undefined);
  }
  await initPromise;
}

export function getSocket(): Socket {
  if (!socket) {
    // fire-and-forget init poke; socket.io will retry on connect
    ensureInitialized();
    socket = io({
      path: '/api/socket',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}
