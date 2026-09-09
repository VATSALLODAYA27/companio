import { Request } from 'express';

/**
 * What SessionAuthGuard attaches to the request after validating the
 * session cookie against the Session table. Deliberately minimal — never
 * the full User row, so a handler can't accidentally serialize more than
 * intended.
 */
export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    sessionId: string;
  };
}
