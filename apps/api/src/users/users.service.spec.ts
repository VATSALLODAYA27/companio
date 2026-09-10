import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('findByEmail looks up by email only', () => {
    service.findByEmail('a@test.local');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@test.local' } });
  });

  it('findByGoogleId looks up by googleId only', () => {
    service.findByGoogleId('g-123');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { googleId: 'g-123' } });
  });

  it('findActiveById filters to ACTIVE status — a suspended/deleted user is invisible to callers of this method', () => {
    service.findActiveById('u1');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'ACTIVE' },
    });
  });

  it('findById has no status filter — used where a non-ACTIVE target must still resolve (safety/ block+report)', () => {
    service.findById('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('createWithPassword stores the hash, never a plaintext password field', () => {
    service.createWithPassword('a@test.local', '$argon2id$hash');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@test.local', passwordHash: '$argon2id$hash' },
    });
  });

  it('createWithGoogle stores email + googleId, no password field', () => {
    service.createWithGoogle('a@test.local', 'g-123');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@test.local', googleId: 'g-123' },
    });
  });

  it('linkGoogleId updates only the googleId field, scoped by id', () => {
    service.linkGoogleId('u1', 'g-123');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { googleId: 'g-123' },
    });
  });
});
