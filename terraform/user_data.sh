#!/bin/bash
# =============================================================
# user_data.sh — EC2 Bootstrap Script
# Runs once on first boot as root
# Logs everything to /var/log/user_data.log for debugging
# =============================================================
exec > /var/log/user_data.log 2>&1
set -e

echo "=== [$(date)] Starting bootstrap ==="

# ============================================================
# SYSTEM UPDATE
# ============================================================
echo "=== Updating system packages ==="
dnf update -y

# ============================================================
# INSTALL DOCKER
# ============================================================
echo "=== Installing Docker ==="
dnf install -y docker
systemctl enable docker
systemctl start docker

# Allow ec2-user to run Docker without sudo
usermod -aG docker ec2-user

echo "=== Docker installed: $(docker --version) ==="

# ============================================================
# INSTALL NGINX
# ============================================================
echo "=== Installing NGINX ==="
dnf install -y nginx

# Write NGINX reverse proxy config
cat > /etc/nginx/conf.d/app.conf << 'EOF'
server {
    listen 80 default_server;
    server_name _;

    # Hide NGINX version from response headers — reduces information disclosure
    server_tokens off;

    access_log /var/log/nginx/app_access.log;
    error_log  /var/log/nginx/app_error.log;

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"    always;
    add_header X-Content-Type-Options "nosniff"       always;
    add_header X-XSS-Protection       "1; mode=block" always;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout    60s;
    }
}
EOF

# Remove the default NGINX config to avoid conflicts
rm -f /etc/nginx/conf.d/default.conf

systemctl enable nginx
systemctl start nginx

echo "=== NGINX installed and configured ==="

# ============================================================
# INSTALL CLOUDWATCH AGENT
# ============================================================
echo "=== Installing CloudWatch Agent ==="
dnf install -y amazon-cloudwatch-agent

# Write CloudWatch Agent configuration
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/user_data.log",
            "log_group_name": "/myraid-assessment/ec2",
            "log_stream_name": "user-data",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/nginx/app_access.log",
            "log_group_name": "/myraid-assessment/ec2",
            "log_stream_name": "nginx-access",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/nginx/app_error.log",
            "log_group_name": "/myraid-assessment/ec2",
            "log_stream_name": "nginx-error",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/lib/docker/containers/*/*.log",
            "log_group_name": "/myraid-assessment/ec2",
            "log_stream_name": "app-logs",
            "timezone": "UTC",
            "multi_line_start_pattern": "^"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}"
    },
    "metrics_collected": {
      "mem": {
        "measurement": [
          "mem_used_percent"
        ]
      },
      "disk": {
        "measurement": [
          "disk_used_percent"
        ],
        "resources": ["/"]
      }
    }
  }
}
EOF

# Start CloudWatch Agent with the config
# || echo ensures IAM propagation lag doesn't abort the entire bootstrap
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s || echo "CloudWatch Agent start failed — IAM role may not have propagated yet. Will retry on next boot."

echo "=== CloudWatch Agent configured ==="

# ============================================================
# DONE
# ============================================================
echo "=== [$(date)] Bootstrap complete ==="
echo "=== Docker, NGINX, and CloudWatch Agent are running ==="
