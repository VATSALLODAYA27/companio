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

// Block/report categories (Phase 8) — mirror prisma/schema.prisma's
// ReportCategory/ReportStatus enums exactly; keep the two in sync by
// hand, the same way every other fixed-set constant in this file does.
export const REPORT_CATEGORY_VALUES = [
  'HARASSMENT',
  'SPAM',
  'FAKE_PROFILE',
  'INAPPROPRIATE_BEHAVIOR',
  'SUSPICIOUS_ACTIVITY',
  'OTHER',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORY_VALUES)[number];

export type ReportStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';

// A user the caller has blocked. Only the fields useful for reviewing
// and managing a block list — no verification badge, no activities;
// this is a safety management view, not a discovery/profile view.
// firstName/photoUrl are nullable because a blocked user's profile can
// be incomplete (or, in principle, gone) without that breaking the
// caller's ability to see and manage their own block list.
export interface BlockedUserView {
  userId: string;
  firstName: string | null;
  photoUrl: string | null;
  blockedAt: string;
}

// A report the caller has filed. reportedUserId is the raw id, not a
// resolved profile view — this is the reporter's own historical record
// of who and what they reported, independent of whatever that person's
// profile looks like now.
export interface ReportView {
  id: string;
  reportedUserId: string;
  category: ReportCategory;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
}
