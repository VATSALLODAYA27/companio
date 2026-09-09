import { Body, Controller, Delete, Put, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LocationService } from './location.service';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('location')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Put('me')
  updateMyLocation(@CurrentUser() userId: string, @Body() dto: UpdateLocationDto) {
    return this.locationService.updateMyLocation(userId, dto.latitude, dto.longitude);
  }

  @Delete('me')
  clearMyLocation(@CurrentUser() userId: string) {
    return this.locationService.clearMyLocation(userId);
  }
}
