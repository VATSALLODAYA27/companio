import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE_NAME = 'companio_csrf';

/**
 * Double-submit-cookie CSRF check for mutating requests made by the
 * authenticated SPA. The cookie is set by GET /auth/csrf; the client
 * must echo its value back in the X-CSRF-Token header on every
 * state-changing call. Apply this alongside SessionAuthGuard on every
 * mutating authenticated route from Phase 3 onward — it is not global
 * because unauthenticated routes (register/login) have no session cookie
 * yet for it to protect.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const headerToken = request.header('x-csrf-token');
    const cookieToken = request.signedCookies?.[CSRF_COOKIE_NAME];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
    return true;
  }
}
