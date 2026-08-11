import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'node:http';
import type { Socket as NetSocket } from 'node:net';
import { Server as IOServer } from 'socket.io';
import { attachSocketServer } from '@/server/socket';

export const config = {
  api: { bodyParser: false },
};

interface SocketWithIO extends NetSocket {
  server: HTTPServer & { io?: IOServer };
}
interface ResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

export default function handler(_req: NextApiRequest, res: ResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
    });
    attachSocketServer(io);
    res.socket.server.io = io;
    // eslint-disable-next-line no-console
    console.log('[socket] initialized');
  }
  res.end();
}
