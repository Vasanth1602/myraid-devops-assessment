"""
Myraid — DevOps Engineer Assessment
Simple Flask API Application
"""

import os
import platform
from datetime import datetime

from flask import Flask, jsonify

app = Flask(__name__)

APP_VERSION = "1.0.0"
APP_NAME = "myraid-devops-assessment"
START_TIME = datetime.utcnow().isoformat()


@app.route("/")
def index():
    """Root endpoint — confirms app is running."""
    return jsonify({
        "app": APP_NAME,
        "status": "running",
        "message": "Welcome to Myraid DevOps Assessment"
    })


@app.route("/health")
def health():
    """Health check endpoint — used by CI/CD pipeline validation."""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    })


@app.route("/info")
def info():
    """Info endpoint — returns app and environment metadata."""
    return jsonify({
        "app": APP_NAME,
        "version": APP_VERSION,
        "started_at": START_TIME,
        "python_version": platform.python_version(),
        "host": platform.node(),
        "environment": os.environ.get("ENVIRONMENT", "production")
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
