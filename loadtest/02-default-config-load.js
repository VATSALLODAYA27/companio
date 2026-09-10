// Phase 10 load test — default-configuration capacity check.
//
// Runs against the app's REAL, as-shipped rate limits (whatever
// .env/.env.example currently configures — RATE_LIMIT_MAX_DISCOVERY=20,
// RATE_LIMIT_MAX_MAP=20 by default). Because all traffic in this test
// originates from one machine (one IP) and the throttler tracks by IP
// (see 01-rate-limit-fairness.js's docblock), this scenario is NOT a
// measurement of the server's raw processing capacity — it mostly
// measures "does the throttle actually engage correctly, and does the
// server stay healthy (only ever 200/429, never 500) once it does."
// The raw-capacity measurement is 03-capacity-relaxed-limits.js.
//
// Run with: k6 run loadtest/02-default-config-load.js
// Requires loadtest/.vu-sessions.json (00-provision-sessions.js).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const sessions = JSON.parse(open('./.vu-sessions.json'));
const users = sessions.users;

const discoveryOk = new Counter('discovery_200');
const discoveryThrottled = new Counter('discovery_429');
const discoveryError = new Counter('discovery_5xx_or_other');
const discoveryOkDuration = new Trend('discovery_200_duration_ms');

const mapOk = new Counter('map_200');
const mapThrottled = new Counter('map_429');
const mapError = new Counter('map_5xx_or_other');
const mapOkDuration = new Trend('map_200_duration_ms');

export const options = {
  scenarios: {
    default_config_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '15s', target: 0 },
      ],
      gracefulStop: '5s',
    },
  },
  thresholds: {
    // The only hard correctness requirement: never a 5xx, no matter how
    // hard the throttle is engaging. 429 is a correct, expected response
    // under this load profile — it is not counted as a failure here.
    'discovery_5xx_or_other': ['count==0'],
    'map_5xx_or_other': ['count==0'],
  },
};

export default function () {
  const user = users[__VU % users.length];

  const d = http.get(`${BASE}/discovery/nearby?activityKey=trekking&radiusMeters=25000`, {
    headers: { Cookie: user.sessionCookie },
  });
  if (d.status === 200) {
    discoveryOk.add(1);
    discoveryOkDuration.add(d.timings.duration);
  } else if (d.status === 429) {
    discoveryThrottled.add(1);
  } else {
    discoveryError.add(1);
  }
  check(d, { 'discovery status is 200 or 429, never 5xx': (r) => r.status < 500 });

  sleep(0.3);

  const m = http.get(`${BASE}/map/nearby?activityKey=trekking&radiusMeters=25000`, {
    headers: { Cookie: user.sessionCookie },
  });
  if (m.status === 200) {
    mapOk.add(1);
    mapOkDuration.add(m.timings.duration);
  } else if (m.status === 429) {
    mapThrottled.add(1);
  } else {
    mapError.add(1);
  }
  check(m, { 'map status is 200 or 429, never 5xx': (r) => r.status < 500 });

  sleep(0.5);
}
