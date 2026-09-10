// Phase 10 load test — rate-limit fairness under a shared IP.
//
// @nestjs/throttler's default tracker is req.ip (see
// node_modules/@nestjs/throttler/dist/throttler.guard.js:
// `async getTracker(req) { return req.ip; }`), and this app never
// overrides it with a per-session/per-user tracker (see
// ARCHITECTURE.md/SECURITY.md — grep for getTracker turns up nothing).
// Its bucket key is `sha256(ControllerName-handlerName-throttlerName-tracker)`
// — per ROUTE, but only per IP within that route, never per user.
//
// This script proves what that means concretely: two DIFFERENT,
// legitimately authenticated users making requests from the same
// source IP (exactly what k6 itself does, and exactly what two real
// users behind the same office NAT / mobile carrier CGNAT / VPN exit
// would look like to this server) share ONE rate-limit budget for
// GET /discovery/nearby (RATE_LIMIT_MAX_DISCOVERY, default 20/min) —
// user B can get 429'd by user A's traffic despite never having made
// 20 requests themselves.
//
// Run with: k6 run loadtest/01-rate-limit-fairness.js
// Requires loadtest/.vu-sessions.json (run 00-provision-sessions.js
// via loadtest/run-all.sh first) and a server started fresh enough
// that neither user has already used part of the discovery bucket
// this minute (run-all.sh handles the ordering).

import http from 'k6/http';
import { sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const sessions = JSON.parse(open('./.vu-sessions.json'));
const userA = sessions.users[0];
const userB = sessions.users[1];

export const options = { vus: 1, iterations: 1 };

export default function () {
  const results = [];

  // 14 requests as user A (well under the 20/min limit on its own),
  // then user B immediately makes requests on the SAME bucket — if the
  // tracker were per-user, B would get a fresh 20/min budget; if it's
  // per-IP (as the code shows it is), B inherits what's left of A's.
  for (let i = 1; i <= 14; i++) {
    const res = http.get(`${BASE}/discovery/nearby?activityKey=trekking&radiusMeters=25000`, {
      headers: { Cookie: userA.sessionCookie },
    });
    results.push({ user: 'A', n: i, status: res.status });
  }

  for (let i = 1; i <= 10; i++) {
    const res = http.get(`${BASE}/discovery/nearby?activityKey=trekking&radiusMeters=25000`, {
      headers: { Cookie: userB.sessionCookie },
    });
    results.push({ user: 'B', n: i, status: res.status });
  }

  console.log('FAIRNESS_RESULTS_JSON:' + JSON.stringify(results));

  const firstB429 = results.find((r) => r.user === 'B' && r.status === 429);
  const bSuccesses = results.filter((r) => r.user === 'B' && r.status === 200).length;
  console.log(
    firstB429
      ? `User B got its first 429 on B's own request #${firstB429.n} (after only ${bSuccesses} of B's own requests succeeded) — B never came close to making 20 requests itself.`
      : 'User B was never throttled in this run — see raw results.',
  );
}
