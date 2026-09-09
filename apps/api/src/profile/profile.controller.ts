import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateActivitiesDto } from './dto/update-activities.dto';

@Controller('profile')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  getMyProfile(@CurrentUser() userId: string) {
    return this.profileService.getMyProfile(userId);
  }

  @Put('me')
  upsertMyProfile(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    return this.profileService.upsertMyProfile(userId, dto);
  }

  @Get('me/activities')
  getMyActivities(@CurrentUser() userId: string) {
    return this.profileService.getMyActivities(userId);
  }

  @Put('me/activities')
  setMyActivities(@CurrentUser() userId: string, @Body() dto: UpdateActivitiesDto) {
    return this.profileService.setMyActivities(userId, dto.activities);
  }
}
