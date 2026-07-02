# Final Report — Myraid DevOps Engineer Technical Assessment

**Candidate:** Vasanth  
**Role:** DevOps Engineer (1–2 Years Experience)  
**Company:** Myraid 
**Repository:** https://github.com/Vasanth1602/myraid-devops-assessment

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Assessment Requirements Coverage](#2-assessment-requirements-coverage)
3. [Architecture Overview](#3-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [Infrastructure (Terraform)](#5-infrastructure-terraform)
6. [Application](#6-application)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Security Implementation](#8-security-implementation)
9. [Monitoring and Observability](#9-monitoring-and-observability)
10. [Load Testing Results](#10-load-testing-results)
11. [Key Design Decisions](#11-key-design-decisions)
12. [Known Limitations and Trade-offs](#12-known-limitations-and-trade-offs)
13. [Future Improvements](#13-future-improvements)

---

## 1. Executive Summary

This assessment demonstrates a complete, production-like cloud application deployment on AWS using industry-standard DevOps practices. The solution covers all major areas evaluated in the assessment: infrastructure as code, containerized application deployment, automated CI/CD, least-privilege security, observability, and load testing.

**What was built:**

A Python Flask REST API containerized with Docker and deployed to an AWS EC2 instance (`t3.micro`, Amazon Linux 2023, ap-south-1). All infrastructure is provisioned with Terraform. Every push to the `main` branch triggers a fully automated 8-stage CI/CD pipeline using GitHub Actions that builds, tests, packages, and deploys the application with a health check gate.

**Key highlights:**

- **100% Infrastructure as Code** — every AWS resource (VPC, Subnet, IGW, SG, IAM Role, EC2, S3, CloudWatch Dashboard, 3 Alarms) is created by Terraform. Zero manual console clicks post-setup.
- **Zero manual deployments** — all code changes deploy automatically via GitHub Actions
- **Zero errors under load** — k6 load test at 20 virtual users produced 0% error rate across 1,470 requests
- **Multi-layer security** — IAM least privilege, NGINX security headers, non-root Docker user, S3 encryption, public access block, security groups
- **Full observability** — 4 CloudWatch log streams, 3 metric alarms, 1 dashboard with 4 widgets

---

## 2. Assessment Requirements Coverage

| Requirement | Status | Implementation |
|---|---|---|
| AWS Free Tier infrastructure | ✅ Done | t3.micro EC2, Free Tier S3, CloudWatch basic monitoring |
| Launch and configure EC2 | ✅ Done | `aws_instance.app` — Amazon Linux 2023, `user_data.sh` bootstrap |
| Deploy sample web application on EC2 | ✅ Done | Flask API with 3 endpoints (`/`, `/health`, `/info`) via Docker + Gunicorn |
| Amazon S3 for static assets or backups | ✅ Done | `aws_s3_bucket.assets` with versioning, AES-256 encryption, public access block |
| Configure API Gateway | ⚠️ Skipped | NGINX used as reverse proxy instead. API Gateway adds cost and complexity without adding value for a single-endpoint Flask app at this scale. |
| IAM users/roles with least privilege | ✅ Done | EC2 role with 3 scoped policies: SSM + CloudWatch + custom S3 policy |
| Security Groups and firewall rules | ✅ Done | SG with minimal rules: port 80 (HTTP) + port 22 (SSH, trade-off documented) |
| Set up HTTPS if possible | ⚠️ Not possible | No domain name available. NGINX is configured and ready for SSL termination once a domain is registered. |
| Automated CI/CD pipeline | ✅ Done | GitHub Actions — 2 jobs, 8 stages, tests gate deployment |
| CloudWatch monitoring, dashboards and alarms | ✅ Done | 1 dashboard (4 widgets) + 3 metric alarms (CPU, Memory, StatusCheck) |
| Collect application logs | ✅ Done | 4 CloudWatch log streams: bootstrap, nginx-access, nginx-error, app-logs |
| Load testing | ✅ Done | k6 v2.1.0, 5 stages, 20 max VUs, 2 min — full results in `docs/load-testing-report.md` |

---

## 3. Architecture Overview

```
Developer Workstation
    │
    ├── terraform apply
    │       └── Provisions all AWS resources (VPC → EC2 → S3 → CloudWatch)
    │
    └── git push origin main
              │
              ▼
         GitHub Actions (CI/CD Pipeline)
              │
              ├── Job 1: test  ─────── Runs on every PR + push
              │   ├── Python 3.9 setup
              │   ├── pip install
              │   └── pytest (3 tests — all must pass)
              │
              └── Job 2: deploy ────── Runs only on push to main
                  ├── docker build → tagged with commit SHA + latest
                  ├── docker push → GitHub Container Registry (GHCR)
                  └── SSH to EC2
                            │
                            ▼
                       AWS VPC (10.0.0.0/16) — ap-south-1
                            │
                       Internet Gateway
                            │
                       Security Group
                       Port 80 (HTTP) | Port 22 (SSH)
                            │
                       EC2 t3.micro — Amazon Linux 2023
                       IAM Role: SSM + CloudWatch + S3
                            │
                       ┌────┴────┐
                       │        │
                     NGINX     CloudWatch Agent
                     :80        └── Metrics: mem, disk
                       │        └── Logs: 4 streams
                    proxy
                       │
                   Gunicorn :5000
                   (2 workers, non-root appuser)
                       │
                   Flask API
                   ├── GET /
                   ├── GET /health
                   └── GET /info

S3 Bucket (myraid-assessment-001)
├── Versioning: Enabled
├── Encryption: AES-256
└── Public Access: Blocked
```

---

## 4. Technology Stack

| Layer | Technology | Version | Justification |
|---|---|---|---|
| Cloud Provider | AWS | — | Assessment requirement; industry standard |
| Region | ap-south-1 (Mumbai) | — | Lowest latency for India-based assessment |
| IaC | Terraform | >= 1.5.0 | Reproducible, version-controlled infrastructure |
| OS | Amazon Linux 2023 | Latest AMI | AWS-native, regularly patched, DNF-based |
| Application | Python + Flask | 3.9 / 3.0.3 | Lightweight, production-proven WSGI framework |
| WSGI Server | Gunicorn | 22.0.0 | Production-grade; Flask's dev server is not for production |
| Container Runtime | Docker | Latest | Portability, environment consistency |
| Container Registry | GitHub Container Registry | — | Native GitHub Actions integration via GITHUB_TOKEN |
| Reverse Proxy | NGINX | Latest DNF pkg | Connection handling, proxy buffering, security headers |
| CI/CD | GitHub Actions | — | Built-in to GitHub; no extra tool installation needed |
| Monitoring | AWS CloudWatch | — | Native AWS monitoring; free within assessment usage |
| Load Testing | k6 | 2.1.0 | Modern, developer-friendly, scriptable load tester |

---

## 5. Infrastructure (Terraform)

All infrastructure is defined in `terraform/main.tf` (422 lines). The Terraform configuration creates:

### Networking

| Resource | Configuration |
|---|---|
| VPC | `10.0.0.0/16`, DNS support + hostnames enabled |
| Public Subnet | `10.0.1.0/24`, `ap-south-1a`, public IP on launch |
| Internet Gateway | Attached to VPC |
| Route Table | `0.0.0.0/0 → IGW` |

### Security Group

| Rule | Port | Source | Purpose |
|---|---|---|---|
| Inbound | 80 TCP | `0.0.0.0/0` | HTTP application |
| Inbound | 22 TCP | `0.0.0.0/0` | SSH (assessment trade-off — see §12) |
| Outbound | All | `0.0.0.0/0` | Package installs, Docker pulls, CloudWatch API |

### IAM

| Resource | Details |
|---|---|
| EC2 Role | `myraid-assessment-ec2-role` |
| SSM Policy | `AmazonSSMManagedInstanceCore` (managed) |
| CloudWatch Policy | `CloudWatchAgentServerPolicy` (managed) |
| S3 Policy | Custom — PutObject + GetObject + ListBucket on `myraid-assessment-001` only |
| Instance Profile | Attached to EC2 |

### EC2 Instance

| Setting | Value |
|---|---|
| AMI | Amazon Linux 2023 (dynamically resolved — not hardcoded) |
| Instance Type | `t3.micro` |
| Storage | 30 GB gp3 (delete on termination) |
| Bootstrap | `user_data.sh` — installs Docker, NGINX, CloudWatch Agent |

### S3 Bucket

| Setting | Value |
|---|---|
| Bucket Name | `myraid-assessment-{suffix}` |
| Versioning | Enabled |
| Encryption | AES-256 (SSE-S3) |
| Public Access | Blocked (all 4 settings = true) |

### CloudWatch Dashboard

One dashboard (`myraid-assessment-dashboard`) with 4 widgets:
- CPU Utilization (%) — `AWS/EC2` namespace
- Memory Used (%) — `CWAgent` namespace (custom metric)
- Network In / Out (Bytes) — `AWS/EC2` namespace
- Disk Used (%) — `CWAgent` namespace (custom metric)

### CloudWatch Alarms

| Alarm | Metric | Threshold | Evaluation |
|---|---|---|---|
| `myraid-assessment-cpu-high` | CPUUtilization | > 80% | 2 × 5-min periods |
| `myraid-assessment-memory-high` | mem_used_percent | > 80% | 2 × 5-min periods |
| `myraid-assessment-status-check-failed` | StatusCheckFailed | > 0 | 1 × 1-min period |

### Terraform Outputs

```bash
terraform output
# application_url          = "http://<public-ip>"
# cloudwatch_dashboard_url = "https://ap-south-1.console.aws.amazon.com/cloudwatch/..."
# health_url               = "http://<public-ip>/health"
# instance_id              = "i-0xxxxxxxxxxxxxxxxx"
# public_ip                = "<public-ip>"
# s3_bucket_name           = "myraid-assessment-001"
# ssh_command              = "ssh -i myraid-assessment-key.pem ec2-user@<public-ip>"
```

---

## 6. Application

### Flask API (`app/app.py`)

A lightweight REST API with 3 endpoints:

| Endpoint | Method | Response |
|---|---|---|
| `/` | GET | `{"app": "myraid-devops-assessment", "status": "running", "message": "Welcome to Myraid DevOps Assessment"}` |
| `/health` | GET | `{"status": "healthy", "timestamp": "<UTC ISO timestamp>"}` |
| `/info` | GET | `{"app": "...", "version": "1.0.0", "started_at": "...", "python_version": "...", "host": "...", "environment": "production"}` |

The `/health` endpoint is used by:
- Docker `HEALTHCHECK` (every 30 seconds)
- GitHub Actions Stage 8 — health check validation (up to 60 seconds, 12 retries)
- CloudWatch status check (EC2 level)

### Dockerfile (Multi-Stage Build)

```
Stage 1 — builder (python:3.9-slim)
  └── pip install --prefix=/install requirements.txt

Stage 2 — production (python:3.9-slim)
  ├── COPY --from=builder /install /usr/local
  ├── COPY app.py
  ├── RUN useradd --create-home appuser
  ├── USER appuser
  ├── EXPOSE 5000
  ├── HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3
  └── CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60", "app:app"]
```

### Unit Tests (`app/tests/test_app.py`)

3 pytest tests using Flask's built-in test client — all 3 must pass before deployment proceeds:

| Test | Assertion |
|---|---|
| `test_index_returns_200` | GET / returns HTTP 200, `status == "running"`, correct app name |
| `test_health_returns_healthy` | GET /health returns HTTP 200, `status == "healthy"`, timestamp present |
| `test_info_returns_version` | GET /info returns HTTP 200, `version == "1.0.0"`, correct app name |

---

## 7. CI/CD Pipeline

Defined in `.github/workflows/deploy.yml`. Triggered on every push to `main` and every pull request targeting `main`.

### Pipeline Architecture

```
git push origin main
    │
    ├── Job: test (runs on PR + push to main)
    │   ├── Stage 1: Checkout
    │   ├── Stage 2: Python 3.9 setup + pip install
    │   └── Stage 3: pytest — all 3 tests must pass
    │                  │
    │               GATE: deploy job blocked until tests pass
    │
    └── Job: deploy (runs on push to main ONLY — blocked on PR)
        ├── Stage 4: Checkout
        ├── Stage 5: docker build (tagged commit SHA + latest)
        ├── Stage 6: docker login GHCR + docker push
        ├── Stage 7: SSH to EC2 → docker pull → docker stop → docker run
        └── Stage 8: Health check retry loop (12 × 5s = 60s)
                       └── GET /health → must return HTTP 200
```

### Key CI/CD Properties

- **Tests block deployment:** `needs: test` hard-dependency ensures broken code is never deployed
- **PR safety:** `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` means PRs validate but never deploy
- **Zero-downtime deployment:** Old container stopped only after new image is pulled
- **Automatic rollback detection:** If the health check fails after 60s, the pipeline fails — alerting the developer
- **Image tagging:** Every image is tagged with the full commit SHA for audit trail and rollback capability

---

## 8. Security Implementation

Security is applied at every layer. A full breakdown is in `docs/security-summary.md`. Summary:

| Layer | Control |
|---|---|
| IAM | Least-privilege EC2 role; custom S3 policy scoped to one bucket; no hardcoded credentials |
| Network | Dedicated VPC; Security Group with only ports 80 + 22; Gunicorn bound to 127.0.0.1 |
| NGINX | `server_tokens off`; X-Frame-Options, X-Content-Type-Options, X-XSS-Protection headers |
| Container | Non-root `appuser`; multi-stage build; `python:3.9-slim` base; Docker HEALTHCHECK |
| S3 | All-public-access blocked; AES-256 encryption; versioning enabled |
| CI/CD | All secrets in GitHub Secrets; tests gate deploy; deploy restricted to `main` only |
| Monitoring | 4 CloudWatch log streams; 3 metric alarms (CPU, Memory, StatusCheck) |

---

## 9. Monitoring and Observability

### CloudWatch Log Streams

Log group: `/myraid-assessment/ec2`

| Stream | Source | Contains |
|---|---|---|
| `user-data` | `/var/log/user_data.log` | EC2 bootstrap log — every install and config step |
| `nginx-access` | `/var/log/nginx/app_access.log` | HTTP requests — IP, method, path, status, size |
| `nginx-error` | `/var/log/nginx/app_error.log` | NGINX errors and upstream failures |
| `app-logs` | `/var/lib/docker/containers/*/*.log` | Gunicorn stdout — request details, Python exceptions |

### CloudWatch Metrics

The CloudWatch Agent pushes two custom metrics beyond default EC2 metrics:

| Metric | Why It Matters |
|---|---|
| `mem_used_percent` | EC2 basic monitoring does not include memory — must be collected by the agent |
| `disk_used_percent` | Disk exhaustion causes silent application failures — monitoring it enables proactive alerts |

Both metrics use the `InstanceId` dimension for alarm filtering.

### CloudWatch Dashboard

One dashboard (`myraid-assessment-dashboard`) with 4 metric widgets arranged in a 2×2 grid:

```
┌─────────────────────┬─────────────────────┐
│  CPU Utilization %  │   Memory Used %     │
│  (AWS/EC2)          │   (CWAgent)         │
├─────────────────────┼─────────────────────┤
│  Network In / Out   │   Disk Used %       │
│  (AWS/EC2)          │   (CWAgent)         │
└─────────────────────┴─────────────────────┘
```

---

## 10. Load Testing Results

**Tool:** k6 v2.1.0 | **Script:** `load-testing/k6-script.js`

### Test Profile

| Stage | Duration | VUs | Purpose |
|---|---|---|---|
| Warm-up | 20s | 0 → 5 | Gradual ramp |
| Normal load | 40s | 10 | Baseline |
| Stress | 30s | 20 | Peak load |
| Recovery | 20s | 10 | Post-stress |
| Ramp-down | 10s | 0 | Graceful end |

### Results Summary

| Metric | Value |
|---|---|
| Total requests | 1,470 |
| Throughput | 12.11 req/s |
| Error rate | **0.00%** |
| Checks passed | **100%** (all 3,546 checks) |
| Median (p50) response time | 75.74 ms |
| p(90) response time | 136.66 ms |
| p(95) response time | 417.42 ms |
| Max response time | 1,174.30 ms |

### Per-Endpoint p(95)

| Endpoint | p(95) |
|---|---|
| `GET /` | 365.75 ms |
| `GET /health` | 609.43 ms |
| `GET /info` | 348.98 ms |

### Analysis

The application handled all 1,470 requests with **zero errors**, demonstrating strong reliability under concurrent load. Median latency of 75ms is excellent for a Free Tier single-instance deployment.

The p(95) of 417ms — while below the 500ms threshold — shows some latency variance at 20 VUs. This is caused by Gunicorn's 2-worker configuration, which means requests queue briefly under peak concurrency. CPU remained below 30% throughout, confirming the bottleneck is **worker concurrency**, not compute capacity.

**Immediate fix:** Increase Gunicorn workers from 2 to 3 (`2 × vCPU + 1`). This alone would significantly reduce p(95) latency under 20 VU load at zero additional cost.

Full analysis with optimization recommendations: `docs/load-testing-report.md`

---

## 11. Key Design Decisions

### Why Terraform over CloudFormation or CDK?

Terraform is cloud-agnostic, has a cleaner HCL syntax, and is the industry standard for multi-cloud IaC. For AWS-only projects, CloudFormation is equivalent, but Terraform skills transfer directly to any future cloud work.

### Why GitHub Actions over Jenkins or CodePipeline?

GitHub Actions requires zero additional infrastructure — no Jenkins server to maintain, no CodePipeline to configure separately. For a repository already on GitHub, Actions is the natural choice and keeps the CI/CD config in the same version-controlled repository as the code.

### Why GHCR over ECR?

GHCR authenticates via `GITHUB_TOKEN` (automatic, scoped, ephemeral). ECR would require additional IAM permissions for the GitHub Actions runner and credential management. GHCR removes that complexity for this assessment scope.

### Why Gunicorn over uWSGI or Uvicorn?

Gunicorn is the standard WSGI server for Flask applications. It is stable, well-documented, and the Flask documentation itself recommends it for production. Uvicorn is for async ASGI frameworks (FastAPI, Starlette) — not the right fit for a synchronous Flask app.

### Why NGINX instead of exposing Gunicorn directly?

Exposing a WSGI server directly to the internet misses connection management, request buffering, and header handling that NGINX provides. NGINX also positions the stack for SSL termination without touching the application layer.

### Why not use API Gateway?

API Gateway adds a regional AWS service, IAM policy, and Lambda/HTTP integration for what is essentially a pass-through to a Flask endpoint. For a direct EC2 deployment, NGINX provides the same reverse proxy function at zero cost and without additional AWS service configuration.

---

## 12. Known Limitations and Trade-offs

| Limitation | Reason | Production Solution |
|---|---|---|
| SSH open to `0.0.0.0/0` | GitHub Actions runners have dynamic IPs — can't whitelist statically | AWS SSM Session Manager + GitHub OIDC |
| HTTP only (no HTTPS) | No domain name available for ACM certificate validation | Domain → ACM cert → NGINX TLS config |
| GHCR package is public | EC2 has no GitHub credentials to pull a private package | Amazon ECR + IAM role-based pull |
| CloudWatch Alarms have no SNS action | Assessment scope — alarm state visibility is sufficient | Add `aws_sns_topic` + email subscription |
| No Elastic IP | Avoids ~$0.005/hour cost when instance is stopped | Elastic IP or ALB with stable DNS |
| Single EC2 (no HA) | Cost-driven — ALB + ASG would exceed Free Tier | ALB + Auto Scaling Group |
| 2 Gunicorn workers | Default — sufficient for assessment load | Increase to 3 (`2 × vCPU + 1`) |

---

## 13. Future Improvements

Ordered by impact for a real production upgrade:

| Priority | Improvement | Impact |
|---|---|---|
| 🔴 High | AWS SSM + GitHub OIDC for deployments | Removes SSH key, eliminates port 22 |
| 🔴 High | HTTPS with ACM + custom domain | Encrypted traffic, professional URL |
| 🔴 High | SNS alarm notifications | Real-time incident response |
| 🟠 Medium | Amazon ECR (private registry) | Removes public image exposure |
| 🟠 Medium | Elastic IP or ALB | Stable endpoint, no secret rotation |
| 🟠 Medium | Terraform remote state (S3 + DynamoDB) | Team-safe state management |
| 🟠 Medium | Auto Scaling Group | Handles variable traffic |
| 🟡 Low | GitHub Actions OIDC (replace SSH key) | Short-lived tokens, no stored secrets |
| 🟡 Low | Gunicorn workers = 3 | Better p(95) latency under load |
| 🟡 Low | EBS volume encryption | Data at rest protection |
| 🟡 Low | AWS GuardDuty | Automated threat detection |
| 🟡 Low | CloudTrail | Full AWS API audit log |

---

## Documentation Index

| Document | Location | Contents |
|---|---|---|
| README | `README.md` | Architecture, setup guide, API reference, design decisions |
| Deployment Guide | `docs/deployment-guide.md` | Step-by-step from scratch: AWS, Terraform, GitHub, CI/CD |
| Security Summary | `docs/security-summary.md` | All security controls, trade-offs, production hardening |
| Load Testing Report | `docs/load-testing-report.md` | k6 methodology, full results, bottleneck analysis |
| Final Report | `docs/final-report.md` | This document — complete assessment summary |

---

*Myraid DevOps Engineer Technical Assessment*
