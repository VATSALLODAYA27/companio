import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CsrfGuard, CSRF_COOKIE_NAME } from '../common/guards/csrf.guard';
import {
  CurrentSessionId,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { GoogleProfile } from './strategies/google.strategy';

const authThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_AUTH ?? 10),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieName(): string {
    return this.config.get<string>('SESSION_COOKIE_NAME') ?? 'companio_sid';
  }

  private isProd(): boolean {
    return this.config.get('NODE_ENV') === 'production';
  }

  private setSessionCookie(res: Response, sessionId: string, expiresAt: Date) {
    res.cookie(this.cookieName(), sessionId, {
      httpOnly: true,
      secure: this.isProd(),
      sameSite: 'lax',
      signed: true,
      expires: expiresAt,
      path: '/',
    });
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(this.cookieName(), { path: '/' });
  }

  @Throttle(authThrottle())
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.register(dto.email, dto.password);
    this.setSessionCookie(res, session.id, session.expiresAt);
    return { status: 'ok' };
  }

  @Throttle(authThrottle())
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(
      dto.email,
      dto.password,
      req.headers['user-agent'],
    );
    this.setSessionCookie(res, session.id, session.expiresAt);
    return { status: 'ok' };
  }

  // Passport redirects to Google's consent screen; this handler body
  // never executes.
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as GoogleProfile;
    const session = await this.authService.loginWithGoogle(
      profile,
      req.headers['user-agent'] as string | undefined,
    );
    this.setSessionCookie(res, session.id, session.expiresAt);
    const webBaseUrl = this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
    res.redirect(webBaseUrl);
  }

  @UseGuards(SessionAuthGuard, CsrfGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentSessionId() sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(sessionId);
    this.clearSessionCookie(res);
    return { status: 'ok' };
  }

  @UseGuards(SessionAuthGuard)
  @Get('session')
  session(@CurrentUser() userId: string) {
    return { authenticated: true, userId };
  }

  /** Issues the CSRF cookie the SPA must echo back via X-CSRF-Token on
   *  every mutating authenticated request. Readable by client JS on
   *  purpose — the secret is that it matches the cookie, not that it's
   *  hidden (that's what makes double-submit work over plain cookies). */
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response) {
    const token = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: this.isProd(),
      sameSite: 'lax',
      signed: true,
      path: '/',
    });
    return { csrfToken: token };
  }
}
