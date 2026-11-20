#!/usr/bin/env node
/**
 * Load test for the production API and dashboard, modelled on what the
 * mobile app and the admin dashboard actually do. No dependencies.
 *
 *   node scripts/load-test.mjs                      # read-only stages
 *   LOAD_PIN=ABC123 node scripts/load-test.mjs      # + PIN-scoped stages (seed, pull, summary, heartbeat)
 *
 * Env:
 *   API_URL     default http://103.117.180.71:4000
 *   WEB_URL     default https://voters.iramediaconcepts.com
 *   SESSIONS    sessions opened via /api/auth/login (default 10; the PIN step is
 *               rate-limited to 10 per 5 minutes per IP, so keep it at or below that)
 *   LOAD_PIN    access PIN for the constituency to test (optional)
 *   OUT         results JSON path (default ./load-results.json)
 *
 * Every session this creates is named "Load Test N (sample)" with a mobile
 * number starting 99999010, so it can be removed afterwards with
 * scripts/load-test-cleanup.sql. Nothing here marks a voter as voted or
 * records a slip print.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const API_URL = (process.env.API_URL ?? 'http://103.117.180.71:4000').replace(/\/$/, '');
const WEB_URL = (process.env.WEB_URL ?? 'https://voters.iramediaconcepts.com').replace(/\/$/, '');
const SESSIONS = Math.min(Number(process.env.SESSIONS) || 10, 10);
const LOAD_PIN = process.env.LOAD_PIN?.trim().toUpperCase() || null;
const OUT = process.env.OUT ?? './load-results.json';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Runs `concurrency` workers, each firing `makeRequest()` back to back until `seconds` elapse. */
async function runStage({ name, concurrency, seconds, makeRequest, expect = [200] }) {
  log(`▸ ${name}: ${concurrency} concurrent for ${seconds}s`);
  const latencies = [];
  const statuses = {};
  const errors = {};
  let bytes = 0;
  const started = performance.now();
  const deadline = started + seconds * 1000;
  const perSecond = new Map();

  async function worker() {
    while (performance.now() < deadline) {
      const t0 = performance.now();
      let status = 0;
      try {
        const res = await makeRequest();
        status = res.status;
        const body = await res.arrayBuffer();
        bytes += body.byteLength;
      } catch (err) {
        const key = err?.cause?.code ?? err?.code ?? err?.name ?? 'error';
        errors[key] = (errors[key] ?? 0) + 1;
      }
      const ms = performance.now() - t0;
      latencies.push(ms);
      statuses[status] = (statuses[status] ?? 0) + 1;
      const sec = Math.floor((performance.now() - started) / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - started) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const ok = Object.entries(statuses)
    .filter(([s]) => expect.includes(Number(s)))
    .reduce((n, [, c]) => n + c, 0);
  const result = {
    name,
    concurrency,
    seconds: Number(elapsed.toFixed(1)),
    requests: latencies.length,
    rps: Number((latencies.length / elapsed).toFixed(1)),
    okRate: latencies.length ? Number(((ok / latencies.length) * 100).toFixed(2)) : 0,
    statuses,
    errors,
    bytesPerSec: Math.round(bytes / elapsed),
    latencyMs: {
      min: Number(sorted[0]?.toFixed(1) ?? 0),
      p50: Number(percentile(sorted, 50)?.toFixed(1) ?? 0),
      p90: Number(percentile(sorted, 90)?.toFixed(1) ?? 0),
      p95: Number(percentile(sorted, 95)?.toFixed(1) ?? 0),
      p99: Number(percentile(sorted, 99)?.toFixed(1) ?? 0),
      max: Number(sorted[sorted.length - 1]?.toFixed(1) ?? 0),
      mean: Number((sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)).toFixed(1)),
    },
    perSecond: Array.from(perSecond.entries()).sort((a, b) => a[0] - b[0]).map(([, n]) => n),
  };
  log(
    `  ${result.requests} req, ${result.rps} rps, ok ${result.okRate}%, p50 ${result.latencyMs.p50}ms, p95 ${result.latencyMs.p95}ms, p99 ${result.latencyMs.p99}ms, max ${result.latencyMs.max}ms`,
    Object.keys(errors).length ? errors : '',
  );
  return result;
}

const json = (method, url, body, token) =>
  fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-encoding': 'gzip',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function main() {
  const run = {
    startedAt: new Date().toISOString(),
    apiUrl: API_URL,
    webUrl: WEB_URL,
    pinScoped: Boolean(LOAD_PIN),
    sessions: SESSIONS,
    stages: [],
    notes: [],
  };

  // Sanity.
  const health = await fetch(`${API_URL}/health`);
  if (!health.ok) throw new Error(`API health returned ${health.status}`);
  log('API healthy; dashboard', (await fetch(`${WEB_URL}/login`)).status);

  // Open the sessions the authenticated stages share (one login each, timed).
  const tokens = [];
  const loginLatencies = [];
  for (let i = 1; i <= SESSIONS; i++) {
    const t0 = performance.now();
    const res = await json('POST', `${API_URL}/api/auth/login`, {
      fullName: `Load Test ${i} (sample)`,
      mobileNumber: `99999010${String(i).padStart(2, '0')}`,
    });
    loginLatencies.push(performance.now() - t0);
    if (!res.ok) throw new Error(`login ${i} failed: ${res.status}`);
    tokens.push((await res.json()).token);
  }
  run.login = {
    count: tokens.length,
    meanMs: Number((loginLatencies.reduce((a, b) => a + b, 0) / loginLatencies.length).toFixed(1)),
    maxMs: Number(Math.max(...loginLatencies).toFixed(1)),
  };
  log(`opened ${tokens.length} sessions (mean ${run.login.meanMs}ms)`);
  const pick = (i) => tokens[i % tokens.length];
  let counter = 0;

  // ── Read-only stages ────────────────────────────────────────────────────
  run.stages.push(
    await runStage({
      name: 'api-health',
      concurrency: 50,
      seconds: 15,
      makeRequest: () => fetch(`${API_URL}/health`),
    }),
  );
  for (const concurrency of [10, 25, 50, 100]) {
    run.stages.push(
      await runStage({
        name: `api-auth-me-c${concurrency}`,
        concurrency,
        seconds: 15,
        makeRequest: () => json('GET', `${API_URL}/api/auth/me`, undefined, pick(counter++)),
      }),
    );
  }
  for (const concurrency of [5, 15, 30]) {
    run.stages.push(
      await runStage({
        name: `web-login-page-c${concurrency}`,
        concurrency,
        seconds: 15,
        makeRequest: () => fetch(`${WEB_URL}/login`, { headers: { 'accept-encoding': 'gzip' } }),
      }),
    );
  }

  // ── PIN-scoped stages: what a field agent's phone does ──────────────────
  if (LOAD_PIN) {
    const scoped = [];
    const pinLatencies = [];
    for (const token of tokens) {
      const t0 = performance.now();
      const res = await json('POST', `${API_URL}/api/auth/pin`, { pin: LOAD_PIN }, token);
      pinLatencies.push(performance.now() - t0);
      if (res.status === 429) {
        run.notes.push('PIN verification hit the 10-per-5-minutes-per-IP rate limit.');
        break;
      }
      if (!res.ok) throw new Error(`pin failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      scoped.push(body.token);
      run.assembly ??= { no: body.access.assemblyNo, name: body.access.assemblyName };
    }
    run.pin = {
      count: scoped.length,
      meanMs: Number((pinLatencies.reduce((a, b) => a + b, 0) / pinLatencies.length).toFixed(1)),
    };
    log(`unlocked ${scoped.length} sessions on ${run.assembly?.name}`);
    const pickScoped = (i) => scoped[i % scoped.length];

    // First seed page: the heaviest single response the API serves (~3 MB JSON, gzipped).
    run.stages.push(
      await runStage({
        name: 'sync-seed-page1-c3',
        concurrency: 3,
        seconds: 20,
        makeRequest: () =>
          json('GET', `${API_URL}/api/sync/seed?limit=10000`, undefined, pickScoped(counter++)),
      }),
    );
    run.stages.push(
      await runStage({
        name: 'sync-seed-page1-c10',
        concurrency: 10,
        seconds: 20,
        makeRequest: () =>
          json('GET', `${API_URL}/api/sync/seed?limit=10000`, undefined, pickScoped(counter++)),
      }),
    );
    // Delta pull as a phone does after it already has the roll: changes in the last hour.
    const since = Date.now() - 60 * 60 * 1000;
    for (const concurrency of [10, 50]) {
      run.stages.push(
        await runStage({
          name: `sync-pull-delta-c${concurrency}`,
          concurrency,
          seconds: 15,
          makeRequest: () =>
            json(
              'GET',
              `${API_URL}/api/sync/pull?lastPulledAt=${since}`,
              undefined,
              pickScoped(counter++),
            ),
        }),
      );
    }
    // The stats card: five aggregate counts over the constituency's roll.
    for (const concurrency of [10, 50]) {
      run.stages.push(
        await runStage({
          name: `voters-summary-c${concurrency}`,
          concurrency,
          seconds: 15,
          makeRequest: () =>
            json('GET', `${API_URL}/api/voters/summary`, undefined, pickScoped(counter++)),
        }),
      );
    }
    // Heartbeat: one per minute per phone, rate-limited to 30/min per IP.
    run.stages.push(
      await runStage({
        name: 'usage-heartbeat-c5',
        concurrency: 5,
        seconds: 10,
        expect: [200, 204, 429],
        makeRequest: () =>
          json('POST', `${API_URL}/api/usage/heartbeat`, { opened: false, seconds: 60 }, pickScoped(counter++)),
      }),
    );
  } else {
    run.notes.push(
      'LOAD_PIN was not set, so the PIN-scoped stages (seed download, delta pull, summary, heartbeat) did not run.',
    );
  }

  run.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(run, null, 2));
  log(`results written to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
