import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    // passport-google-oauth20 throws synchronously at construction if
    // clientID/clientSecret are empty strings, which would crash the
    // whole API on boot before Google OAuth credentials are ever set up.
    // Falling back to a non-empty placeholder lets the app start and
    // every other auth path (email/password) work immediately; hitting
    // /auth/google without real credentials configured then fails at
    // Google's side with a clear error, not a server crash.
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:4000/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    // The Google access/refresh token is intentionally never read past
    // this point — it is not persisted or forwarded anywhere. See
    // SECURITY.md "Authentication Model".
    const email = profile.emails?.[0]?.value;
    const emailVerified = profile.emails?.[0]?.verified === true;

    if (!email) {
      done(new Error('Google account has no email'), false);
      return;
    }

    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      emailVerified,
    };
    done(null, googleProfile as unknown as Express.User);
  }
}
