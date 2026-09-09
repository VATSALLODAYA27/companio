import { BadRequestException } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoveryRepository } from './discovery.repository';
import { ActivitiesService } from '../activities/activities.service';
import { LocationService } from '../location/location.service';
import { ConfigService } from '@nestjs/config';

describe('DiscoveryService', () => {
  let repository: jest.Mocked<Pick<DiscoveryRepository, 'findNearby'>>;
  let activities: jest.Mocked<Pick<ActivitiesService, 'findIdsByKeys'>>;
  let location: jest.Mocked<Pick<LocationService, 'hasLocation'>>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;
  let service: DiscoveryService;

  beforeEach(() => {
    repository = { findNearby: jest.fn().mockResolvedValue([]) };
    activities = { findIdsByKeys: jest.fn() };
    location = { hasLocation: jest.fn().mockResolvedValue(true) };
    config = { get: jest.fn().mockReturnValue(undefined) };

    service = new DiscoveryService(
      repository as unknown as DiscoveryRepository,
      activities as unknown as ActivitiesService,
      location as unknown as LocationService,
      config as unknown as ConfigService,
    );
  });

  it('rejects when the caller has not set a location yet', async () => {
    location.hasLocation.mockResolvedValue(false);
    await expect(service.findNearby('u1', 'gym', undefined, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findNearby).not.toHaveBeenCalled();
  });

  it('rejects an activity key the DB has no id for (defensive)', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map());
    await expect(service.findNearby('u1', 'gym', undefined, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findNearby).not.toHaveBeenCalled();
  });

  it('falls back to DEFAULT_SEARCH_RADIUS_METERS and offset 0 when omitted', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    config.get.mockImplementation((key: string) =>
      key === 'DEFAULT_SEARCH_RADIUS_METERS' ? '1000' : undefined,
    );

    await service.findNearby('u1', 'gym', undefined, undefined);

    expect(repository.findNearby).toHaveBeenCalledWith({
      currentUserId: 'u1',
      activityId: 'act-gym',
      radiusMeters: 1000,
      offset: 0,
    });
  });

  it('passes through an explicit radius and offset', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));

    await service.findNearby('u1', 'gym', 5000, 40);

    expect(repository.findNearby).toHaveBeenCalledWith({
      currentUserId: 'u1',
      activityId: 'act-gym',
      radiusMeters: 5000,
      offset: 40,
    });
  });

  it('maps repository rows to the public shape, never leaking distance_m or internal fields', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    repository.findNearby.mockResolvedValue([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: '25-34',
        availability: 'NOW',
        verified: true,
        distanceLabel: '< 250 m',
      },
    ]);

    const result = await service.findNearby('u1', 'gym', undefined, undefined);

    expect(result).toEqual([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: '25-34',
        activityKey: 'gym',
        availability: 'NOW',
        verificationBadge: 'GOOGLE_VERIFIED',
        distanceLabel: '< 250 m',
      },
    ]);
    expect(result[0]).not.toHaveProperty('distance_m');
    expect(result[0]).not.toHaveProperty('verified');
  });

  it('maps an unverified row to the NONE badge', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    repository.findNearby.mockResolvedValue([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: null,
        availability: 'TODAY',
        verified: false,
        distanceLabel: '1-3 km',
      },
    ]);

    const result = await service.findNearby('u1', 'gym', undefined, undefined);
    expect(result[0].verificationBadge).toBe('NONE');
  });
});
