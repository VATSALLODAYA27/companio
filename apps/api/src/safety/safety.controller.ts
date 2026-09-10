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
import { SafetyService } from './safety.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { CreateReportDto } from './dto/create-report.dto';

// Filing a report is the one write in this module with a real abuse
// vector worth its own limit — mass-filing frivolous or harassing
// reports against someone. Deliberately stricter than every other
// dedicated limit in the app (connections/discovery/map/messages):
// legitimate use of this endpoint should be rare. Block creation gets
// no dedicated limit — repeatedly blocking people has no meaningful
// abuse value, so the platform default is enough (same reasoning
// DELETE /connections/:id, "unmatch", already relies on).
const reportThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_REPORTS ?? 5),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

@Controller('safety')
@UseGuards(SessionAuthGuard)
export class SafetyController {
  constructor(private readonly safetyService: SafetyService) {}

  @Post('blocks')
  @UseGuards(CsrfGuard)
  createBlock(@CurrentUser() userId: string, @Body() dto: CreateBlockDto) {
    return this.safetyService.createBlock(userId, dto.blockedUserId);
  }

  @Get('blocks')
  async listBlocks(@CurrentUser() userId: string) {
    const blocks = await this.safetyService.listBlocks(userId);
    return { blocks };
  }

  @Delete('blocks/:userId')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  removeBlock(
    @CurrentUser() userId: string,
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
  ) {
    return this.safetyService.removeBlock(userId, blockedUserId);
  }

  @Post('reports')
  @UseGuards(CsrfGuard)
  @Throttle(reportThrottle())
  createReport(@CurrentUser() userId: string, @Body() dto: CreateReportDto) {
    return this.safetyService.createReport(userId, dto.reportedUserId, dto.category, dto.details);
  }

  @Get('reports')
  async listMyReports(@CurrentUser() userId: string) {
    const reports = await this.safetyService.listMyReports(userId);
    return { reports };
  }
}
