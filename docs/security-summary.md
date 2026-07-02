# Security Summary — Myraid DevOps Assessment

A detailed review of every security control implemented across the infrastructure, application, and CI/CD pipeline layers. Also documents known trade-offs with justifications and recommendations for production hardening.

---

## Table of Contents

1. [Security Layers Overview](#1-security-layers-overview)
2. [Identity and Access Management (IAM)](#2-identity-and-access-management-iam)
3. [Network Security](#3-network-security)
4. [Application Security](#4-application-security)
5. [Container Security](#5-container-security)
6. [Storage Security (S3)](#6-storage-security-s3)
7. [CI/CD Pipeline Security](#7-cicd-pipeline-security)
8. [Monitoring and Audit Logging](#8-monitoring-and-audit-logging)
9. [Known Trade-offs and Accepted Risks](#9-known-trade-offs-and-accepted-risks)
10. [Production Hardening Recommendations](#10-production-hardening-recommendations)

---

## 1. Security Layers Overview

Security is applied at every layer of the stack — not just at the perimeter. The following table summarises all controls implemented:

| Layer | Control | Status |
|---|---|---|
| **IAM** | Least-privilege EC2 role | ✅ Implemented |
| **IAM** | No hardcoded credentials | ✅ Implemented |
| **IAM** | S3 scoped policy (put/get/list only) | ✅ Implemented |
| **Network** | VPC isolation (not default VPC) | ✅ Implemented |
| **Network** | Security Group — minimal open ports | ✅ Implemented |
| **Network** | SSH open to 0.0.0.0/0 | ⚠️ Trade-off (documented) |
| **Application** | NGINX reverse proxy (Gunicorn not exposed) | ✅ Implemented |
| **Application** | NGINX `server_tokens off` | ✅ Implemented |
| **Application** | NGINX security headers (X-Frame, X-Content-Type, X-XSS) | ✅ Implemented |
| **Application** | HTTP only — no HTTPS | ⚠️ Trade-off (documented) |
| **Container** | Non-root user (`appuser`) | ✅ Implemented |
| **Container** | Multi-stage build (no build tools in production) | ✅ Implemented |
| **Container** | Docker HEALTHCHECK | ✅ Implemented |
| **Container** | Minimal base image (`python:3.9-slim`) | ✅ Implemented |
| **S3** | Block all public access | ✅ Implemented |
| **S3** | AES-256 server-side encryption | ✅ Implemented |
| **S3** | Versioning enabled | ✅ Implemented |
| **CI/CD** | Secrets in GitHub Secrets (not in code) | ✅ Implemented |
| **CI/CD** | Deploy gated on test pass | ✅ Implemented |
| **CI/CD** | Deploy restricted to `main` branch only | ✅ Implemented |
| **Monitoring** | 4 log streams in CloudWatch Logs | ✅ Implemented |
| **Monitoring** | 3 CloudWatch Metric Alarms | ✅ Implemented |
| **Monitoring** | Alarm notifications (SNS/email) | ⚠️ Not implemented (see §9) |

---

## 2. Identity and Access Management (IAM)

### EC2 Instance Role — Least Privilege

The EC2 instance has a dedicated IAM role (`myraid-assessment-ec2-role`) attached via an instance profile. Only the minimum required policies are attached:

| Policy | Type | Purpose | What it allows |
|---|---|---|---|
| `AmazonSSMManagedInstanceCore` | AWS Managed | SSM Session Manager | SSM agent communication, Parameter Store read (no EC2 actions) |
| `CloudWatchAgentServerPolicy` | AWS Managed | CloudWatch Agent | Push metrics + logs to CloudWatch, read SSM parameters for agent config |
| `myraid-assessment-s3-policy` | Custom | S3 access for EC2 | **Only** PutObject, GetObject, ListBucket on `myraid-assessment-001` bucket |

### S3 Custom Policy — Scoped to Bucket

The custom S3 policy (`myraid-assessment-s3-policy`) follows the principle of least privilege precisely:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::myraid-assessment-001",
        "arn:aws:s3:::myraid-assessment-001/*"
      ]
    }
  ]
}
```

This means the EC2 instance **cannot**:
- Access any other S3 bucket
- Delete objects (`s3:DeleteObject` not granted)
- Change bucket configuration
- Access any other AWS service beyond SSM and CloudWatch

### No Hardcoded Credentials

No AWS credentials appear anywhere in the codebase:
- EC2 accesses AWS services via the **instance profile** (IAM role) — no access keys on disk
- GitHub Actions uses `GITHUB_TOKEN` for GHCR push — no personal access tokens
- SSH key is stored as a **GitHub Secret** — not in any file in the repository
- `terraform.tfvars` is listed in `.gitignore` and never committed

---

## 3. Network Security

### VPC Isolation

The application runs inside a dedicated VPC (`10.0.0.0/16`), not the AWS default VPC. This provides:
- Full control over networking configuration
- Clean separation from any other workloads in the AWS account
- DNS support and DNS hostnames enabled (required for SSM)

### Security Group Rules

The EC2 Security Group (`myraid-assessment-sg`) has the minimum required rules:

**Inbound:**

| Port | Protocol | Source | Justification |
|---|---|---|---|
| 80 | TCP | `0.0.0.0/0` | HTTP application access — public endpoint |
| 22 | TCP | `0.0.0.0/0` | SSH — see Trade-offs (§9) |

**Outbound:**

| Port | Protocol | Destination | Justification |
|---|---|---|---|
| All | All | `0.0.0.0/0` | Required for: DNF package installs, Docker pulls from GHCR, CloudWatch API calls |

Ports **not** open: 5000 (Gunicorn is internal-only, NGINX proxies traffic), 443 (no domain/certificate for assessment scope), all other ports.

---

## 4. Application Security

### NGINX as Reverse Proxy

Gunicorn (the Python WSGI server) is bound to `127.0.0.1:5000` — it is only accessible from localhost. The Security Group does not open port 5000. All traffic enters through NGINX on port 80, which then proxies to Gunicorn internally. This means:

- Gunicorn is never directly exposed to the internet
- NGINX handles connection limits, buffering, and header management
- Gunicorn can be restarted independently of NGINX

### `server_tokens off`

NGINX is configured with `server_tokens off`, which removes the `Server: nginx/1.24.0` header from all HTTP responses. Without this, NGINX advertises its exact version, making version-specific CVE targeting easier.

Before:
```
Server: nginx/1.24.0
```

After (`server_tokens off`):
```
Server: nginx
```

### Security Headers

Three HTTP security headers are added to all responses from NGINX:

| Header | Value | Protection Against |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking — prevents the page from being embedded in an `<iframe>` on a different origin |
| `X-Content-Type-Options` | `nosniff` | MIME type sniffing — forces browsers to use the declared `Content-Type` |
| `X-XSS-Protection` | `1; mode=block` | Cross-site scripting — activates browser XSS filter and blocks the page if an attack is detected |

These headers are set at the NGINX `server` block level with the `always` flag, meaning they are added to all responses including error responses (4xx, 5xx).

### No Sensitive Data in Responses

The Flask API endpoints return only safe, intentionally disclosed data:
- `/` — app name and status
- `/health` — health status and timestamp
- `/info` — app version, Python version, hostname, environment name

No database credentials, environment variables with secrets, stack traces, or internal paths are returned.

---

## 5. Container Security

### Non-Root User

The Docker container runs as `appuser` (a non-root user created in the Dockerfile):

```dockerfile
RUN useradd --create-home appuser
USER appuser
```

If a vulnerability allowed code execution inside the container, the attacker would have the privileges of `appuser` — not `root`. This limits what can be accessed or modified on the host.

### Multi-Stage Build

The Dockerfile uses a two-stage build:

```
Stage 1 (builder): python:3.9-slim
  → pip install --prefix=/install -r requirements.txt
  → build tools, pip cache, and intermediate files stay here

Stage 2 (production): python:3.9-slim (fresh)
  → COPY --from=builder /install /usr/local (only the installed packages)
  → COPY app.py
  → No pip, no build tools, no cache in the final image
```

This reduces the final image size and eliminates build tools (which could be used for post-exploitation).

### Minimal Base Image

`python:3.9-slim` is used instead of `python:3.9` (full) or `python:3.9-alpine`. The slim variant:
- Excludes documentation, locale data, and optional packages
- Has a significantly smaller attack surface than the full image
- Still includes necessary libraries for Gunicorn and Flask

### Docker HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1
```

Docker checks the `/health` endpoint every 30 seconds. After 3 consecutive failures, the container is marked `unhealthy`. This enables automatic detection of application-level failures — not just process crashes.

### Container Restart Policy

The container is started with `--restart unless-stopped`. This ensures the application automatically recovers from crashes without manual intervention.

---

## 6. Storage Security (S3)

The S3 bucket (`myraid-assessment-001`) has four separate security controls:

### Public Access Block

All four public access block settings are enabled:

| Setting | Value | Effect |
|---|---|---|
| `block_public_acls` | `true` | Rejects any PUT request that sets a public ACL |
| `block_public_policy` | `true` | Rejects bucket policies that grant public access |
| `ignore_public_acls` | `true` | Ignores any existing public ACLs |
| `restrict_public_buckets` | `true` | Restricts access to only AWS principals |

Even if someone with IAM access accidentally sets a public ACL or policy, these blocks prevent public access from being granted.

### Server-Side Encryption

All objects stored in the bucket are automatically encrypted at rest using AES-256 (SSE-S3). No configuration is required per upload — encryption is enforced at the bucket level.

### Versioning

Versioning is enabled on the bucket. Every overwrite or deletion creates a new version rather than permanently removing data. This protects against:
- Accidental deletion
- Ransomware that overwrites objects
- Unintended overwrites from the application

### Access Control

The bucket has no bucket policy granting public access. The only principal that can access the bucket is the EC2 IAM role (`myraid-assessment-ec2-role`) via the scoped S3 policy described in §2.

---

## 7. CI/CD Pipeline Security

### Secrets Not in Code

All sensitive values are stored in **GitHub Repository Secrets**, not in files:

| Secret | Where Used | Risk if Exposed |
|---|---|---|
| `EC2_HOST` | Health check URL, SSH target | Low — public IP only |
| `EC2_USER` | SSH username | Very low — `ec2-user` is public knowledge |
| `EC2_SSH_KEY` | SSH authentication | **High** — full server access |

The `EC2_SSH_KEY` secret is masked in logs and never printed during pipeline execution.

### Tests Gate Deployment

The pipeline is structured so that **the deploy job cannot run unless the test job passes**:

```yaml
deploy:
  needs: test
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

The `needs: test` declaration creates a hard dependency — a pytest failure on any of the 3 tests immediately halts the pipeline before any Docker build or deployment occurs.

### Pull Requests Cannot Deploy

The `if` condition on the deploy job restricts deployment to push events on the `main` branch only:

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

When a pull request is opened:
- The `test` job runs — validates the code
- The `deploy` job is **skipped** — no accidental deployment of unreviewed code

### GITHUB_TOKEN for GHCR

The pipeline uses `GITHUB_TOKEN` (automatically provided by GitHub Actions) to authenticate with GHCR. This token:
- Is scoped only to the repository
- Expires at the end of the workflow run
- Requires no manual secret management
- Has `packages: write` permission explicitly declared in the job

---

## 8. Monitoring and Audit Logging

### CloudWatch Log Streams

All 4 log streams are collected under the log group `/myraid-assessment/ec2`:

| Stream | Source | What It Captures |
|---|---|---|
| `user-data` | `/var/log/user_data.log` | Full EC2 bootstrap log — every install command, success or failure |
| `nginx-access` | `/var/log/nginx/app_access.log` | Every HTTP request: IP, method, path, status code, response size |
| `nginx-error` | `/var/log/nginx/app_error.log` | NGINX errors, upstream failures, configuration warnings |
| `app-logs` | `/var/lib/docker/containers/*/*.log` | Gunicorn stdout — application logs, request details, Python exceptions |

These logs enable post-incident investigation and confirm that the application is behaving as expected.

### CloudWatch Alarms

Three metric alarms are configured:

| Alarm | Metric | Threshold | Evaluation | Namespace |
|---|---|---|---|---|
| `myraid-assessment-cpu-high` | CPUUtilization | > 80% | 2 × 5-min periods | `AWS/EC2` |
| `myraid-assessment-memory-high` | mem_used_percent | > 80% | 2 × 5-min periods | `CWAgent` |
| `myraid-assessment-status-check-failed` | StatusCheckFailed | > 0 | 1 × 1-min period | `AWS/EC2` |

The `status-check-failed` alarm triggers within 60 seconds of an EC2 hardware or software failure — the fastest available detection for instance-level problems.

> ⚠️ **Limitation:** The alarms currently have no `alarm_actions` configured — no SNS topic is attached, so no email or SMS notification is sent when an alarm enters ALARM state. This is intentional for assessment scope. In production, an SNS topic should be attached to each alarm to trigger notifications. See §10 for the recommended implementation.

### CloudWatch Agent Metrics

The CloudWatch Agent collects and pushes two custom metrics beyond the default EC2 metrics:

| Metric | Namespace | Dimension | Collection Interval |
|---|---|---|---|
| `mem_used_percent` | `CWAgent` | `InstanceId` | 60 seconds |
| `disk_used_percent` | `CWAgent` | `InstanceId`, `path`, `device`, `fstype` | 60 seconds |

These metrics are used by the CloudWatch Dashboard and the memory alarm.

---

## 9. Known Trade-offs and Accepted Risks

### SSH Open to `0.0.0.0/0`

- **Risk:** Anyone on the internet can attempt SSH authentication against port 22
- **Mitigation in place:** Access requires the private key (`.pem` file). Password authentication is disabled by default on Amazon Linux 2023. Without the private key, SSH connection attempts will be rejected at authentication.
- **Why not restricted to a specific IP:** GitHub Actions runners use dynamic IP addresses that change every pipeline run. Whitelisting a static IP would break the deployment pipeline's SSH-based deploy step.
- **Production solution:** Replace SSH-based deployment with AWS SSM Session Manager (already IAM-enabled via `AmazonSSMManagedInstanceCore`). This eliminates port 22 entirely. Alternatively, use GitHub Actions OIDC to assume an IAM role that can invoke SSM `send-command`.

### HTTP Only (No HTTPS)

- **Risk:** Traffic between the client and NGINX is unencrypted
- **Why:** HTTPS requires a registered domain name for ACM certificate validation. Without a domain, a valid certificate cannot be provisioned. Self-signed certificates trigger browser warnings and provide no trust anchor.
- **Production solution:** Register a domain → create ACM certificate → configure NGINX to terminate TLS on port 443 → add port 443 to Security Group.

### GHCR Package is Public

- **Risk:** Docker image is publicly accessible — anyone can pull it
- **Why:** Making the package public avoids storing GHCR credentials on the EC2 instance. The instance has no GitHub credentials and cannot authenticate to a private GHCR package.
- **Data in image:** The Docker image contains only `app.py` and Python packages. No secrets, no credentials, no environment variables are baked into the image.
- **Production solution:** Use Amazon ECR with an IAM role policy that allows the EC2 instance to pull from ECR without credentials.

### CloudWatch Alarm Actions Not Configured

- **Risk:** If CPU exceeds 80% or an EC2 status check fails, the alarm changes state but no one is notified
- **Why:** For assessment scope, the alarm state visibility in the CloudWatch console is sufficient to demonstrate the monitoring capability. Adding SNS requires email confirmation steps that add setup complexity.
- **Production solution:**
  ```hcl
  resource "aws_sns_topic" "alerts" {
    name = "myraid-assessment-alerts"
  }
  resource "aws_sns_topic_subscription" "email" {
    topic_arn = aws_sns_topic.alerts.arn
    protocol  = "email"
    endpoint  = "ops-team@example.com"
  }
  # Then reference aws_sns_topic.alerts.arn in alarm_actions
  ```

### No Elastic IP

- **Risk:** EC2 public IP changes on every start — the `EC2_HOST` GitHub Secret becomes stale
- **Why:** EIP is free while attached to a running instance but costs ~$0.005/hour when the instance is stopped. Since infrastructure is torn down after assessment, attaching an EIP adds unnecessary cost.
- **Production solution:** Attach an Elastic IP, or use an Application Load Balancer with a stable DNS endpoint.

---

## 10. Production Hardening Recommendations

Ordered by security impact:

| Priority | Recommendation | Effort | Impact |
|---|---|---|---|
| 🔴 Critical | Replace SSH deploy with AWS SSM `send-command` + GitHub OIDC | Medium | Eliminates port 22 and long-lived SSH key |
| 🔴 Critical | Add HTTPS with ACM + custom domain | Low-Medium | Encrypts all traffic |
| 🔴 Critical | Attach SNS topic to CloudWatch Alarms | Low | Real-time incident notification |
| 🟠 High | Move Docker image to Amazon ECR (private) | Low | Removes public image exposure |
| 🟠 High | Enable AWS GuardDuty | Very Low | Threat detection, anomaly monitoring |
| 🟠 High | Add AWS WAF to block malicious requests | Medium | Application-layer protection |
| 🟡 Medium | Enable VPC Flow Logs | Low | Full network-level audit trail |
| 🟡 Medium | Add Elastic IP | Low | Static IP — no secret rotation needed |
| 🟡 Medium | Enable CloudTrail | Low | Full API audit log for all AWS actions |
| 🟡 Medium | Terraform Remote State with S3 + DynamoDB locking | Low | Team-safe state, no local state file |
| 🟢 Low | Enable EBS volume encryption | Low | Encrypt root volume at rest |
| 🟢 Low | Add AWS Config rules | Medium | Continuous compliance monitoring |
| 🟢 Low | Restrict Security Group egress | Medium | Control what services EC2 can call |

---

*Myraid DevOps Assessment*
