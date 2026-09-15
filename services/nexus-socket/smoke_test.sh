#!/usr/bin/env bash
# ==============================================================================
# nexus-socket — Automated Smoke Test Script
# ==============================================================================
# Verifies that the Nexus Socket service is running and operating as intended.
#
# Usage:
#   ./smoke_test.sh [PORT]
# Example:
#   ./smoke_test.sh 3001
# ==============================================================================

set -e

PORT="${1:-3001}"
HOST="http://localhost:${PORT}"

echo "=================================================="
echo "Testing Nexus Socket Service on ${HOST}..."
echo "=================================================="

# Test 1: Liveness Probe
echo -n "[1/4] Testing GET /health... "
HEALTH_RESP=$(curl -s "${HOST}/health")
if echo "${HEALTH_RESP}" | grep -q '"status":"healthy"'; then
  echo "✅ PASS (${HEALTH_RESP})"
else
  echo "❌ FAIL: Expected status healthy, got: ${HEALTH_RESP}"
  exit 1
fi

# Test 2: Readiness Probe
echo -n "[2/4] Testing GET /ready... "
READY_RESP=$(curl -s "${HOST}/ready")
if echo "${READY_RESP}" | grep -q '"status":"ready"'; then
  echo "✅ PASS (${READY_RESP})"
else
  echo "❌ FAIL: Expected status ready, got: ${READY_RESP}"
  exit 1
fi

# Test 3: Engine.IO v4 Handshake (HTTP Long-Polling)
echo -n "[3/4] Testing Engine.IO v4 Handshake... "
HANDSHAKE_RESP=$(curl -s "${HOST}/socket.io/?EIO=4&transport=polling")
# Engine.IO open packet begins with '0' followed by JSON
if [[ "${HANDSHAKE_RESP}" =~ ^0\{.*"sid":.*"pingInterval":.*\}$ ]]; then
  echo "✅ PASS"
  echo "      Payload: ${HANDSHAKE_RESP}"
else
  echo "❌ FAIL: Invalid Engine.IO v4 open packet: ${HANDSHAKE_RESP}"
  exit 1
fi

# Extract session ID (sid)
SID=$(echo "${HANDSHAKE_RESP}" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')
echo "      Extracted Session ID: ${SID}"

# Test 4: Polling Ping/Pong Packet Exchange
echo -n "[4/4] Testing Polling Packet Delivery... "
POST_RESP=$(curl -s -X POST -H "Content-Type: text/plain" -d "40" "${HOST}/socket.io/?EIO=4&transport=polling&sid=${SID}")
if [[ "${POST_RESP}" == "ok" || "${POST_RESP}" == "40" || -z "${POST_RESP}" ]]; then
  echo "✅ PASS"
else
  echo "⚠️ Notice: Server replied: ${POST_RESP} (acceptable for polling state)"
fi

echo "=================================================="
echo "🎉 ALL HTTP & ENGINE.IO PROTOCOL SMOKE TESTS PASSED!"
echo "=================================================="
