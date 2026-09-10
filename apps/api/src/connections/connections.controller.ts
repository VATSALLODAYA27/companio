import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConnectionsService } from './connections.service';
import { SendConnectionRequestDto } from './dto/send-request.dto';

// Stricter than the platform default — sending connection requests is
// the one write in this module a malicious user could use to spam many
// other people, similar in spirit to /auth/* and /discovery/nearby's
// dedicated throttles.
const connectionRequestThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_CONNECTIONS ?? 20),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

// Every route here requires a valid session; CsrfGuard is added
// per-route only on the mutating ones (POST/DELETE) — the same split
// used by LocationController vs DiscoveryController in Phase 4.
@Controller('connections')
@UseGuards(SessionAuthGuard)
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Post('requests')
  @UseGuards(CsrfGuard)
  @Throttle(connectionRequestThrottle())
  sendRequest(@CurrentUser() userId: string, @Body() dto: SendConnectionRequestDto) {
    return this.connectionsService.sendRequest(userId, dto.recipientId, dto.activityKey);
  }

  @Get('requests/incoming')
  listIncoming(@CurrentUser() userId: string) {
    return this.connectionsService.listIncoming(userId);
  }

  @Get('requests/outgoing')
  listOutgoing(@CurrentUser() userId: string) {
    return this.connectionsService.listOutgoing(userId);
  }

  @Post('requests/:id/accept')
  @UseGuards(CsrfGuard)
  acceptRequest(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectionsService.acceptRequest(userId, id);
  }

  @Post('requests/:id/decline')
  @UseGuards(CsrfGuard)
  declineRequest(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectionsService.declineRequest(userId, id);
  }

  @Delete('requests/:id')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  cancelRequest(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectionsService.cancelRequest(userId, id);
  }

  @Get()
  listConnections(@CurrentUser() userId: string) {
    return this.connectionsService.listConnections(userId);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  removeConnection(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectionsService.removeConnection(userId, id);
  }
}
