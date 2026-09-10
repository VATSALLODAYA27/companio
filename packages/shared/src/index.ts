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

export const AVAILABILITY_VALUES = [
  'NOW',
  'TODAY',
  'WEEKEND',
  'NOT_AVAILABLE',
] as const;

// Bucketed age ranges only — the product never stores or displays an
// exact date of birth or age (see SECURITY.md "Data minimization").
export const AGE_RANGE_VALUES = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;
export type AgeRange = (typeof AGE_RANGE_VALUES)[number];

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

/** What a profile actually shows about verification — never the raw provider rows. */
export type VerificationBadge = 'GOOGLE_VERIFIED' | 'NONE';

export interface ProfileView {
  firstName: string;
  photoUrl: string | null;
  ageRange: AgeRange | null;
  bio: string | null;
  city: string | null;
  languages: string[];
  discoverable: boolean;
  hidden: boolean;
  verificationBadge: VerificationBadge;
  updatedAt: string;
}

export interface ActivitySelection {
  activityKey: ActivityKey;
  label: string;
  availability: Availability;
}

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

// The only radii the discovery search accepts (1/3/5/10/25/50 km) — a
// fixed set, not an arbitrary client-supplied number, so a request can
// never be used to probe an unbounded area.
export const SEARCH_RADIUS_METERS_VALUES = [1000, 3000, 5000, 10000, 25000, 50000] as const;
export type SearchRadiusMeters = (typeof SEARCH_RADIUS_METERS_VALUES)[number];

// What discovery ever reveals about another user — no id-linkable exact
// location, no raw distance, no email, no internal fields.
export interface NearbyCompanion {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  ageRange: AgeRange | null;
  verificationBadge: VerificationBadge;
  activityKey: ActivityKey;
  availability: Exclude<Availability, 'NOT_AVAILABLE'>;
  distanceLabel: DistanceLabel;
}

// Every position GET /map/nearby returns is randomized by up to this
// many meters from the user's real position (see SECURITY.md §5).
// Exposed here so the web client can render an honest "somewhere in
// this circle" indicator around a pin instead of implying pinpoint
// accuracy — the server enforces the actual fuzzing, this constant is
// only for that UI affordance.
export const MAP_FUZZ_RADIUS_METERS = 150;

// A map pin for another nearby user (Phase 7). Same public fields as
// NearbyCompanion, plus a position — latitude/longitude here are ALWAYS
// the fuzzed position (randomized within MAP_FUZZ_RADIUS_METERS,
// deterministic per viewer+target+calendar day), never the real
// coordinate. This is the one place in the API a lat/lng pair is ever
// returned for a user other than the caller — see SECURITY.md §5 for
// why that's still safe.
export interface MapPin {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  ageRange: AgeRange | null;
  verificationBadge: VerificationBadge;
  activityKey: ActivityKey;
  availability: Exclude<Availability, 'NOT_AVAILABLE'>;
  distanceLabel: DistanceLabel;
  latitude: number;
  longitude: number;
}

export type ConnectionRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export const CONNECTION_REQUEST_STATUS_VALUES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
] as const;

// The other party's public info on a request or connection — same
// minimal shape as NearbyCompanion, deliberately no email/exact
// location/internal ids beyond the routable userId.
export interface ConnectionCounterpart {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  verificationBadge: VerificationBadge;
}

export interface ConnectionRequestView {
  id: string;
  activityKey: ActivityKey;
  status: ConnectionRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  // The requester on an incoming request, the recipient on an outgoing
  // one — always "the other person", never the caller themselves.
  otherUser: ConnectionCounterpart;
}

export interface ConnectionView {
  id: string;
  activityKey: ActivityKey;
  createdAt: string;
  // Always present — every Connection gets exactly one Conversation at
  // the moment it's created (see ConnectionsService.acceptRequest) — so
  // a client never has to handle "no conversation yet" before chatting.
  conversationId: string;
  otherUser: ConnectionCounterpart;
}

// A single chat message, as returned by GET/POST
// /conversations/:id/messages and pushed live over the 'message' socket
// event. senderId is a plain userId — no more sensitive than the ids
// already exposed by discovery/connections — so the client can tell
// which side of the conversation each message belongs to.
export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
}
