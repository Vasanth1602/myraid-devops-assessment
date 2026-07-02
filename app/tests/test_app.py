"""
Unit tests for Myraid DevOps Assessment Flask API
Tests all 3 endpoints using Flask's built-in test client
"""

import pytest
import sys
import os

# Add the app directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


@pytest.fixture
def client():
    """Create a test client for the Flask app."""
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_index_returns_200(client):
    """GET / should return HTTP 200 with running status."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "running"
    assert data["app"] == "myraid-devops-assessment"


def test_health_returns_healthy(client):
    """GET /health should return HTTP 200 with healthy status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert "timestamp" in data


def test_info_returns_version(client):
    """GET /info should return HTTP 200 with version information."""
    response = client.get("/info")
    assert response.status_code == 200
    data = response.get_json()
    assert "version" in data
    assert data["version"] == "1.0.0"
    assert data["app"] == "myraid-devops-assessment"
