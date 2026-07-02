/**
 * Myraid DevOps Assessment — k6 Load Test Script
 *
 * Tests all 3 Flask API endpoints with gradual ramp-up,
 * steady state, and ramp-down phases.
 *
 * Run command:
 *   k6 run --env BASE_URL=http://<EC2_PUBLIC_IP> load-testing/k6-script.js
 *
 * Metrics collected:
 *   - Response time (p50, p90, p95, p99)
 *   - Throughput (requests/second)
 *   - Error rate (%)
 *   - Per-endpoint duration breakdown
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────────────────
const errorRate     = new Rate('error_rate');
const rootDuration  = new Trend('duration_root',   true); // true = milliseconds
const healthDuration = new Trend('duration_health', true);
const infoDuration  = new Trend('duration_info',   true);

// ─── Test Configuration ───────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '20s', target: 5  },  // Phase 1: Warm up — ramp to 5 VUs
    { duration: '40s', target: 10 },  // Phase 2: Normal load — hold at 10 VUs
    { duration: '30s', target: 20 },  // Phase 3: Stress — spike to 20 VUs
    { duration: '20s', target: 10 },  // Phase 4: Recovery — back to 10 VUs
    { duration: '10s', target: 0  },  // Phase 5: Ramp down
  ],
  thresholds: {
    // 95% of all requests must complete within 500ms
    http_req_duration: ['p(95)<500'],
    // Overall HTTP failure rate must stay below 1%
    http_req_failed: ['rate<0.01'],
    // Custom error rate must stay below 1%
    error_rate: ['rate<0.01'],
  },
};

// ─── Base URL — passed via --env BASE_URL=http://<EC2_IP> ─────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost';

// ─── Main Test Function (runs once per VU per iteration) ─────────────────────
export default function () {

  // ── Request 1: Root endpoint ──
  const rootRes = http.get(`${BASE_URL}/`, {
    tags: { endpoint: 'root' },
  });
  rootDuration.add(rootRes.timings.duration);
  check(rootRes, {
    'GET /  → status 200':        (r) => r.status === 200,
    'GET /  → status is running': (r) => r.json('status') === 'running',
    'GET /  → has app name':      (r) => r.json('app') === 'myraid-devops-assessment',
  });
  errorRate.add(rootRes.status !== 200);

  sleep(0.5);

  // ── Request 2: Health endpoint ──
  const healthRes = http.get(`${BASE_URL}/health`, {
    tags: { endpoint: 'health' },
  });
  healthDuration.add(healthRes.timings.duration);
  check(healthRes, {
    'GET /health → status 200':        (r) => r.status === 200,
    'GET /health → status is healthy': (r) => r.json('status') === 'healthy',
    'GET /health → has timestamp':     (r) => r.json('timestamp') !== null,
  });
  errorRate.add(healthRes.status !== 200);

  sleep(0.5);

  // ── Request 3: Info endpoint ──
  const infoRes = http.get(`${BASE_URL}/info`, {
    tags: { endpoint: 'info' },
  });
  infoDuration.add(infoRes.timings.duration);
  check(infoRes, {
    'GET /info → status 200':    (r) => r.status === 200,
    'GET /info → has version':   (r) => r.json('version') === '1.0.0',
    'GET /info → has app name':  (r) => r.json('app') === 'myraid-devops-assessment',
  });
  errorRate.add(infoRes.status !== 200);

  sleep(1);
}

// ─── Summary — printed at the end of the test ─────────────────────────────────
export function handleSummary(data) {
  const dur    = data.metrics.http_req_duration  ? data.metrics.http_req_duration.values  : {};
  const reqs   = data.metrics.http_reqs          ? data.metrics.http_reqs.values          : {};
  const failed = data.metrics.http_req_failed     ? data.metrics.http_req_failed.values    : {};
  const dRoot  = data.metrics.duration_root      ? data.metrics.duration_root.values      : {};
  const dHealth= data.metrics.duration_health    ? data.metrics.duration_health.values    : {};
  const dInfo  = data.metrics.duration_info      ? data.metrics.duration_info.values      : {};

  const fmt = (v) => (v !== undefined && v !== null) ? Number(v).toFixed(2) : 'N/A';

  const summary = {
    total_requests:    reqs.count  || 'N/A',
    request_rate_rps:  fmt(reqs.rate),
    error_rate_pct:    fmt((failed.rate || 0) * 100),
    response_time: {
      min_ms: fmt(dur.min),
      avg_ms: fmt(dur.avg),
      med_ms: fmt(dur.med),
      p90_ms: fmt(dur['p(90)']),
      p95_ms: fmt(dur['p(95)']),
      p99_ms: fmt(dur['p(99)']),
      max_ms: fmt(dur.max),
    },
    per_endpoint_p95_ms: {
      root:   fmt(dRoot['p(95)']),
      health: fmt(dHealth['p(95)']),
      info:   fmt(dInfo['p(95)']),
    },
  };

  console.log('\n======= MYRAID LOAD TEST SUMMARY =======');
  console.log(JSON.stringify(summary, null, 2));
  console.log('=========================================\n');

  return {
    'load-testing/results-summary.json': JSON.stringify(summary, null, 2),
  };
}
