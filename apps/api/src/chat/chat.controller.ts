import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

const messageThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_MESSAGES ?? 60),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

// :conversationId, not :connectionId — SECURITY.md §3 describes this
// exact route shape ("reading /conversations/:id/messages checks that
// the requesting user is one of the two participants in the Connection
// behind that Conversation"). GET /connections always includes each
// connection's conversationId (see ConnectionsService), so the client
// never has to look one up separately.
@Controller('conversations/:conversationId/messages')
@UseGuards(SessionAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chatService.listMessages(userId, conversationId, query.before, query.limit);
  }

  @Post()
  @UseGuards(CsrfGuard)
  @Throttle(messageThrottle())
  send(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(userId, conversationId, dto.body);
  }

  @Post('read')
  @UseGuards(CsrfGuard)
  markRead(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.chatService.markRead(userId, conversationId);
  }
}
