import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(SessionAuthGuard)
  @Get('me')
  async me(@CurrentUser() userId: string) {
    const user = await this.usersService.findActiveById(userId);
    if (!user) {
      // The session was valid but the account is gone/suspended — treat
      // as not-found rather than leaking which case it was.
      throw new NotFoundException();
    }

    // Explicit DTO shape — never spread the raw Prisma row. passwordHash,
    // googleId, and internal timestamps never leave this handler.
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
    };
  }
}
