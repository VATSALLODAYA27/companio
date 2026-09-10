// Phase 10 load test — one-time provisioning step.
//
// Registers a small pool of REAL users over real HTTP (not a DB insert —
// this exercises the actual register/profile/activities/location routes,
// same as any real signup) and writes their session/CSRF credentials to
// loadtest/.vu-sessions.json so 01/02/03 can reuse them without
// re-registering (register is rate-limited at RATE_LIMIT_MAX_AUTH,
// default 10/min, so this script paces its own registrations well under
// that rather than tripping its own setup).
//
// All ten users are placed at the exact center of the background
// population scripts/loadtest-seed.sql generates (19.0760, 72.8777 —
// Mumbai), with the same 'trekking'/'running' activities at NOW
// availability, so their /discovery/nearby and /map/nearby calls in
// later scripts return a realistic, non-empty result set. Users 0 and 1
// are additionally connected (a real accepted connection request) so
// 03-capacity-relaxed-limits.js can exercise chat under load too.
//
// Run with: k6 run loadtest/00-provision-sessions.js
// (single VU, single iteration — this is setup, not a load scenario)

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const POOL_SIZE = 10;

export const options = { vus: 1, iterations: 1 };

function parseCookie(res, name) {
  const setCookie = res.headers['Set-Cookie'];
  if (!setCookie) return null;
  const all = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of all) {
    const first = raw.split(';')[0];
    if (first.startsWith(name + '=')) return first;
  }
  return null;
}

function registerAndSetUp(i) {
  const email = `loadtest-vu-${i}@loadtest.local`;
  const password = 'correcthorsebattery1';

  const reg = http.post(
    `${BASE}/auth/register`,
    JSON.stringify({ email, password, firstName: `LoadVU${i}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(reg, { [`vu${i} register 201`]: (r) => r.status === 201 });
  const sessionCookie = parseCookie(reg, 'companio_sid');

  const csrfRes = http.get(`${BASE}/auth/csrf`, { headers: { Cookie: sessionCookie } });
  const csrfCookie = parseCookie(csrfRes, 'companio_csrf');
  const csrfToken = JSON.parse(csrfRes.body).csrfToken;
  const cookieHeader = `${sessionCookie}; ${csrfCookie}`;
  const authHeaders = {
    'Content-Type': 'application/json',
    Cookie: cookieHeader,
    'X-CSRF-Token': csrfToken,
  };

  const sessionRes = http.get(`${BASE}/auth/session`, { headers: { Cookie: sessionCookie } });
  const userId = JSON.parse(sessionRes.body).userId;

  const prof = http.put(
    `${BASE}/profile/me`,
    JSON.stringify({ firstName: `LoadVU${i}`, discoverable: true, hidden: false }),
    { headers: authHeaders },
  );
  check(prof, { [`vu${i} profile 200`]: (r) => r.status === 200 });

  const acts = http.put(
    `${BASE}/profile/me/activities`,
    JSON.stringify({
      activities: [
        { activityKey: 'trekking', availability: 'NOW' },
        { activityKey: 'running', availability: 'NOW' },
      ],
    }),
    { headers: authHeaders },
  );
  check(acts, { [`vu${i} activities 200`]: (r) => r.status === 200 });

  const loc = http.put(
    `${BASE}/location/me`,
    // Exact center of scripts/loadtest-seed.sql's background population
    JSON.stringify({ latitude: 19.076, longitude: 72.8777 }),
    { headers: authHeaders },
  );
  check(loc, { [`vu${i} location 200`]: (r) => r.status === 200 });

  return { userId, email, sessionCookie, csrfCookie, csrfToken, cookieHeader, authHeaders };
}

export default function () {
  const users = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    users.push(registerAndSetUp(i));
    // Pace well under RATE_LIMIT_MAX_AUTH (10/min default) — this
    // script's OWN registrations must not trip the very throttle
    // 01-rate-limit-fairness.js exists to demonstrate on purpose.
    if (i < POOL_SIZE - 1) sleep(7);
  }

  // Connect users[0] and users[1] so the capacity test can exercise
  // chat too, not just discovery/map.
  const sendRes = http.post(
    `${BASE}/connections/requests`,
    JSON.stringify({ recipientId: users[1].userId, activityKey: 'trekking' }),
    { headers: users[0].authHeaders },
  );
  check(sendRes, { 'connection request created': (r) => r.status === 201 });
  const requestId = JSON.parse(sendRes.body).id;

  const acceptRes = http.post(
    `${BASE}/connections/requests/${requestId}/accept`,
    null,
    { headers: users[1].authHeaders },
  );
  check(acceptRes, { 'connection accepted': (r) => r.status === 201 || r.status === 200 });
  const conversationId = JSON.parse(acceptRes.body).conversationId;

  const output = {
    users: users.map(({ userId, email, sessionCookie, csrfCookie, csrfToken, cookieHeader }) => ({
      userId, email, sessionCookie, csrfCookie, csrfToken, cookieHeader,
    })),
    connectedPair: { userAIndex: 0, userBIndex: 1, conversationId },
  };

  // k6 scripts can't write files directly (sandboxed JS runtime) — emit
  // as a single line to stdout, redirected to a file by the caller
  // (see loadtest/run-all.sh).
  console.log('VU_SESSIONS_JSON:' + JSON.stringify(output));
}
