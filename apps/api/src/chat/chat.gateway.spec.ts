import { ConfigService } from "@nestjs/config";
import { sign as signCookieValue } from "cookie-signature";
import type { Server, Socket } from "socket.io";
import { ChatGateway } from "./chat.gateway";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "./chat.service";

describe("ChatGateway", () => {
  const configValues: Record<string, string> = {
    SESSION_COOKIE_NAME: "companio_sid",
    SESSION_SECRET: "test-secret-not-for-production",
  };
  const configServiceMock = { get: (key: string) => configValues[key] };

  const activeSession = {
    id: "session-1",
    userId: "u1",
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 3600_000),
    user: { id: "u1", status: "ACTIVE" },
  };

  let prismaMock: { session: { findUnique: jest.Mock } };
  let chatServiceMock: { isParticipant: jest.Mock };
  let gateway: ChatGateway;

  function signCookie(name: string, value: string): string {
    return `${name}=s:${signCookieValue(value, configValues.SESSION_SECRET)}`;
  }

  type FakeClient = {
    handshake: { headers: { cookie: string | undefined } };
    data: Record<string, unknown>;
    join: jest.Mock;
    leave: jest.Mock;
  };

  function fakeClient(cookieHeader: string | undefined): FakeClient {
    return {
      handshake: { headers: { cookie: cookieHeader } },
      data: {},
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    prismaMock = {
      session: { findUnique: jest.fn().mockResolvedValue(activeSession) },
    };
    chatServiceMock = { isParticipant: jest.fn() };
    gateway = new ChatGateway(
      prismaMock as unknown as PrismaService,
      configServiceMock as unknown as ConfigService,
      chatServiceMock as unknown as ChatService,
    );
  });

  describe("afterInit middleware (io.use) — the race-free auth path", () => {
    // Deliberately NOT testing via `handleConnection`: this gateway
    // authenticates in `io.use()` middleware precisely so a client's
    // `connect` (and therefore any `join` it sends right after) can
    // never arrive before client.data.userId is set — see the
    // class-level doc comment on ChatGateway for the race this avoids.
    function runMiddleware(client: FakeClient): Promise<Error | undefined> {
      return new Promise((resolve) => {
        const server = {
          use: (fn: (c: Socket, next: (err?: Error) => void) => void) =>
            fn(client as unknown as Socket, resolve),
        };
        gateway.afterInit(server as unknown as Server);
      });
    }

    it("sets client.data.userId and calls next() with no error for a valid session cookie", async () => {
      const client = fakeClient(signCookie("companio_sid", "session-1"));
      const err = await runMiddleware(client);
      expect(err).toBeUndefined();
      expect(client.data.userId).toBe("u1");
    });

    it("calls next(error) and never sets userId when there is no cookie", async () => {
      const client = fakeClient(undefined);
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
      expect(client.data.userId).toBeUndefined();
    });

    it("calls next(error) for a tampered/invalid signature", async () => {
      const client = fakeClient(
        "companio_sid=s:session-1.not-a-real-signature",
      );
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
      expect(client.data.userId).toBeUndefined();
    });

    it("calls next(error) when the session is expired", async () => {
      prismaMock.session.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 1000),
      });
      const client = fakeClient(signCookie("companio_sid", "session-1"));
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
    });

    it("calls next(error) when the session is revoked", async () => {
      prismaMock.session.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
      });
      const client = fakeClient(signCookie("companio_sid", "session-1"));
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
    });

    it("calls next(error) when the user is not ACTIVE", async () => {
      prismaMock.session.findUnique.mockResolvedValue({
        ...activeSession,
        user: { id: "u1", status: "SUSPENDED" },
      });
      const client = fakeClient(signCookie("companio_sid", "session-1"));
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
    });

    it("calls next(error) when the session does not exist", async () => {
      prismaMock.session.findUnique.mockResolvedValue(null);
      const client = fakeClient(signCookie("companio_sid", "session-1"));
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("handleJoin", () => {
    it("returns {joined:false} without calling isParticipant when userId is missing (defensive — should be unreachable post-middleware)", async () => {
      const client = fakeClient(undefined);
      const result = await gateway.handleJoin(client as unknown as Socket, {
        conversationId: "conv-1",
      });
      expect(result).toEqual({ joined: false });
      expect(chatServiceMock.isParticipant).not.toHaveBeenCalled();
    });

    it("returns {joined:false} when conversationId is missing", async () => {
      const client = fakeClient(undefined);
      client.data.userId = "u1";
      const result = await gateway.handleJoin(client as unknown as Socket, {});
      expect(result).toEqual({ joined: false });
    });

    it("returns {joined:true} and joins the room when the caller is a participant", async () => {
      const client = fakeClient(undefined);
      client.data.userId = "u1";
      chatServiceMock.isParticipant.mockResolvedValue(true);
      const result = await gateway.handleJoin(client as unknown as Socket, {
        conversationId: "conv-1",
      });
      expect(result).toEqual({ joined: true });
      expect(client.join).toHaveBeenCalledWith("conversation:conv-1");
    });

    it("returns {joined:false} and never joins the room for a non-participant", async () => {
      const client = fakeClient(undefined);
      client.data.userId = "u-outsider";
      chatServiceMock.isParticipant.mockResolvedValue(false);
      const result = await gateway.handleJoin(client as unknown as Socket, {
        conversationId: "conv-1",
      });
      expect(result).toEqual({ joined: false });
      expect(client.join).not.toHaveBeenCalled();
    });

    it("re-checks participation on every call rather than caching it on the socket", async () => {
      const client = fakeClient(undefined);
      client.data.userId = "u1";
      chatServiceMock.isParticipant
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      await expect(
        gateway.handleJoin(client as unknown as Socket, {
          conversationId: "conv-1",
        }),
      ).resolves.toEqual({
        joined: true,
      });
      await expect(
        gateway.handleJoin(client as unknown as Socket, {
          conversationId: "conv-1",
        }),
      ).resolves.toEqual({
        joined: false,
      });
      expect(chatServiceMock.isParticipant).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleLeave", () => {
    it("leaves the room and acknowledges", async () => {
      const client = fakeClient(undefined);
      const result = await gateway.handleLeave(client as unknown as Socket, {
        conversationId: "conv-1",
      });
      expect(client.leave).toHaveBeenCalledWith("conversation:conv-1");
      expect(result).toEqual({ left: true });
    });

    it("acknowledges even with no conversationId, without calling leave", async () => {
      const client = fakeClient(undefined);
      const result = await gateway.handleLeave(client as unknown as Socket, {});
      expect(client.leave).not.toHaveBeenCalled();
      expect(result).toEqual({ left: true });
    });
  });

  describe("handleMessageSent", () => {
    it("broadcasts the message to the room for its conversation", () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as unknown as { server: { to: typeof to } }).server = { to };
      const message = {
        id: "m1",
        conversationId: "conv-1",
        senderId: "u1",
        body: "hi",
        sentAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      };
      gateway.handleMessageSent({ conversationId: "conv-1", message });
      expect(to).toHaveBeenCalledWith("conversation:conv-1");
      expect(emit).toHaveBeenCalledWith("message", message);
    });
  });
});
