import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';
import { VerificationsService } from '../identity-verification/verifications.service';
import { GoogleVerificationProvider } from '../identity-verification/google.provider';
import { GoogleProfile } from './strategies/google.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly verifications: VerificationsService,
    private readonly googleVerification: GoogleVerificationProvider,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await hash(password);
    const user = await this.users.createWithPassword(email, passwordHash);
    return this.sessions.create(user.id);
  }

  async login(email: string, password: string, userAgent?: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) {
      // Same error whether the email doesn't exist or the password is
      // wrong — don't help an attacker enumerate registered accounts.
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.sessions.create(user.id, userAgent);
  }

  async loginWithGoogle(profile: GoogleProfile, userAgent?: string) {
    let user = await this.users.findByGoogleId(profile.googleId);

    if (!user) {
      const existingByEmail = await this.users.findByEmail(profile.email);
      user = existingByEmail
        ? await this.users.linkGoogleId(existingByEmail.id, profile.googleId)
        : await this.users.createWithGoogle(profile.email, profile.googleId);
    }

    const result = await this.googleVerification.verify({
      emailVerified: profile.emailVerified,
    });
    await this.verifications.recordGoogleVerification(user.id, result);

    return this.sessions.create(user.id, userAgent);
  }

  async logout(sessionId: string) {
    await this.sessions.revoke(sessionId);
  }
}
