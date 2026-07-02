# Myraid DevOps Assessment — Implementation Plan

> **Role:** Internship (1–2 years experience)  
> **Deadline:** 2026-07-03 | **Scope:** Pragmatic, not over-engineered  
> **Current Score Estimate:** ~57% → **Target: ~88–90%**

---

## Open Questions / Decisions Before We Start

> [!IMPORTANT]
> Confirm these before implementation begins:

1. **Your SSH IP** — Do you have a static IP or dynamic? (affects SSH restriction)
2. **Self-signed HTTPS** — Do you want port 443 with a self-signed cert? (optional, adds ~30 min)
3. **`/metrics` endpoint** — Do you want a simple JSON metrics endpoint in Flask? (optional, adds ~10 min)
4. **GHCR package** — Is `myraid-devops-assessment` already created in GHCR, or will it be created on first pipeline run?
5. **EC2 currently running?** — Is your EC2 instance up and accessible right now?

---

## Proposed Changes — By File

---

### Phase 1 — Terraform Infrastructure

#### [MODIFY] [main.tf](file:///v:/myraid-devops-assessment/terraform/main.tf)
- Add `aws_s3_bucket` resource (name: `myraid-assessment-<random_suffix>`)
- Add `aws_s3_bucket_versioning` resource
- Add `aws_s3_bucket_server_side_encryption_configuration` resource
- Add `aws_s3_bucket_public_access_block` resource
- Add `aws_iam_policy` for S3 least-privilege (PutObject + GetObject on that bucket only)
- Add `aws_iam_role_policy_attachment` to attach S3 policy to EC2 role
- Add `aws_cloudwatch_dashboard` with widgets for CPU, Memory, Disk, Network
- Add `aws_cloudwatch_metric_alarm` — CPU Utilization > 80%
- Add `aws_cloudwatch_metric_alarm` — Memory Used % > 80%
- Add `aws_cloudwatch_metric_alarm` — StatusCheckFailed = 1
- Add port 443 ingress to Security Group (needed for self-signed HTTPS if chosen)

#### [MODIFY] [variables.tf](file:///v:/myraid-devops-assessment/terraform/variables.tf)
- Add `your_ip` variable (for SSH restriction — with `0.0.0.0/0` as fallback default)

#### [MODIFY] [outputs.tf](file:///v:/myraid-devops-assessment/terraform/outputs.tf)
- Add `s3_bucket_name` output
- Add `cloudwatch_dashboard_url` output

#### [MODIFY] [terraform.tfvars.example](file:///v:/myraid-devops-assessment/terraform/terraform.tfvars.example)
- Add `your_ip` example entry

---

### Phase 2 — EC2 Bootstrap (user_data.sh)

#### [MODIFY] [user_data.sh](file:///v:/myraid-devops-assessment/terraform/user_data.sh)
- Add `metrics` section to CloudWatch Agent config:
  - `mem_used_percent` (Memory metric — not native in CW, must push manually)
  - `disk_used_percent` for `/` mount
  - Add `InstanceId` dimension
- Add Docker/Gunicorn log collection to CloudWatch Agent `collect_list`
- Add NGINX security headers to `app.conf`:
  - `X-Frame-Options SAMEORIGIN`
  - `X-Content-Type-Options nosniff`
  - `X-XSS-Protection "1; mode=block"`
  - `server_tokens off`

---

### Phase 3 — Application

#### [MODIFY] [Dockerfile](file:///v:/myraid-devops-assessment/app/Dockerfile)
- Add `HEALTHCHECK` instruction (calls `/health` endpoint every 30s)

#### [MODIFY] [app.py](file:///v:/myraid-devops-assessment/app/app.py) *(optional)*
- Add `/metrics` endpoint returning uptime, request count (simple JSON — no Prometheus)

#### [MODIFY] [test_app.py](file:///v:/myraid-devops-assessment/app/tests/test_app.py) *(only if /metrics added)*
- Add test for `/metrics` endpoint

---

### Phase 4 — CI/CD

#### [MODIFY] [deploy.yml](file:///v:/myraid-devops-assessment/.github/workflows/deploy.yml)
- Add `on: pull_request` trigger (test-only job — no deploy)
- Separate into two jobs: `test` (runs on PR + push) and `deploy` (runs on push to main only)

---

### Phase 5 — Load Testing

#### [NEW] `load-testing/k6-script.js`
- Virtual users: 10–20 (appropriate for t3.micro)
- Duration: 1 minute
- Targets all 3 endpoints: `/`, `/health`, `/info`
- Thresholds: p95 < 500ms, error rate < 1%

---

### Phase 6 — Documentation

#### [NEW] [docs/deployment-guide.md](file:///v:/myraid-devops-assessment/docs/deployment-guide.md)
- Standalone step-by-step guide (extracted + cleaned from README)

#### [NEW] [docs/security-summary.md](file:///v:/myraid-devops-assessment/docs/security-summary.md)
- IAM, SG rules, container security, trade-offs, known gaps

#### [NEW] [docs/load-testing-report.md](file:///v:/myraid-devops-assessment/docs/load-testing-report.md)
- Results table, screenshots, bottleneck analysis, recommendations
- **Written after load test is actually executed**

#### [NEW] [docs/final-report.md](file:///v:/myraid-devops-assessment/docs/final-report.md)
- Executive summary, setup steps, results, challenges, improvements
- **Written last — references all other docs**

#### [MODIFY] [README.md](file:///v:/myraid-devops-assessment/README.md)
- Update Stack table (add S3, CloudWatch Dashboards/Alarms)
- Update Security Considerations section (add new items)
- Add link to all 4 new docs

---

## Execution Order (Sequential — Dependencies First)

```
Step 1  →  Terraform (main.tf, variables.tf, outputs.tf, tfvars.example)
Step 2  →  user_data.sh (CW metrics + Docker logs + NGINX headers)
Step 3  →  Dockerfile (HEALTHCHECK)
Step 4  →  app.py (optional /metrics) + test_app.py
Step 5  →  deploy.yml (PR workflow)
Step 6  →  terraform apply → wait for EC2 to boot
Step 7  →  Push code → verify GitHub Actions pipeline passes
Step 8  →  Verify CloudWatch logs and metrics are appearing
Step 9  →  Install k6 locally → run load test against live EC2
Step 10 →  Screenshot CloudWatch during/after load test
Step 11 →  deployment-guide.md + security-summary.md
Step 12 →  load-testing-report.md (using real data from Step 9–10)
Step 13 →  final-report.md
Step 14 →  Update README.md
Step 15 →  Take all 8 screenshots
Step 16 →  Record 5–10 min demo video (do this last)
```

---

## Verification Plan

### Automated Tests
```bash
# Run unit tests locally
cd app && pytest tests/ -v

# Verify health endpoint after deploy
curl http://<EC2_PUBLIC_IP>/health

# Verify all endpoints
curl http://<EC2_PUBLIC_IP>/
curl http://<EC2_PUBLIC_IP>/info
```

### Manual Verification Checklist
- [ ] `terraform apply` completes with no errors
- [ ] EC2 instance is Running in AWS Console
- [ ] S3 bucket visible in AWS Console with versioning + encryption enabled
- [ ] NGINX responds on port 80
- [ ] GitHub Actions pipeline shows all stages green
- [ ] CloudWatch Log Group `/myraid-assessment/ec2` has all 4 streams
- [ ] CloudWatch Custom Metrics (`mem_used_percent`) visible in console
- [ ] CloudWatch Dashboard shows live data
- [ ] All 3 CloudWatch Alarms in OK state
- [ ] k6 load test completes without errors
- [ ] All 8 screenshots captured

---

## Scope Boundary (What We're NOT Doing)

| Excluded | Reason |
|---|---|
| API Gateway | No ALB/Lambda backend — justified in README |
| ALB / Auto Scaling | Not Free Tier, not needed for internship scope |
| ECS / EKS / Lambda | Way over-engineered for this role |
| CloudFront / Route53 | No domain registered |
| RDS | No database in the app |
| Prometheus / Grafana | CloudWatch is the AWS-native choice here |

---

## Estimated Time Per Phase

| Phase | Effort |
|---|---|
| Terraform (S3 + CW) | ~45 min |
| user_data.sh updates | ~20 min |
| Dockerfile + app.py | ~15 min |
| deploy.yml PR workflow | ~10 min |
| terraform apply + verify | ~15 min |
| GitHub push + pipeline | ~10 min |
| CloudWatch verification | ~15 min |
| k6 load test + screenshots | ~30 min |
| 4 documentation files | ~60 min |
| README update | ~10 min |
| All screenshots | ~20 min |
| Demo video | ~15 min |
| **Total** | **~4.5 hours** |
