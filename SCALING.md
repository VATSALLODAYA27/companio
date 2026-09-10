# SCALING.md — Companio Prototype

Load test results and bottleneck analysis (Phase 10). This is a
measurement and analysis document, not a remediation project — where
the load test found something that clearly needs fixing before real
users, it's fixed (see "Fixed as part of this phase" below); where it
found something that needs a real infrastructure decision this
prototype doesn't have the context to make, it's documented as a
finding for whoever does the deployment/scaling work in Phase 11 and
beyond — the same judgment call this project has made consistently
(the map-fuzzing residual-averaging risk in DATABASE.md, the
account-deletion cascade gap also in DATABASE.md).

## Methodology

All three test runs used [k6](https://k6.io) (`loadtest/*.js`) against
the real, built API (`node dist/main.js`, not `nest start --watch`) with
a real PostgreSQL 16 + PostGIS database seeded with a **5,000-user
background population** (`scripts/loadtest-seed.sql` — profiles,
activities, and locations clustered around a real city, matching the
coordinates already used in README's manual-testing walkthroughs) so
`/discovery/nearby` and `/map/nearby` queries had a genuine candidate
set to filter and rank (536 matching background users within 25km at
the radius these tests query, per the seed script's own reported
distribution) rather than a near-empty table. Ten real users were
registered over real HTTP (`loadtest/00-provision-sessions.js`) as the
load-generating identities — not the same rows as the background
population — with two of them connected via a real accepted connection
request so chat could be exercised too. Every test run's data was
removed afterward (`scripts/loadtest-cleanup.sql`); the database was
confirmed empty (`SELECT count(*) FROM users` → `0`) before this
document was written.

**Critical caveat — this sandbox is not a production topology.** k6,
the Node API process, and Postgres all ran on the *same* 2-CPU, 7.8GB
container for every test in this document. A real deployment runs the
load generator, the API, and the database on separate, independently
provisioned machines (see ARCHITECTURE.md "Scale-up path"). That means
the **absolute** latency and throughput numbers below are not a
production capacity forecast — they measure this shared, resource-
constrained sandbox, and the CPU-contention finding in particular (see
"Finding 2") is partly an artifact of that sharing, not solely a
statement about the application's own efficiency. What *is* valid
project-wide, and the actual point of this exercise: relative
comparisons (did the server stay correct under load — never a 5xx, only
200/429), the rate-limit fairness finding (a property of the code, not
the sandbox), and the general shape of where load concentrates.

Every scenario is re-runnable: `k6 run loadtest/01-rate-limit-fairness.js`,
`02-default-config-load.js`, `03-capacity-relaxed-limits.js`, in that
order, after `00-provision-sessions.js` and `scripts/loadtest-seed.sql`
(see each file's own docblock for exact prerequisites and env vars).

## Finding 1 — the rate limiter shares one budget per IP, not per user

`@nestjs/throttler`'s `ThrottlerGuard` (registered globally in
`app.module.ts`, never subclassed or given a custom `getTracker`) keys
its rate-limit bucket as `sha256(ControllerName-handlerName-throttlerName-tracker)`
where `tracker` defaults to `req.ip`
(`node_modules/@nestjs/throttler/dist/throttler.guard.js`). That means
the bucket is scoped per **route** (discovery, map, connections, etc.
each get their own budget — confirmed, not just read from source) but
only per **IP** *within* that route — never per session, per user, or
per account.

`loadtest/01-rate-limit-fairness.js` proved this concretely, not just
from reading the code: two different, legitimately authenticated users
(A and B, real accounts, real sessions) making requests to
`GET /discovery/nearby` from the same source IP — exactly what k6 looks
like, and exactly what two real users behind the same office NAT,
mobile carrier CGNAT, or VPN exit would look like to this server — share
one 20-requests-per-minute budget. In the actual run: user A made 14
successful requests, then user B got **throttled on B's own 7th
request** (`{"user":"B","n":7,"status":429}` — see
`loadtest/results/01-fairness.txt`), having made only 6 successful
requests of their own. B never came close to making 20 requests
themselves; they were throttled by A's traffic entirely.

**Why this matters in this specific product.** Companio's whole premise
is proximity — two people who happen to be near each other. Two
unrelated Companio users on the same mobile carrier's CGNAT range in the
same city, or two members of the same household, are a completely
ordinary case this rate-limiting scheme actively punishes: the first
person to open the app that minute silently spends the second person's
budget too. This is a real fairness bug, not just a theoretical
IP-sharing edge case.

**Not fixed in this phase, deliberately.** The correct fix — keying the
tracker by session id for authenticated routes, falling back to IP only
for the genuinely unauthenticated ones (`/auth/register`, `/auth/login`)
— is a `ThrottlerGuard` subclass with a custom `getTracker`/`generateKey`
touching every rate-limited route's behavior, which is exactly the kind
of change that itself needs the same build → test → live-verify rigor
every other phase has gotten, not a rushed patch tucked into a load-test
writeup. It's recorded here as a concrete, evidence-backed
recommendation rather than fixed ad hoc:

> **Recommendation:** give `ThrottlerGuard` a custom tracker that uses
> the session id (from the already-verified, already-signed session
> cookie) for any request that passed `SessionAuthGuard`, and only falls
> back to `req.ip` for the handful of genuinely unauthenticated routes
> (`register`, `login`). This closes the shared-budget problem for every
> authenticated route in one change, without weakening protection against
> an anonymous attacker (who still has no session, and is still tracked
> by IP exactly as today).

## Finding 2 — CPU contention, not the connection pool, bounds this sandbox's throughput

`loadtest/02-default-config-load.js` (the app's real, shipped rate
limits — `RATE_LIMIT_MAX_DISCOVERY`/`MAP`=20/min) confirmed the
throttle engages exactly as configured and the server stayed
completely healthy under sustained pressure: of 826 attempted iterations
over a 20-VU ramp, **exactly 20 discovery and 20 map requests
succeeded** (matching the configured limit precisely), the remaining
806 of each got a clean `429`, and **zero requests of any kind returned
a 5xx** (`discovery_5xx_or_other: 0/s`, `map_5xx_or_other: 0/s` —
100% of 1,652 checks passed). The 20 successful requests were fast:
discovery p95 = 48.5ms, map p95 = 54.3ms (map's slightly higher cost is
consistent with it doing everything discovery does plus
`fuzzPosition`'s SHA-256 computation per row — see DATABASE.md "The
map-position query and coordinate fuzzing").

To measure actual capacity rather than how fast the throttle engages
(see Finding 1 — with all traffic behind one IP, 20/min *is* the
ceiling regardless of load), `loadtest/03-capacity-relaxed-limits.js`
re-ran a much bigger ramp (0→40 VUs) against a server booted with every
`RATE_LIMIT_MAX_*` raised to 1,000,000 for that run only (never the
app's real configuration — see that file's own docblock). Results:

| Metric | 02 (20 VUs, real limits) | 03 (40 VUs, limits relaxed) |
|---|---|---|
| Discovery successes | 20 (of 826 attempts) | 1,827 (of 1,827 attempts — 0 failed) |
| Discovery p95 latency | 48.5ms | 747ms |
| Map successes | 20 | 1,827 (0 failed) |
| Map p95 latency | 54.3ms | 747ms |
| Chat message successes | n/a | 114 (0 failed), p95 593ms |
| 5xx responses | 0 | 0 |
| Checks passed | 100% | 100% |

The server never broke under 40 concurrent VUs sustaining ~50 req/s —
every request that should have succeeded did, correctly, with no
errors. But per-request latency grew roughly 15x (48ms → 747ms p95) as
concurrency rose, which is the number worth explaining before treating
it as "the app's ceiling."

**The investigation, not just the number.** `pg_stat_activity` was
sampled every 5s throughout the 40-VU run (`loadtest/results/pg-connections-run2.txt`):
active connections rose to and then plateaued at **exactly ~10-11** for
the entire sustained-load window, matching `pg`'s (the underlying
driver's) undocumented-in-this-codebase default `Pool` size of 10 —
nothing in `PrismaService` had ever previously set or even exposed this
as configurable. That correlation (connections capped at 10, latency
degrading under &gt;10 concurrent DB-bound requests) is the obvious
hypothesis: the pool, not Postgres or the CPU, is the bottleneck.

**That hypothesis was tested, not just asserted — and it turned out to
be wrong, or at least incomplete.** This phase added `DB_POOL_MAX` (see
`prisma.service.ts`'s docblock and `.env.example`) specifically to test
it: the identical 40-VU scenario was re-run with `DB_POOL_MAX=25`.
`pg_stat_activity` confirmed the pool actually grew to **26 concurrent
connections this time** (`loadtest/results/pg-connections-pool25.txt`)
— so the config change worked as intended — but latency got *worse*,
not better (discovery p95 747ms → 885ms; `uptime`'s 1-minute load
average climbed from 7.04 to 10.95 on this 2-CPU box, well past
saturation either way). Raising the pool let more queries run
concurrently, which meant more concurrent CPU-bound work (query
planning/execution, JSON serialization, and — for map specifically —
per-row SHA-256 fuzzing) competing for the same 2 CPU cores this
sandbox shares between k6 itself, the Node process, and Postgres. **The
connection pool was a correlated symptom in this environment, not the
root cause; CPU contention across three co-located processes on 2 cores
is.**

**What this means, honestly:**

- The `DB_POOL_MAX=10` default is *not* proven to be a real bottleneck
  by this data — it wasn't, in this environment, once actually tested.
  It remains a reasonable, low-risk, **opt-in** thing to have available
  (see `.env.example`) for a real deployment where Postgres and the API
  run on separate, adequately-provisioned hosts and the pool really
  could be the first thing to saturate rather than CPU — but Phase 10's
  own evidence does not justify raising it by default, and doing so
  here made things measurably worse.
- The real, load-test-confirmed finding is narrower and more useful:
  **this specific 2-CPU sandbox cannot be used to forecast this
  application's production request-per-second ceiling**, because the
  load generator competing with the app and the database for the same
  cores means every latency number here is inflated by resource
  contention that a real deployment (separate load-test client, API
  behind a load balancer, Postgres on its own instance) would not have.
  A meaningful capacity number needs a properly separated environment —
  out of scope for what this prototype's sandbox can produce, and
  explicitly not claimed here.
- What *is* solidly established, independent of the CPU-sharing caveat:
  the server never returned a single 5xx across either scenario, the
  rate limiter engages exactly as configured, and the PostGIS
  discovery/map query itself stayed fast (sub-55ms p95) under the
  load level the app's own default rate limits actually permit through
  in the first place (20/min per IP) — which, combined with Finding 1,
  is arguably the more important real-world number: the query is not
  the constraint anyone is likely to hit first.

## Fixed as part of this phase

- **`DB_POOL_MAX` (optional, `.env.example`)** — makes the Postgres
  connection pool size configurable via `PrismaService` rather than
  silently inheriting `pg`'s undocumented-in-this-codebase default of
  10. Zero behavior change if unset (matches every prior default
  exactly). Added specifically to run the controlled experiment in
  Finding 2, and left in place because it's a legitimate, low-risk
  operational lever for a real deployment even though this phase's own
  data doesn't show a need to change it from 10 today. `prisma.service.spec.ts`
  (new) tests the parsing logic (unset → unchanged behavior, numeric →
  passed through, non-numeric → ignored rather than passing `NaN` to
  the pool).

## Recommendations for later phases (not fixed here)

1. **Per-session rate-limit tracking for authenticated routes**
   (Finding 1) — the highest-priority item this load test surfaced. A
   custom `ThrottlerGuard` tracker keyed by session id, falling back to
   IP only for unauthenticated routes.
2. **A properly separated load-test environment before trusting any
   absolute throughput number** (Finding 2) — run `loadtest/03-capacity-relaxed-limits.js`
   (or its eventual successor) from a separate machine against a
   deployed instance with the database on its own host, once Phase 11
   stands up real infrastructure, before writing down a number anyone
   will use for capacity planning.
3. **`DB_POOL_MAX` sizing** — once (2) exists, re-run the pool-size
   comparison in an environment where CPU contention isn't confounding
   the result, and set it deliberately against real Postgres
   `max_connections` and however many API instances will share that
   budget (see ARCHITECTURE.md "Scale-up path" — PgBouncer enters the
   picture once there's more than one API instance for exactly this
   reason).
4. **Read replicas for discovery/map reads**, already anticipated in
   ARCHITECTURE.md's scale-up path — this phase's data doesn't yet
   demonstrate Postgres itself as a bottleneck (connections plateaued
   well under `max_connections=100`, and the query stayed fast at low
   concurrency), so this remains a "when traffic actually justifies it"
   item, not an urgent one.

## Reproducing these results

```bash
# 1. Seed a realistic background population (adjust -v population=N)
export PGPASSWORD=companio_dev_password
psql -U companio -h localhost -d companio -v population=5000 -f scripts/loadtest-seed.sql

# 2. Build and boot the API with its real, default configuration
cd apps/api && npm run build && node dist/main.js &

# 3. Provision 10 real load-test users (paces itself under the auth
#    rate limit — takes about a minute)
cd ../../loadtest
k6 run 00-provision-sessions.js | tee results/00-provision.txt
# extract the VU_SESSIONS_JSON line from that log into .vu-sessions.json
# (see the extraction one-liner in this repo's session history, or
# write your own — it's one regex over k6's logfmt output)

# 4. Rate-limit fairness (fast, ~1s)
k6 run 01-rate-limit-fairness.js

# 5. Default-configuration behavior check (~1 min)
k6 run 02-default-config-load.js

# 6. Stop the server, reboot with rate limits relaxed, run the capacity
#    scenario (~75s) — see 03-capacity-relaxed-limits.js's own docblock
#    for the exact env vars

# 7. Clean up every row either step created
psql -U companio -h localhost -d companio -f scripts/loadtest-cleanup.sql
```
