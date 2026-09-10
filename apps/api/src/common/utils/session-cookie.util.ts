import { parse as parseCookieHeader } from 'cookie';
import { unsign } from 'cookie-signature';

/**
 * Extracts and verifies a cookie-parser-signed cookie value from a raw
 * `Cookie` header string — the same signing scheme `cookieParser(SESSION_SECRET)`
 * applies to every response cookie (see main.ts), replicated here
 * because the WebSocket upgrade handshake (see chat.gateway.ts) never
 * passes through Express's cookie-parser middleware the way a normal
 * HTTP request does for SessionAuthGuard — a well-known limitation of
 * Nest's Socket.IO gateway, not an oversight.
 *
 * Returns the verified, unsigned cookie value, or null if the header is
 * missing, the named cookie isn't present, isn't in cookie-parser's
 * signed format ("s:<value>.<hmac>"), or the signature doesn't verify
 * (tampered or signed with a different secret).
 */
export function extractSignedCookie(
  cookieHeader: string | undefined,
  cookieName: string,
  secret: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  const cookies = parseCookieHeader(cookieHeader);
  const raw = cookies[cookieName];
  if (!raw || !raw.startsWith('s:')) {
    return null;
  }
  const unsigned = unsign(raw.slice(2), secret);
  return unsigned === false ? null : unsigned;
}
