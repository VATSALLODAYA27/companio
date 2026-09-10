/**
 * Re-exports the API-shared types (@companio/shared) plus the handful of
 * response envelopes/route-specific shapes that aren't worth putting in
 * that package because they're purely about how this web client calls
 * the API, not a contract the API/shared package itself needs to know
 * about.
 */
export * from '@companio/shared';

import type {
  ActivityKey,
  Availability,
  ConnectionRequestView,
  ConnectionView,
} from '@companio/shared';

export interface SessionResponse {
  authenticated: true;
  userId: string;
}

export interface MeResponse {
  id: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface ActivityOption {
  key: ActivityKey;
  label: string;
}

export interface ActivitiesListResponse {
  activities: ActivityOption[];
}

export interface MyActivitySelection {
  activityKey: ActivityKey;
  label: string;
  availability: Availability;
}

export interface NearbyResponse<T> {
  results: T[];
}

export interface MapNearbyResponse<T> {
  pins: T[];
}

export type IncomingRequestsResponse = ConnectionRequestView[];
export type OutgoingRequestsResponse = ConnectionRequestView[];
export type ConnectionsResponse = ConnectionView[];
