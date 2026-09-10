import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAP_FUZZ_RADIUS_METERS } from '@companio/shared';
import { MapService } from './map.service';
import { DiscoveryRepository } from '../discovery/discovery.repository';
import { ActivitiesService } from '../activities/activities.service';
import { LocationService } from '../location/location.service';

const EARTH_RADIUS_METERS = 6371000;

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

describe('MapService', () => {
  let repository: jest.Mocked<Pick<DiscoveryRepository, 'findNearbyForMap'>>;
  let activities: jest.Mocked<Pick<ActivitiesService, 'findIdsByKeys'>>;
  let location: jest.Mocked<Pick<LocationService, 'hasLocation'>>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;
  let service: MapService;

  beforeEach(() => {
    repository = { findNearbyForMap: jest.fn().mockResolvedValue([]) };
    activities = { findIdsByKeys: jest.fn() };
    location = { hasLocation: jest.fn().mockResolvedValue(true) };
    config = { get: jest.fn().mockReturnValue(undefined) };

    service = new MapService(
      repository as unknown as DiscoveryRepository,
      activities as unknown as ActivitiesService,
      location as unknown as LocationService,
      config as unknown as ConfigService,
    );
  });

  it('rejects when the caller has not set a location yet', async () => {
    location.hasLocation.mockResolvedValue(false);
    await expect(service.findNearbyPins('u1', 'gym', undefined, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findNearbyForMap).not.toHaveBeenCalled();
  });

  it('rejects an activity key the DB has no id for (defensive)', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map());
    await expect(service.findNearbyPins('u1', 'gym', undefined, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findNearbyForMap).not.toHaveBeenCalled();
  });

  it('falls back to DEFAULT_SEARCH_RADIUS_METERS and offset 0 when omitted', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    config.get.mockImplementation((key: string) =>
      key === 'DEFAULT_SEARCH_RADIUS_METERS' ? '1000' : undefined,
    );

    await service.findNearbyPins('u1', 'gym', undefined, undefined);

    expect(repository.findNearbyForMap).toHaveBeenCalledWith({
      currentUserId: 'u1',
      activityId: 'act-gym',
      radiusMeters: 1000,
      offset: 0,
    });
  });

  it('passes through an explicit radius and offset', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));

    await service.findNearbyPins('u1', 'gym', 5000, 40);

    expect(repository.findNearbyForMap).toHaveBeenCalledWith({
      currentUserId: 'u1',
      activityId: 'act-gym',
      radiusMeters: 5000,
      offset: 40,
    });
  });

  it('maps repository rows to the public shape, replacing raw coordinates with a fuzzed position', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    repository.findNearbyForMap.mockResolvedValue([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: '25-34',
        availability: 'NOW',
        verified: true,
        distanceLabel: '< 250 m',
        rawLatitude: 19.1728,
        rawLongitude: 72.9425,
      },
    ]);

    const result = await service.findNearbyPins('u1', 'gym', undefined, undefined);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: 'u2',
      firstName: 'Asha',
      photoUrl: null,
      ageRange: '25-34',
      activityKey: 'gym',
      availability: 'NOW',
      verificationBadge: 'GOOGLE_VERIFIED',
      distanceLabel: '< 250 m',
    });
    expect(result[0]).not.toHaveProperty('rawLatitude');
    expect(result[0]).not.toHaveProperty('rawLongitude');
    expect(result[0]).not.toHaveProperty('verified');
    expect(typeof result[0].latitude).toBe('number');
    expect(typeof result[0].longitude).toBe('number');

    const distance = haversineMeters(
      { latitude: 19.1728, longitude: 72.9425 },
      { latitude: result[0].latitude, longitude: result[0].longitude },
    );
    expect(distance).toBeLessThanOrEqual(MAP_FUZZ_RADIUS_METERS + 0.5);
  });

  it('maps an unverified row to the NONE badge', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    repository.findNearbyForMap.mockResolvedValue([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: null,
        availability: 'TODAY',
        verified: false,
        distanceLabel: '1-3 km',
        rawLatitude: 19.1728,
        rawLongitude: 72.9425,
      },
    ]);

    const result = await service.findNearbyPins('u1', 'gym', undefined, undefined);
    expect(result[0].verificationBadge).toBe('NONE');
  });

  it('gives the same viewer the same fuzzed position for the same target across two separate calls the same day', async () => {
    activities.findIdsByKeys.mockResolvedValue(new Map([['gym', 'act-gym']]));
    repository.findNearbyForMap.mockResolvedValue([
      {
        userId: 'u2',
        firstName: 'Asha',
        photoUrl: null,
        ageRange: null,
        availability: 'NOW',
        verified: false,
        distanceLabel: '< 250 m',
        rawLatitude: 19.1728,
        rawLongitude: 72.9425,
      },
    ]);

    const first = await service.findNearbyPins('u1', 'gym', undefined, undefined);
    const second = await service.findNearbyPins('u1', 'gym', undefined, undefined);
    expect(first[0].latitude).toBe(second[0].latitude);
    expect(first[0].longitude).toBe(second[0].longitude);
  });
});
