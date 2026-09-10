import { createHash } from 'crypto';
import { MAP_FUZZ_RADIUS_METERS } from '@companio/shared';

const EARTH_RADIUS_METERS = 6371000;

export interface FuzzedPosition {
  latitude: number;
  longitude: number;
}

/**
 * Randomizes a real coordinate by up to MAP_FUZZ_RADIUS_METERS, per
 * SECURITY.md §5: "a fuzzed map position, randomized within ~150 m,
 * deterministic per (viewer, target, day) so it doesn't jitter into an
 * average on refresh but differs per viewer so results can't be
 * compared to triangulate."
 *
 * Determinism comes from hashing (viewerId, targetId, calendar day in
 * UTC) — no random seed or per-request state is involved, so the exact
 * same three inputs always produce the exact same offset, and changing
 * any one of them (a different viewer, a different target, or the next
 * day) produces an unrelated offset. Two independent uniform [0,1)
 * values are read from disjoint byte ranges of one SHA-256 digest,
 * which is enough entropy for this purpose without needing an external
 * RNG.
 *
 * The offset is drawn uniformly over the *area* of a disk (radius ∝
 * sqrt(u), not radius ∝ u), not uniformly over the radius — a uniform
 * radius would bunch points unrealistically close to the true center.
 *
 * Known, accepted residual risk (see SECURITY.md §5): because a fresh
 * random offset is drawn each calendar day and its expected value is
 * the true position (a disk offset averages to zero), a viewer who
 * recorded a target's fuzzed pin every day for long enough could, in
 * principle, average those samples back toward the real coordinate.
 * This is the same trade-off real dating/companion apps have shipped
 * with historically. Mitigations beyond this prototype's scope: cap
 * how many distinct days of one target's position a single viewer can
 * observe, or move to a per-(viewer,target) *pair* offset that never
 * changes at all (trading "harder to average" for "never varies,
 * easier to memorize"). Flagged here rather than silently accepted.
 */
export function fuzzPosition(params: {
  viewerId: string;
  targetId: string;
  realLatitude: number;
  realLongitude: number;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}): FuzzedPosition {
  const { viewerId, targetId, realLatitude, realLongitude } = params;
  const day = (params.now ?? new Date()).toISOString().slice(0, 10); // UTC YYYY-MM-DD

  const hash = createHash('sha256').update(`${viewerId}:${targetId}:${day}`).digest();
  const u1 = hash.readUInt32BE(0) / 0x100000000;
  const u2 = hash.readUInt32BE(4) / 0x100000000;

  const radius = MAP_FUZZ_RADIUS_METERS * Math.sqrt(u1);
  const angle = 2 * Math.PI * u2;

  const deltaNorthMeters = radius * Math.cos(angle);
  const deltaEastMeters = radius * Math.sin(angle);

  const latRad = (realLatitude * Math.PI) / 180;
  // Guards the longitude conversion near the poles (cos(latRad) -> 0),
  // not a realistic scenario for this product but cheap to make safe.
  const cosLat = Math.max(Math.cos(latRad), 1e-6);

  const deltaLat = (deltaNorthMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const deltaLng = (deltaEastMeters / (EARTH_RADIUS_METERS * cosLat)) * (180 / Math.PI);

  return {
    latitude: realLatitude + deltaLat,
    longitude: realLongitude + deltaLng,
  };
}
