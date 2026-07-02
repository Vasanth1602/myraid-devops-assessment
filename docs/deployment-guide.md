# Deployment Guide — Myraid DevOps Assessment

A complete, step-by-step guide to deploy the Myraid Flask API on AWS from scratch.  
This guide assumes a **fresh start** — no existing infrastructure, no GitHub repository.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository Setup](#2-repository-setup)
3. [AWS Account Setup](#3-aws-account-setup)
4. [Create EC2 Key Pair](#4-create-ec2-key-pair)
5. [Configure Terraform Variables](#5-configure-terraform-variables)
6. [Deploy Infrastructure](#6-deploy-infrastructure)
7. [Configure GitHub Secrets](#7-configure-github-secrets)
8. [Trigger Deployment Pipeline](#8-trigger-deployment-pipeline)
9. [Verify Deployment](#9-verify-deployment)
10. [Teardown](#10-teardown)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

Install these tools before starting:

| Tool | Version | Install |
|---|---|---|
| [Terraform](https://developer.hashicorp.com/terraform/install) | >= 1.5.0 | `choco install terraform` / manual download |
| [AWS CLI](https://aws.amazon.com/cli/) | v2 | `choco install awscli` / manual download |
| [Git](https://git-scm.com/) | Any | `choco install git` |
| [k6](https://k6.io/docs/get-started/installation/) | Any | `choco install k6` (optional — for load testing) |

Verify each tool is installed:

```bash
terraform version   # should show >= 1.5.0
aws --version       # should show aws-cli/2.x.x
git --version
k6 version          # optional
```

---

## 2. Repository Setup

### Option A — Clone (Original)

```bash
git clone https://github.com/Vasanth1602/myraid-devops-assessment.git
cd myraid-devops-assessment
```

### Option B — Fork + Clone (Your Own Deployment)

1. Fork the repository on GitHub
2. Update `IMAGE_NAME` in `.github/workflows/deploy.yml`:
   ```yaml
   IMAGE_NAME: ghcr.io/YOUR_GITHUB_USERNAME/myraid-devops-assessment
   ```
   > ⚠️ GitHub usernames are case-sensitive but GHCR requires **lowercase**. Use `yourusername` not `YourUsername`.

3. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/myraid-devops-assessment.git
   cd myraid-devops-assessment
   ```

---

## 3. AWS Account Setup

### 3.1 — Create IAM User

1. Log into **AWS Console → IAM → Users → Create user**
2. Give it a name (e.g., `myraid-terraform-user`)
3. Attach policy: **AdministratorAccess** (or a custom policy scoped to EC2, VPC, IAM, S3, CloudWatch)
4. Under **Security credentials → Access keys → Create access key**
5. Download or note the **Access Key ID** and **Secret Access Key**

### 3.2 — Configure AWS CLI

```bash
aws configure
```

Enter when prompted:

```
AWS Access Key ID:     <your-access-key-id>
AWS Secret Access Key: <your-secret-access-key>
Default region name:   ap-south-1
Default output format: json
```

Verify:

```bash
aws sts get-caller-identity
```

Expected response:

```json
{
    "UserId": "AIDA...",
    "Account": "130961287992",
    "Arn": "arn:aws:iam::130961287992:user/myraid-terraform-user"
}
```

> ⚠️ If this command fails, Terraform will also fail. Fix AWS CLI configuration before proceeding.

---

## 4. Create EC2 Key Pair

The EC2 key pair **must be created manually** in the AWS Console before running Terraform. Terraform references the key by name but does not create it.

1. Go to **AWS Console → EC2 → Network & Security → Key Pairs**
2. Click **Create key pair**
3. Configure:
   - **Name:** `myraid-assessment-key`
   - **Key pair type:** RSA
   - **Private key file format:** `.pem`
4. Click **Create key pair** — the `.pem` file downloads automatically
5. Move it to a permanent location:

```bash
# Linux / macOS
mv ~/Downloads/myraid-assessment-key.pem ~/.ssh/
chmod 400 ~/.ssh/myraid-assessment-key.pem

# Windows — store somewhere accessible, e.g.:
# C:\Users\YourName\myraid-assessment-key.pem
```

> ⚠️ **Critical:** The `.pem` file downloads once only. Store it safely — losing it means losing SSH access to the instance. It is already listed in `.gitignore` and must never be committed to Git.

---

## 5. Configure Terraform Variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:

```hcl
# Name of the EC2 key pair created in Step 4
key_name = "myraid-assessment-key"

# AWS region — keep as ap-south-1 unless changing
aws_region = "ap-south-1"

# Instance type — t3.micro is Free Tier eligible
instance_type = "t3.micro"

# Project name — used for all resource names and tags
project_name = "myraid-assessment"

# Environment tag
environment = "assessment"

# S3 bucket name suffix — must be globally unique across ALL AWS accounts
# Change this if you see "BucketAlreadyExists" during apply
s3_bucket_suffix = "001"
```

> ⚠️ `terraform.tfvars` is listed in `.gitignore` and will **not** be committed. Never commit this file — it may contain sensitive values in other projects.

---

## 6. Deploy Infrastructure

### 6.1 — Initialize Terraform

```bash
# From the terraform/ directory
terraform init
```

Expected output:

```
Terraform has been successfully initialized!
```

### 6.2 — Preview Changes

```bash
terraform plan
```

Review the plan. You should see **~18 resources to create** on a fresh deployment, including:
- VPC, Subnet, Internet Gateway, Route Table
- Security Group
- IAM Role, IAM Policies, IAM Instance Profile
- EC2 Instance
- S3 Bucket (+ versioning, encryption, public access block)
- CloudWatch Dashboard
- CloudWatch Metric Alarms (3)

### 6.3 — Apply Infrastructure

```bash
terraform apply
```

Type `yes` when prompted, or use:

```bash
terraform apply -auto-approve
```

> ⏱️ Deployment takes approximately **2–3 minutes**. The EC2 instance is created first, then CloudWatch and S3 resources.

### 6.4 — Note the Outputs

After apply completes, Terraform prints all outputs:

```
application_url           = "http://<public-ip>"
cloudwatch_dashboard_url  = "https://ap-south-1.console.aws.amazon.com/cloudwatch/..."
health_url                = "http://<public-ip>/health"
instance_id               = "i-0xxxxxxxxxxxxxxxxx"
public_ip                 = "<public-ip>"
s3_bucket_name            = "myraid-assessment-001"
ssh_command               = "ssh -i myraid-assessment-key.pem ec2-user@<public-ip>"
```

**Copy the `public_ip` value** — you need it for GitHub Secrets in the next step.

To retrieve outputs at any time:

```bash
terraform output
terraform output public_ip  # just the IP
```

---

## 7. Configure GitHub Secrets

The CI/CD pipeline uses 3 GitHub repository secrets to SSH into the EC2 instance and deploy.

Go to: **GitHub → Your Repository → Settings → Secrets and variables → Actions → New repository secret**

Add each secret:

| Secret Name | Value | How to Get It |
|---|---|---|
| `EC2_HOST` | EC2 public IP | `terraform output public_ip` |
| `EC2_USER` | `ec2-user` | Fixed value — Amazon Linux 2023 default user |
| `EC2_SSH_KEY` | Full `.pem` file contents | See below |

**How to get the `.pem` file contents on Windows:**

```powershell
Get-Content "C:\path\to\myraid-assessment-key.pem"
```

Copy everything including the header and footer lines:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----
```

---

## 8. Trigger Deployment Pipeline

### 8.1 — Wait for EC2 Bootstrap

After `terraform apply`, the EC2 bootstrap script (`user_data.sh`) runs automatically. It installs Docker, NGINX, and the CloudWatch Agent. This takes **3–5 minutes**.

Check when the app is ready:

```bash
# Replace with your actual EC2 public IP
curl http://<EC2_PUBLIC_IP>/health
```

Wait until you see:

```json
{"status": "healthy", "timestamp": "2026-07-02T..."}
```

### 8.2 — Push Code to Trigger Pipeline

```bash
# From the repository root
git commit --allow-empty -m "chore: trigger initial deployment"
git push origin main
```

Watch the pipeline run at:
```
https://github.com/YOUR_USERNAME/myraid-devops-assessment/actions
```

### 8.3 — Pipeline Stages

The pipeline has **2 jobs, 8 stages total**:

**Job 1: `test`** (runs on every PR and push to main)
- Stage 1: Checkout repository
- Stage 2: Set up Python 3.9 + install dependencies
- Stage 3: Run pytest (3 tests — must all pass)

**Job 2: `deploy`** (runs only on push to main, requires `test` to pass)
- Stage 4: Checkout repository
- Stage 5: Build Docker image (tagged with commit SHA + `latest`)
- Stage 6: Login to GHCR + Push image
- Stage 7: SSH into EC2 → `docker pull` → `docker stop` → `docker run`
- Stage 8: Health check retry loop (12 attempts × 5s = 60s max)

### 8.4 — Make GHCR Package Public (First Run Only)

After the first pipeline run, the Docker image is pushed to GitHub Container Registry. Make it public so the EC2 can pull it without credentials:

1. Go to **https://github.com/YOUR_USERNAME?tab=packages**
2. Click `myraid-devops-assessment`
3. **Package settings** → **Change visibility** → **Public**
4. Type the package name to confirm → **I understand, change package visibility**

> After making the package public, trigger the pipeline again by pushing a new commit or re-running the latest workflow from the Actions tab.

---

## 9. Verify Deployment

### 9.1 — Test Application Endpoints

```bash
# All commands use your EC2 public IP
EC2_IP="<your-ec2-public-ip>"

# Root endpoint
curl http://$EC2_IP/
# Expected: {"app":"myraid-devops-assessment","message":"Welcome to Myraid DevOps Assessment","status":"running"}

# Health check
curl http://$EC2_IP/health
# Expected: {"status":"healthy","timestamp":"2026-..."}

# Info endpoint
curl http://$EC2_IP/info
# Expected: {"app":"myraid-devops-assessment","environment":"production","host":"...","python_version":"3.9.x","started_at":"...","version":"1.0.0"}
```

### 9.2 — Verify Docker Container

SSH into the EC2 instance:

```bash
ssh -i /path/to/myraid-assessment-key.pem ec2-user@<EC2_PUBLIC_IP>
```

Check container status:

```bash
# Container should show (healthy) status
docker ps

# View container logs
docker logs flask-app

# Check NGINX
sudo systemctl status nginx

# Check CloudWatch Agent
sudo systemctl status amazon-cloudwatch-agent
```

### 9.3 — Verify AWS Resources

**S3 Bucket:**

```bash
aws s3 ls s3://myraid-assessment-001
aws s3api get-bucket-versioning --bucket myraid-assessment-001
# Expected: {"Status": "Enabled"}

aws s3api get-bucket-encryption --bucket myraid-assessment-001
# Expected: AES256
```

**CloudWatch Logs:**

```bash
aws logs describe-log-groups --log-group-name-prefix "/myraid-assessment"
aws logs describe-log-streams --log-group-name "/myraid-assessment/ec2"
# Expected: 4 log streams: user-data, nginx-access, nginx-error, app-logs
```

**CloudWatch Alarms:**

```bash
aws cloudwatch describe-alarms --alarm-name-prefix "myraid-assessment"
# Expected: 3 alarms in OK state
```

### 9.4 — Run Load Test (Optional)

```bash
# From the repository root
k6 run --env BASE_URL=http://<EC2_PUBLIC_IP> load-testing/k6-script.js
```

See `docs/load-testing-report.md` for full results and analysis.

---

## 10. Teardown

Destroy all AWS infrastructure when done:

```bash
cd terraform
terraform destroy -auto-approve
```

This destroys **all resources** in this order (Terraform handles dependencies automatically):
- CloudWatch Dashboard + 3 Alarms
- EC2 Instance
- S3 Bucket (fails if not empty — see note below)
- IAM Instance Profile, Policies, Role
- Security Group
- Subnet, Route Table Association, Route Table, Internet Gateway, VPC

> ⚠️ **S3 Bucket Not Empty:** If the destroy fails with `BucketNotEmpty`, empty the bucket first:
> ```bash
> aws s3 rm s3://myraid-assessment-001 --recursive
> terraform destroy -auto-approve
> ```

After destroy, verify in AWS Console that no resources remain under EC2, VPC, S3, IAM, or CloudWatch.

---

## 11. Troubleshooting

### EC2 Bootstrap Failed — App Not Starting

SSH into the instance and check the bootstrap log:

```bash
ssh -i myraid-assessment-key.pem ec2-user@<EC2_PUBLIC_IP>
sudo tail -100 /var/log/user_data.log
```

Common causes:
- `docker: command not found` → DNF install failed, usually a network issue. Reboot the instance.
- `NGINX config test failed` → Usually a syntax error. Check `/etc/nginx/conf.d/app.conf`.
- `CloudWatch Agent failed` → IAM role not propagated yet. Restart manually:
  ```bash
  sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s
  ```

---

### GitHub Actions Pipeline Failing

**`test` job fails:** Run tests locally to see the error:
```bash
cd app
pip install -r requirements.txt
pytest tests/ -v
```

**`deploy` job fails at "Deploy to EC2":**
- Verify all 3 GitHub Secrets are set (`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`)
- Verify EC2 Security Group allows port 22 inbound
- Verify the `.pem` file contents in `EC2_SSH_KEY` include the header/footer lines

**`deploy` job fails at "Validate deployment health":**
- The container started but `/health` is not returning 200
- SSH into EC2 and check: `docker logs flask-app`
- Check if NGINX is running: `sudo systemctl status nginx`

---

### Terraform Apply Errors

**`BucketAlreadyExists`:**
Change `s3_bucket_suffix` in `terraform.tfvars` to a unique value (e.g., your initials + numbers):
```hcl
s3_bucket_suffix = "vk42"
```

**`InvalidKeyPair.NotFound`:**
The key pair name in `terraform.tfvars` doesn't match what's in AWS. Verify the exact key pair name in **AWS Console → EC2 → Key Pairs**.

**`UnauthorizedOperation`:**
AWS CLI credentials don't have enough permissions. Verify the IAM user has sufficient policies attached.

---

*Myraid DevOps Assessment*
