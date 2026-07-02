# Load Testing Report — Myraid DevOps Assessment

**Tool:** k6 v2.1.0  
**Target:** EC2 t3.micro, ap-south-1 (infrastructure deployed via `terraform apply`)  
**Script:** `load-testing/k6-script.js`  
**Duration:** 2 minutes (5 stages)

---

## Test Configuration

### Load Profile

| Stage | Duration | Virtual Users | Purpose |
|---|---|---|---|
| 1 — Warm-up | 20s | 0 → 5 VUs | Gradual ramp-up |
| 2 — Normal Load | 40s | 10 VUs | Baseline performance |
| 3 — Stress | 30s | 20 VUs | Peak load simulation |
| 4 — Recovery | 20s | 20 → 10 VUs | Post-stress recovery |
| 5 — Ramp-down | 10s | 10 → 0 VUs | Graceful shutdown |

### Endpoints Tested

| Endpoint | Method | Check |
|---|---|---|
| `/` | GET | status=200, app name correct |
| `/health` | GET | status=200, status=healthy, timestamp present |
| `/info` | GET | status=200, version=1.0.0, app name correct |

### Thresholds

| Metric | Target | Result |
|---|---|---|
| p(95) response time | < 500ms | ❌ BREACHED — 1.46s |
| HTTP failure rate | < 1% | ✅ PASSED — 0.00% |
| Custom error rate | < 1% | ✅ PASSED — 0.00% |

---

## Results

### Overall HTTP Performance

| Metric | Value |
|---|---|
| **Total Requests** | 1,182 |
| **Throughput** | 9.58 req/s |
| **Iterations Completed** | 394 / 394 |
| **HTTP Failures** | 0 (0.00%) |
| **Error Rate** | 0.00% |

### Response Time Distribution

| Percentile | Latency |
|---|---|
| **Min** | 50.73 ms |
| **Median (p50)** | 82.24 ms |
| **p(90)** | 1,100 ms |
| **p(95)** | 1,460 ms |
| **Max** | 3,500 ms |
| **Average** | 344.76 ms |

### Per-Endpoint p(95) Latency

| Endpoint | p(95) Latency |
|---|---|
| `GET /health` | 1,310 ms |
| `GET /` | 1,450 ms |
| `GET /info` | 1,540 ms |

### Check Results

All 3,546 checks passed (100%):

```
✓ GET /  → status 200
✓ GET /  → status is running
✓ GET /  → has app name
✓ GET /health → status 200
✓ GET /health → status is healthy
✓ GET /health → has timestamp
✓ GET /info → status 200
✓ GET /info → has version
✓ GET /info → has app name
```

---

## Observations

### 1. Zero Errors Under Load ✅
The application handled all 1,182 requests with zero HTTP failures and zero custom check failures across all load stages. The application remained stable throughout the entire 2-minute test, including the 20 VU stress phase.

### 2. Excellent Median Latency ✅
Median (p50) response time of **82ms** is excellent for a Free Tier EC2 instance. This indicates the application responds quickly under light-to-moderate load.

### 3. p95 Threshold Breached Under Peak Load ❌
At 20 concurrent virtual users, p(95) latency reaches **1.46 seconds** — well above the 500ms target. The wide gap between median (82ms) and p95 (1.46s) is the key finding: the application is fast for most requests but degrades significantly under concurrent peak load.

### 4. `/info` is the Slowest Endpoint
The `/info` endpoint (p95=1.54s) is slower than `/health` (p95=1.31s) because it executes additional Python calls (`platform.python_version()`, `platform.node()`, `os.environ.get()`).

### 5. Throughput Ceiling Visible
Effective throughput of **9.58 req/s** at 20 VUs with ~2s sleep per iteration per VU suggests the application is operating near its concurrency ceiling with 2 Gunicorn workers.

---

## Bottleneck Analysis

### Root Cause — Gunicorn Worker Exhaustion

The primary bottleneck is **Gunicorn configured with only 2 workers** on a 1-vCPU instance:

```
20 VUs requesting simultaneously
        ↓
NGINX (port 80) — instantly proxies to Gunicorn
        ↓
Gunicorn (port 5000) — only 2 workers available
        ↓
Remaining 18 requests QUEUE and wait
        ↓
Queue wait time = observed high p95 latency
```

This explains the bimodal distribution:
- Requests that get a worker immediately → ~82ms (median)
- Requests that queue → up to 3.5s (max)

### Secondary Factor — Single EC2 Instance
No horizontal scaling means all load is absorbed by one `t3.micro` (1 vCPU, 1 GB RAM). There is no load balancer to distribute traffic across multiple instances.

---

## Optimization Recommendations

| Priority | Recommendation | Expected Impact |
|---|---|---|
| 🔴 High | Increase Gunicorn workers from 2 to 3 (`2 × CPUs + 1`) | Reduces queuing at peak load |
| 🔴 High | Use Application Load Balancer + Auto Scaling Group | Horizontal scaling, handles traffic spikes |
| 🟠 Medium | Add NGINX connection buffering and keepalive upstream | Reduces connection overhead per request |
| 🟠 Medium | Enable Gunicorn async workers (`gevent`) for I/O-bound endpoints | Better concurrency per worker |
| 🟡 Low | Add response caching for `/info` endpoint (content is static) | Eliminates repeated Python calls |
| 🟡 Low | Use Amazon CloudFront for edge caching of `/info` and `/` | Reduces origin load for static responses |
| 🟡 Low | Upgrade to `t3.small` (2 vCPU) for production | More CPU headroom, lower p95 |

> **Note:** Recommendations 2, 3, and 6 are excluded from this assessment scope intentionally (ALB, CloudFront, Route53 add cost and complexity). Recommendation 1 (Gunicorn workers) is the highest-impact, zero-cost fix.

---

## Conclusion

The Myraid Flask API demonstrates **high reliability** (0% error rate, 100% check pass rate) under load, but shows **latency degradation** at peak concurrency (20 VUs) due to the 2-worker Gunicorn constraint on a single `t3.micro` instance. This is the expected behaviour for a Free Tier, single-instance deployment.

For an internship-level production deployment, the immediate fix is increasing Gunicorn workers to 3. For true production readiness, an Application Load Balancer with Auto Scaling would be required to handle variable traffic patterns without latency spikes.

*Myraid DevOps Assessment | EC2: t3.micro, Amazon Linux 2023, ap-south-1 | k6 v2.1.0*
