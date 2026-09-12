'use client';

import { io, type Socket } from 'socket.io-client';
import { WS_BASE_URL } from './api';

/**
 * One socket per browser tab, created lazily on first use and reused by
 * every chat page. It authenticates via the same httpOnly session
 * cookie every REST call uses (withCredentials: true) — see
 * ChatGateway's afterInit() on the API side, which parses that cookie
 * by hand during the Socket.IO handshake. There is no separate login
 * step for the socket: if the session cookie is valid, the handshake
 * succeeds; if not, the client gets a `connect_error` instead of
 * `connect`.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // `WS_BASE_URL` is '' when NEXT_PUBLIC_API_BASE_URL is a same-origin
    // relative path (the free-tier deployment behind server.js's proxy —
    // see that file). socket.io-client treats an empty string as a real
    // (invalid) URL to parse, not "use the current origin" — only
    // `undefined` gets that behavior — so translate '' to `undefined`.
    socket = io(WS_BASE_URL || undefined, {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
