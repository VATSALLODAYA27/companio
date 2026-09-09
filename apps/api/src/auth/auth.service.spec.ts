import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';
import { VerificationsService } from '../identity-verification/verifications.service';
import { GoogleVerificationProvider } from '../identity-verification/google.provider';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<Pick<UsersService, keyof UsersService>>;
  let sessions: jest.Mocked<Pick<SessionsService, 'create' | 'revoke'>>;
  let verifications: jest.Mocked<Pick<VerificationsService, 'recordGoogleVerification'>>;
  let googleVerification: jest.Mocked<Pick<GoogleVerificationProvider, 'verify'>>;

  const fakeSession = { id: 'session-1', expiresAt: new Date(Date.now() + 3600_000) };

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findByGoogleId: jest.fn(),
      findActiveById: jest.fn(),
      createWithPassword: jest.fn(),
      createWithGoogle: jest.fn(),
      linkGoogleId: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    sessions = {
      create: jest.fn().mockResolvedValue(fakeSession),
      revoke: jest.fn(),
    } as unknown as jest.Mocked<SessionsService>;

    verifications = {
      recordGoogleVerification: jest.fn(),
    } as unknown as jest.Mocked<VerificationsService>;

    googleVerification = {
      verify: jest.fn().mockResolvedValue({ status: 'VERIFIED', verifiedAt: new Date() }),
    } as unknown as jest.Mocked<GoogleVerificationProvider>;

    service = new AuthService(
      users as unknown as UsersService,
      sessions as unknown as SessionsService,
      verifications as unknown as VerificationsService,
      googleVerification as unknown as GoogleVerificationProvider,
    );
  });

  describe('register', () => {
    it('rejects a duplicate email without revealing more than "already exists"', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1' } as never);
      await expect(service.register('taken@test.local', 'password123')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.createWithPassword).not.toHaveBeenCalled();
    });

    it('hashes the password before storing and issues a session', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.createWithPassword.mockResolvedValue({ id: 'u1' } as never);

      const result = await service.register('new@test.local', 'password123');

      const [, storedHash] = users.createWithPassword.mock.calls[0];
      expect(storedHash).not.toBe('password123'); // never store the plaintext
      expect(storedHash.startsWith('$argon2')).toBe(true);
      expect(sessions.create).toHaveBeenCalledWith('u1');
      expect(result).toBe(fakeSession);
    });
  });

  describe('login', () => {
    it('rejects with a generic error when the email does not exist', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@test.local', 'whatever123')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an OAuth-only account (no passwordHash) the same way as a wrong password', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', passwordHash: null } as never);
      await expect(service.login('oauth@test.local', 'whatever123')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an incorrect password', async () => {
      const realHash = await hash('correct-password-1');
      users.findByEmail.mockResolvedValue({ id: 'u1', passwordHash: realHash } as never);
      await expect(service.login('user@test.local', 'wrong-password-1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('issues a session on a correct password', async () => {
      const realHash = await hash('correct-password-1');
      users.findByEmail.mockResolvedValue({ id: 'u1', passwordHash: realHash } as never);

      const result = await service.login('user@test.local', 'correct-password-1', 'test-agent');

      expect(sessions.create).toHaveBeenCalledWith('u1', 'test-agent');
      expect(result).toBe(fakeSession);
    });
  });

  describe('loginWithGoogle', () => {
    const profile = { googleId: 'g-1', email: 'g@test.local', emailVerified: true };

    it('creates a new user when neither googleId nor email match an existing account', async () => {
      users.findByGoogleId.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);
      users.createWithGoogle.mockResolvedValue({ id: 'u-new' } as never);

      await service.loginWithGoogle(profile);

      expect(users.createWithGoogle).toHaveBeenCalledWith(profile.email, profile.googleId);
      expect(users.linkGoogleId).not.toHaveBeenCalled();
      expect(verifications.recordGoogleVerification).toHaveBeenCalledWith(
        'u-new',
        expect.objectContaining({ status: 'VERIFIED' }),
      );
    });

    it('links the Google id to an existing email/password account instead of creating a duplicate', async () => {
      users.findByGoogleId.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue({ id: 'u-existing' } as never);
      users.linkGoogleId.mockResolvedValue({ id: 'u-existing' } as never);

      await service.loginWithGoogle(profile);

      expect(users.linkGoogleId).toHaveBeenCalledWith('u-existing', profile.googleId);
      expect(users.createWithGoogle).not.toHaveBeenCalled();
    });

    it('reuses the existing user when googleId already matches', async () => {
      users.findByGoogleId.mockResolvedValue({ id: 'u-google' } as never);

      await service.loginWithGoogle(profile);

      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(users.createWithGoogle).not.toHaveBeenCalled();
      expect(users.linkGoogleId).not.toHaveBeenCalled();
      expect(sessions.create).toHaveBeenCalledWith('u-google', undefined);
    });
  });

  describe('logout', () => {
    it('revokes the given session', async () => {
      await service.logout('session-1');
      expect(sessions.revoke).toHaveBeenCalledWith('session-1');
    });
  });
});
