// Phase 10 load test — raw capacity measurement (rate limiting
// deliberately relaxed for THIS run only).
//
// 01/02 show that this app's real, shipped configuration limits any
// single IP to ~20 req/min on /discovery/nearby and /map/nearby
// regardless of how many authenticated users are behind it — so running
// a bigger k6 ramp against the default config would only measure how
// fast the throttle engages, which 02 already covers. To actually
// answer "how much load can the Node process + PostGIS query + Postgres
// connection pool handle," this run targets a server booted with
// RATE_LIMIT_MAX_DEFAULT/DISCOVERY/MAP/CONNECTIONS/MESSAGES set very
// high (see loadtest/run-all.sh) — approximating what many different
// real users on many different IPs would actually experience, since in
// production the IP-sharing problem 01 demonstrates mostly wouldn't
// apply across genuinely different households/networks.
//
// This is NOT the server's default behavior and must never be reported
// as "the app can handle N req/s" without that caveat — see SCALING.md
// "Methodology" for the exact wording used when reporting these numbers.
//
// Run with: k6 run loadtest/03-capacity-relaxed-limits.js
// Requires loadtest/.vu-sessions.json AND a server booted with relaxed
// RATE_LIMIT_MAX_* env vars (loadtest/run-all.sh handles both).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const sessions = JSON.parse(open('./.vu-sessions.json'));
const users = sessions.users;
const pair = sessions.connectedPair;
const conversationId = pair.conversationId;
const chatUsers = [users[pair.userAIndex], users[pair.userBIndex]];

const discoveryOk = new Counter('discovery_200');
const discoveryOther = new Counter('discovery_non_200');
const discoveryDuration = new Trend('discovery_200_duration_ms');

const mapOk = new Counter('map_200');
const mapOther = new Counter('map_non_200');
const mapDuration = new Trend('map_200_duration_ms');

const messageOk = new Counter('message_201');
const messageOther = new Counter('message_non_201');
const messageDuration = new Trend('message_201_duration_ms');

export const options = {
  scenarios: {
    // Bigger ramp than 02 — this is deliberately pushing toward the
    // real ceiling, not just confirming the throttle engages.
    capacity_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '20s', target: 40 },
        { duration: '30s', target: 40 },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '5s',
      exec: 'discoveryAndMap',
    },
    chat_background_write: {
      executor: 'constant-vus',
      vus: 2,
      duration: '75s',
      exec: 'chatMessages',
    },
  },
  thresholds: {
    'discovery_non_200': ['count==0'],
    'map_non_200': ['count==0'],
    'discovery_200_duration_ms': ['p(95)<1000'],
    'map_200_duration_ms': ['p(95)<1000'],
  },
};

export function discoveryAndMap() {
  const user = users[__VU % users.length];

  const d = http.get(`${BASE}/discovery/nearby?activityKey=trekking&radiusMeters=25000`, {
    headers: { Cookie: user.sessionCookie },
  });
  if (d.status === 200) {
    discoveryOk.add(1);
    discoveryDuration.add(d.timings.duration);
  } else {
    discoveryOther.add(1);
  }
  check(d, { 'discovery 200 under relaxed limits': (r) => r.status === 200 });

  const m = http.get(`${BASE}/map/nearby?activityKey=trekking&radiusMeters=25000`, {
    headers: { Cookie: user.sessionCookie },
  });
  if (m.status === 200) {
    mapOk.add(1);
    mapDuration.add(m.timings.duration);
  } else {
    mapOther.add(1);
  }
  check(m, { 'map 200 under relaxed limits': (r) => r.status === 200 });

  sleep(0.2);
}

export function chatMessages() {
  const sender = chatUsers[__VU % 2];
  // .vu-sessions.json only ever persists cookieHeader/csrfToken (not a
  // pre-built authHeaders object — see 00-provision-sessions.js), so
  // build the mutating-request headers from those here rather than
  // assuming a field that was never actually saved.
  const res = http.post(
    `${BASE}/conversations/${conversationId}/messages`,
    JSON.stringify({ body: `load test message ${__ITER} from VU${__VU}` }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: sender.cookieHeader,
        'X-CSRF-Token': sender.csrfToken,
      },
    },
  );
  if (res.status === 201) {
    messageOk.add(1);
    messageDuration.add(res.timings.duration);
  } else {
    messageOther.add(1);
  }
  check(res, { 'message sent (201)': (r) => r.status === 201 });
  sleep(1);
}
