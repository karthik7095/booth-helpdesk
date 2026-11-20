#!/usr/bin/env node
/**
 * User-model load test: N virtual phones behaving like the mobile app, with
 * think time and the app's real cadence, stepped up through several user
 * counts (for example 500 → 1000 → 1500) so each level can be judged.
 *
 *   node scripts/load-users.mjs                                # 500,1000,1500 users
 *   STEPS=1000,1500,2000 HOLD=120 node scripts/load-users.mjs
 *   LOAD_PIN=ABC123 node scripts/load-users.mjs                # + heartbeat, delta pull, summary
 *
 * What each virtual user does
 *   on start        GET /api/auth/me                       (app launch / session restore)
 *   with a PIN      GET /api/voters/summary on start, then
 *                   POST /api/usage/heartbeat every 60 s   (the app's own cadence)
 *                   GET  /api/sync/pull every 30–60 s      (delta sync after a mark or print)
 *                   GET  /api/voters/summary every 45–90 s (stats card refresh)
 *   without a PIN   GET /api/auth/me every 15–30 s         (app brought to the foreground)
 *
 * Nothing here writes voter data. Sessions are shared across virtual users
 * (at most 10, the PIN step's per-IP limit) so the sessions table is not
 * flooded; the server does the same work per request either way.
 *
 * Env: API_URL, STEPS (user counts), RAMP (s to reach each step, default 30),
 *      HOLD (s to hold each step, default 90), LOAD_PIN, OUT (results JSON).
 */
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const API_URL = (process.env.API_URL ?? 'http://103.117.180.71:4000').replace(/\/$/, '');
const STEPS = (process.env.STEPS ?? '500,1000,1500').split(',').map(Number).filter(Boolean);
const RAMP = Number(process.env.RAMP ?? 30);
const HOLD = Number(process.env.HOLD ?? 90);
const LOAD_PIN = process.env.LOAD_PIN?.trim().toUpperCase() || null;
const OUT = process.env.OUT ?? './load-users-results.json';
const REQUEST_TIMEOUT_MS = 30_000;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

// ── metrics ──────────────────────────────────────────────────────────────
const t0 = performance.now();
let phase = 'init';
const samples = []; // { phase, endpoint, ms, status }
const timeline = []; // 5 s buckets: { t, phase, users, requests, errors, p95 }
let activeUsers = 0;
let inflight = 0;

function record(endpoint, ms, status) {
  samples.push({ phase, endpoint, ms, status });
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

let lastBucket = 0;
setInterval(() => {
  const now = samples.length;
  const recent = samples.slice(lastBucket);
  lastBucket = now;
  const sorted = recent.map((s) => s.ms).sort((a, b) => a - b);
  const errors = recent.filter((s) => s.status < 200 || s.status >= 300).length;
  timeline.push({
    t: Math.round((performance.now() - t0) / 1000),
    phase,
    users: activeUsers,
    inflight,
    requests: recent.length,
    rps: Number((recent.length / 5).toFixed(1)),
    errors,
    p50: Number(pct(sorted, 50).toFixed(0)),
    p95: Number(pct(sorted, 95).toFixed(0)),
  });
}, 5000).unref();

// ── http ─────────────────────────────────────────────────────────────────
// Each virtual user owns one keep-alive socket, as a phone's HTTP client does,
// so the server really holds N connections for N users. (fetch's pool would
// quietly share a few dozen sockets between them.)
const target = new URL(API_URL);
const lib = target.protocol === 'https:' ? https : http;
const makeAgent = () => new lib.Agent({ keepAlive: true, keepAliveMsecs: 10_000, maxSockets: 1 });

function request(agent, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (lib === https ? 443 : 80),
        path,
        method,
        agent,
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
          authorization: `Bearer ${token}`,
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 }));
        res.on('error', reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end(payload);
  });
}

async function call(agent, endpoint, method, path, token, body) {
  const started = performance.now();
  inflight++;
  let status = 0;
  try {
    const res = await request(agent, method, path, token, body);
    status = res.status;
    return res;
  } catch (err) {
    status = err?.name === 'TimeoutError' ? -1 : -2; // -1 timeout, -2 transport error
    return null;
  } finally {
    inflight--;
    record(endpoint, performance.now() - started, status);
  }
}

// ── virtual user ─────────────────────────────────────────────────────────
let stopping = false;

async function user(id, token, scoped) {
  activeUsers++;
  const agent = makeAgent();
  try {
    // App launch.
    await call(agent, 'auth-me', 'GET', '/api/auth/me', token);
    if (scoped) await call(agent, 'summary', 'GET', '/api/voters/summary', scoped);

    // Independent schedules per action, like timers in the app.
    const now = () => performance.now();
    const next = scoped
      ? { heartbeat: now() + jitter(0, 60_000), pull: now() + jitter(5_000, 60_000), summary: now() + jitter(10_000, 90_000) }
      : { me: now() + jitter(5_000, 30_000) };
    let lastPulledAt = Date.now() - 60 * 60 * 1000;

    while (!stopping) {
      const [action, at] = Object.entries(next).sort((a, b) => a[1] - b[1])[0];
      const wait = at - now();
      if (wait > 0) await sleep(Math.min(wait, 1000));
      if (stopping) break;
      if (now() < at) continue;

      if (action === 'heartbeat') {
        await call(agent, 'heartbeat', 'POST', '/api/usage/heartbeat', scoped, { opened: false, seconds: 60 });
        next.heartbeat = now() + 60_000;
      } else if (action === 'pull') {
        const res = await call(agent, 'sync-pull', 'GET', `/api/sync/pull?lastPulledAt=${lastPulledAt}`, scoped);
        if (res?.ok) lastPulledAt = Date.now();
        next.pull = now() + jitter(30_000, 60_000);
      } else if (action === 'summary') {
        await call(agent, 'summary', 'GET', '/api/voters/summary', scoped);
        next.summary = now() + jitter(45_000, 90_000);
      } else {
        await call(agent, 'auth-me', 'GET', '/api/auth/me', token);
        next.me = now() + jitter(15_000, 30_000);
      }
    }
  } finally {
    activeUsers--;
    agent.destroy();
  }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const health = await fetch(`${API_URL}/health`);
  if (!health.ok) throw new Error(`API health ${health.status}`);

  // Shared sessions.
  const tokens = [];
  const scopedTokens = [];
  for (let i = 1; i <= 10; i++) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: `Load Test ${i} (sample)`, mobileNumber: `99999010${String(i).padStart(2, '0')}` }),
    });
    if (!res.ok) throw new Error(`login failed ${res.status}`);
    const token = (await res.json()).token;
    tokens.push(token);
    if (LOAD_PIN) {
      const pin = await fetch(`${API_URL}/api/auth/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: LOAD_PIN }),
      });
      if (pin.status === 429) {
        log('PIN step rate-limited (10 per 5 min per IP); continuing with the sessions unlocked so far');
        break;
      }
      if (!pin.ok) throw new Error(`pin failed ${pin.status} ${await pin.text()}`);
      scopedTokens.push((await pin.json()).token);
    }
  }
  if (LOAD_PIN && scopedTokens.length === 0) throw new Error('no session could be unlocked with that PIN');
  log(`sessions: ${tokens.length}${LOAD_PIN ? `, unlocked: ${scopedTokens.length}` : ' (no PIN: /me-only model)'}`);

  const run = {
    startedAt: new Date().toISOString(),
    apiUrl: API_URL,
    pinScoped: Boolean(LOAD_PIN),
    steps: STEPS,
    rampSeconds: RAMP,
    holdSeconds: HOLD,
    phases: [],
  };

  const users = [];
  let started = 0;
  for (const target of STEPS) {
    const toAdd = target - started;
    phase = `ramp-${target}`;
    log(`▸ ramping ${started} → ${target} users over ${RAMP}s`);
    const rampStart = performance.now();
    for (let i = 0; i < toAdd; i++) {
      const id = started + i;
      users.push(user(id, tokens[id % tokens.length], scopedTokens.length ? scopedTokens[id % scopedTokens.length] : null));
      const due = rampStart + ((i + 1) / toAdd) * RAMP * 1000;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
    }
    started = target;

    phase = `hold-${target}`;
    log(`▸ holding ${target} users for ${HOLD}s`);
    const holdFrom = samples.length;
    const holdStart = performance.now();
    await sleep(HOLD * 1000);
    const holdSamples = samples.slice(holdFrom);
    const elapsed = (performance.now() - holdStart) / 1000;
    const byEndpoint = {};
    for (const s of holdSamples) {
      const e = (byEndpoint[s.endpoint] ??= { count: 0, statuses: {}, ms: [] });
      e.count++;
      e.statuses[s.status] = (e.statuses[s.status] ?? 0) + 1;
      e.ms.push(s.ms);
    }
    const endpoints = Object.fromEntries(
      Object.entries(byEndpoint).map(([name, e]) => {
        const sorted = e.ms.sort((a, b) => a - b);
        const ok = Object.entries(e.statuses).filter(([s]) => Number(s) >= 200 && Number(s) < 300).reduce((n, [, c]) => n + c, 0);
        return [
          name,
          {
            requests: e.count,
            rps: Number((e.count / elapsed).toFixed(1)),
            okRate: Number(((ok / e.count) * 100).toFixed(2)),
            statuses: e.statuses,
            p50: Number(pct(sorted, 50).toFixed(0)),
            p95: Number(pct(sorted, 95).toFixed(0)),
            p99: Number(pct(sorted, 99).toFixed(0)),
            max: Number(sorted[sorted.length - 1]?.toFixed(0) ?? 0),
          },
        ];
      }),
    );
    const all = holdSamples.map((s) => s.ms).sort((a, b) => a - b);
    const errors = holdSamples.filter((s) => s.status < 200 || s.status >= 300).length;
    const summary = {
      users: target,
      seconds: Number(elapsed.toFixed(0)),
      requests: holdSamples.length,
      rps: Number((holdSamples.length / elapsed).toFixed(1)),
      errors,
      errorRate: holdSamples.length ? Number(((errors / holdSamples.length) * 100).toFixed(2)) : 0,
      timeouts: holdSamples.filter((s) => s.status === -1).length,
      transportErrors: holdSamples.filter((s) => s.status === -2).length,
      p50: Number(pct(all, 50).toFixed(0)),
      p95: Number(pct(all, 95).toFixed(0)),
      p99: Number(pct(all, 99).toFixed(0)),
      endpoints,
    };
    run.phases.push(summary);
    log(
      `  ${target} users: ${summary.rps} rps, errors ${summary.errorRate}% (${summary.timeouts} timeouts, ${summary.transportErrors} transport), p50 ${summary.p50}ms, p95 ${summary.p95}ms, p99 ${summary.p99}ms`,
    );
  }

  stopping = true;
  phase = 'drain';
  await Promise.allSettled(users);
  run.finishedAt = new Date().toISOString();
  run.timeline = timeline;
  writeFileSync(OUT, JSON.stringify(run, null, 2));
  log(`results written to ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
