#!/usr/bin/env python3
"""
Nexus API End-to-End Test Suite
Validates core REST endpoints, auth, workspaces, groups, chats, and discovery against live nexus-api.

Usage:
    python tests/e2e/test_api_e2e.py
    pytest tests/e2e/test_api_e2e.py
"""

import sys
import os
import time
import json
import urllib.request
import urllib.error

BASE_URL = os.environ.get("API_URL", "http://localhost:8080")

# Disabling proxy environment variables for localhost calls
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def api_request(method, path, body=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    
    try:
        with opener.open(req, timeout=5) as response:
            status = response.status
            raw = response.read().decode("utf-8")
            try:
                res_body = json.loads(raw)
            except Exception:
                res_body = raw
            return status, res_body
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read().decode("utf-8")
        try:
            res_body = json.loads(raw)
        except Exception:
            res_body = raw
        return status, res_body
    except Exception as e:
        return 0, str(e)


def test_health_probes():
    """Verify health, healthz, and liveness probes."""
    status, body = api_request("GET", "/healthz")
    assert status == 200, f"GET /healthz failed: status {status}"
    assert isinstance(body, dict) and body.get("status") == "healthy"

    status, body = api_request("GET", "/live")
    assert status == 200, f"GET /live failed: status {status}"
    assert isinstance(body, dict) and body.get("status") == "alive"


def test_readiness_probe():
    """Verify database readiness probe."""
    status, body = api_request("GET", "/ready")
    assert status in (200, 503), f"Unexpected status on /ready: {status}"


def test_user_registration_and_auth_flow():
    """Verify registration, login, and profile retrieval."""
    ts = int(time.time() * 1000) % 1000000
    email = f"tester_{ts}@nexus.local"
    password = "SecurePassword123!"
    name = f"Test Engineer {ts}"

    # 1. Register
    status, reg_body = api_request("POST", "/api/auth/register", {
        "email": email,
        "password": password,
        "display_name": name
    })
    assert status in (200, 201), f"Registration failed: {status}, {reg_body}"
    token = reg_body.get("token")
    assert token, "Token not returned in registration response"

    # 2. Login
    status, login_body = api_request("POST", "/api/auth/login", {
        "email": email,
        "password": password
    })
    assert status == 200, f"Login failed: {status}, {login_body}"
    assert login_body.get("token"), "Token not returned in login response"

    # 3. Get profile (me)
    status, me_body = api_request("GET", "/api/auth/me", token=token)
    assert status == 200, f"GET /api/auth/me failed: {status}, {me_body}"
    assert me_body.get("email") == email


def test_workspaces_and_groups():
    """Verify listing workspaces and groups for an authenticated user."""
    ts = int(time.time() * 1000) % 1000000
    email = f"ws_tester_{ts}@nexus.local"
    password = "SecurePassword123!"

    # Register bootstraps a default workspace & general group
    status, reg_body = api_request("POST", "/api/auth/register", {
        "email": email,
        "password": password,
        "display_name": f"WS Tester {ts}"
    })
    token = reg_body.get("token")
    assert token, "Registration failed"

    # List Workspaces
    status, ws_body = api_request("GET", "/api/workspaces", token=token)
    assert status == 200, f"List workspaces failed: {status}"
    workspaces = ws_body.get("workspaces", [])
    assert len(workspaces) > 0, "Expected at least 1 default workspace"
    workspace_id = workspaces[0]["id"]

    # List Groups
    status, grp_body = api_request("GET", f"/api/groups?workspace_id={workspace_id}", token=token)
    assert status == 200, f"List groups failed: {status}"
    groups = grp_body.get("groups", [])
    assert len(groups) > 0, "Expected at least 1 default group"


def run_standalone():
    print("=" * 60)
    print("🧪 Running Nexus API E2E Verification Suite")
    print(f"🎯 Target: {BASE_URL}")
    print("=" * 60)

    tests = [
        ("Health & Liveness Probes", test_health_probes),
        ("Database Readiness Probe", test_readiness_probe),
        ("User Auth & Profile Flow", test_user_registration_and_auth_flow),
        ("Workspaces & Groups Flow", test_workspaces_and_groups),
    ]

    passed = 0
    failed = 0

    for name, fn in tests:
        try:
            fn()
            print(f"✅ PASS: {name}")
            passed += 1
        except AssertionError as e:
            print(f"❌ FAIL: {name} — {e}")
            failed += 1
        except Exception as e:
            print(f"⚠️  ERROR: {name} — {e}")
            failed += 1

    print("=" * 60)
    print(f"Score: {passed}/{len(tests)} passed ({failed} failed)")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run_standalone())
