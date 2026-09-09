import { Controller, Get } from '@nestjs/common';
import { ActivitiesService } from './activities.service';

/**
 * Public, unauthenticated reference data — the fixed list of activities
 * a user can pick from. No user data is returned here, so there is
 * nothing to authenticate or authorize.
 */
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  async list() {
    const activities = await this.activitiesService.findAll();
    return {
      activities: activities.map((a: { key: string; label: string }) => ({
        key: a.key,
        label: a.label,
      })),
    };
  }
}
