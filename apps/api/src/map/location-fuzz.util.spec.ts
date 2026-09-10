import { MAP_FUZZ_RADIUS_METERS } from '@companio/shared';
import { fuzzPosition } from './location-fuzz.util';

const EARTH_RADIUS_METERS = 6371000;

/** Independent haversine implementation, deliberately not reusing any
 * internal math from location-fuzz.util.ts, so this test can't pass
 * just because both sides share the same bug. */
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

describe('fuzzPosition', () => {
  const REAL = { realLatitude: 19.1728, realLongitude: 72.9425 };
  const DAY = new Date('2026-09-10T12:00:00.000Z');

  it('is deterministic for the same viewer, target, and day', () => {
    const a = fuzzPosition({ viewerId: 'v1', targetId: 't1', ...REAL, now: DAY });
    const b = fuzzPosition({ viewerId: 'v1', targetId: 't1', ...REAL, now: DAY });
    expect(a).toEqual(b);
  });

  it('never moves the point more than MAP_FUZZ_RADIUS_METERS', () => {
    // Sample many (viewer, target) pairs to exercise the full range of
    // the derived angle/radius, not just one lucky seed.
    for (let i = 0; i < 200; i++) {
      const result = fuzzPosition({
        viewerId: `viewer-${i}`,
        targetId: `target-${i}`,
        ...REAL,
        now: DAY,
      });
      const distance = haversineMeters({ latitude: REAL.realLatitude, longitude: REAL.realLongitude }, result);
      expect(distance).toBeLessThanOrEqual(MAP_FUZZ_RADIUS_METERS + 0.5); // small float slack
    }
  });

  it('differs for different viewers looking at the same target on the same day', () => {
    const a = fuzzPosition({ viewerId: 'viewer-a', targetId: 't1', ...REAL, now: DAY });
    const b = fuzzPosition({ viewerId: 'viewer-b', targetId: 't1', ...REAL, now: DAY });
    expect(a).not.toEqual(b);
  });

  it('differs for different targets seen by the same viewer on the same day', () => {
    const a = fuzzPosition({ viewerId: 'v1', targetId: 'target-a', ...REAL, now: DAY });
    const b = fuzzPosition({ viewerId: 'v1', targetId: 'target-b', ...REAL, now: DAY });
    expect(a).not.toEqual(b);
  });

  it('differs across calendar days for the same viewer and target (no refresh-jitter within a day, but not frozen forever)', () => {
    const day1 = fuzzPosition({ viewerId: 'v1', targetId: 't1', ...REAL, now: new Date('2026-09-10T00:00:00.000Z') });
    const day2 = fuzzPosition({ viewerId: 'v1', targetId: 't1', ...REAL, now: new Date('2026-09-11T00:00:00.000Z') });
    expect(day1).not.toEqual(day2);
  });

  it('does not jitter within the same UTC calendar day', () => {
    const morning = fuzzPosition({
      viewerId: 'v1',
      targetId: 't1',
      ...REAL,
      now: new Date('2026-09-10T01:00:00.000Z'),
    });
    const evening = fuzzPosition({
      viewerId: 'v1',
      targetId: 't1',
      ...REAL,
      now: new Date('2026-09-10T23:00:00.000Z'),
    });
    expect(morning).toEqual(evening);
  });

  it('never returns the exact real coordinate (the derived radius is only exactly 0 for a 1-in-2^32 hash)', () => {
    const result = fuzzPosition({ viewerId: 'v1', targetId: 't1', ...REAL, now: DAY });
    expect(result).not.toEqual({ latitude: REAL.realLatitude, longitude: REAL.realLongitude });
  });

  it('stays finite and bounded near the pole (defensive cos(lat) guard)', () => {
    const result = fuzzPosition({
      viewerId: 'v1',
      targetId: 't1',
      realLatitude: 89.999,
      realLongitude: 10,
      now: DAY,
    });
    expect(Number.isFinite(result.latitude)).toBe(true);
    expect(Number.isFinite(result.longitude)).toBe(true);
  });
});
