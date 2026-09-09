/**
 * Types shared between apps/api and apps/web. Kept intentionally small —
 * only what's needed so far. Grows alongside the phases.
 */

export const ACTIVITY_KEYS = [
  'trekking',
  'bowling',
  'gym',
  'running',
  'badminton',
  'cricket',
  'football',
  'cycling',
  'photography',
  'hiking',
  'swimming',
  'cafe_hopping',
] as const;

export type ActivityKey = (typeof ACTIVITY_KEYS)[number];

export type Availability = 'NOW' | 'TODAY' | 'WEEKEND' | 'NOT_AVAILABLE';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

/** Distance is always a bucketed label, never raw meters from another user. */
export type DistanceLabel =
  | '< 250 m'
  | '250-500 m'
  | '500 m-1 km'
  | '1-3 km'
  | '3-5 km'
  | '5-10 km'
  | '10-25 km'
  | '25-50 km';
