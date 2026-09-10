import { OnEvent } from "@nestjs/event-emitter";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "./chat.service";
import { extractSignedCookie } from "../common/utils/session-cookie.util";
import {
  MESSAGE_SENT_EVENT,
  MessageSentEvent,
} from "../common/events/domain-events.types";

function roomName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Live delivery only — persistence and authorization for WRITES stay on
 * the REST routes in chat.controller.ts (full ValidationPipe, CSRF,
 * rate limiting, and the same test coverage every other mutating route
 * gets). This gateway does two things: (1) lets an already-authenticated
 * socket join the room for a conversation it's actually a participant
 * in, and (2) rebroadcasts a persisted message to that room the moment
 * ChatService.sendMessage publishes it, so other open tabs/devices for
 * both participants see it without polling.
 *
 * Socket.IO's handshake never runs Express's cookie-parser middleware
 * (a known Nest/Socket.IO limitation — see session-cookie.util.ts), so
 * the session cookie is parsed and verified by hand, using the exact
 * same signing scheme and DB-backed validity check (expiry, revocation,
 * ACTIVE user) as SessionAuthGuard uses for every HTTP request.
 *
 * Authentication runs as Socket.IO server-side middleware (`io.use()`,
 * registered in `afterInit`), NOT in `handleConnection`. This is not
 * just style: Socket.IO only fires the client's `connect` event, and
 * only fires the server's `connection` event (which is what triggers
 * Nest's `handleConnection` lifecycle hook), *after* every `io.use()`
 * middleware has resolved. A naive implementation that authenticates
 * inside `handleConnection` instead loses a real race — a client is
 * free to `emit('join', ...)` the instant it sees `connect`, which can
 * fire before an async `handleConnection` has finished its DB lookup
 * and set `client.data.userId`, making a legitimate participant's join
 * fail exactly like an outsider's. Doing the DB-backed check in
 * middleware means the handshake itself blocks until auth is settled,
 * so by construction no `join` can ever be processed before
 * `client.data.userId` exists. An unauthenticated or invalid-session
 * socket never completes its handshake at all — the client gets a
 * `connect_error`, not a `connect` followed by a disconnect.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
  ) {}

  afterInit(server: Server): void {
    server.use((client: Socket, next: (err?: Error) => void) => {
      this.authenticate(client)
        .then((userId) => {
          client.data.userId = userId;
          next();
        })
        .catch(() => {
          // Never distinguish "bad cookie" from "expired session" from
          // "user suspended" to the client — same principle as
          // SessionAuthGuard's single "Not authenticated" message.
          next(new Error("Unauthorized"));
        });
    });
  }

  @SubscribeMessage("join")
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ): Promise<{ joined: boolean }> {
    const userId = client.data.userId as string | undefined;
    const conversationId = payload?.conversationId;
    if (!userId || !conversationId || typeof conversationId !== "string") {
      return { joined: false };
    }
    // Re-checked on every join, not cached on the socket — membership
    // can change (e.g. the connection gets unmatched) for the lifetime
    // of a long-held socket.
    const allowed = await this.chatService.isParticipant(
      userId,
      conversationId,
    );
    if (!allowed) {
      return { joined: false };
    }
    await client.join(roomName(conversationId));
    return { joined: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ): Promise<{ left: boolean }> {
    if (payload?.conversationId) {
      await client.leave(roomName(payload.conversationId));
    }
    return { left: true };
  }

  @OnEvent(MESSAGE_SENT_EVENT)
  handleMessageSent(event: MessageSentEvent): void {
    this.server
      .to(roomName(event.conversationId))
      .emit("message", event.message);
  }

  private async authenticate(client: Socket): Promise<string> {
    const cookieName =
      this.config.get<string>("SESSION_COOKIE_NAME") ?? "companio_sid";
    const secret = this.config.get<string>("SESSION_SECRET");
    if (!secret) {
      throw new Error("SESSION_SECRET is not set");
    }
    const sessionId = extractSignedCookie(
      client.handshake.headers.cookie,
      cookieName,
      secret,
    );
    if (!sessionId) {
      throw new Error("Missing or invalid session cookie");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, status: true } } },
    });
    const isValid =
      !!session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now() &&
      session.user.status === "ACTIVE";
    if (!isValid) {
      throw new Error("Session expired or invalid");
    }
    return session.userId;
  }
}
