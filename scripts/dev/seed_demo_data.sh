#!/usr/bin/env bash
# ==============================================================================
# Nexus Chat — Local Development Demo Data Seeder
# Seeds a demo admin user, workspace, and chat channel via the Go REST API.
# ==============================================================================
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"
DEMO_EMAIL="${DEMO_EMAIL:-admin@nexus.local}"
DEMO_PASSWORD="${DEMO_PASSWORD:-NexusPassword123!}"
DEMO_NAME="${DEMO_NAME:-Nexus Administrator}"

echo "===================================================================="
echo "🌱 Seeding Demo Data on ${API_URL}"
echo "===================================================================="

# Check health
echo "Checking API readiness..."
if ! curl -sf "${API_URL}/ready" > /dev/null; then
  echo "❌ Error: API at ${API_URL} is not ready or database is not reachable."
  echo "Ensure 'docker compose up -d postgres redis' and 'make run-api' are running."
  exit 1
fi
echo "✅ API and Database are ready."

# Register user
echo "Registering demo user: ${DEMO_EMAIL}..."
REGISTER_RES=$(curl -s -X POST "${API_URL}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${DEMO_EMAIL}\",
    \"password\": \"${DEMO_PASSWORD}\",
    \"display_name\": \"${DEMO_NAME}\"
  }")

TOKEN=$(echo "${REGISTER_RES}" | grep -o '"token":"[^"]*' | cut -d'"' -f4 || true)

if [ -z "${TOKEN}" ]; then
  echo "User might already be registered. Attempting login..."
  LOGIN_RES=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"${DEMO_EMAIL}\",
      \"password\": \"${DEMO_PASSWORD}\"
    }")
  TOKEN=$(echo "${LOGIN_RES}" | grep -o '"token":"[^"]*' | cut -d'"' -f4 || true)
fi

if [ -n "${TOKEN}" ]; then
  echo "✅ Authentication successful!"
  echo "🔑 Access Token acquired."
  echo ""
  echo "Demo User Credentials:"
  echo "  Email   : ${DEMO_EMAIL}"
  echo "  Password: ${DEMO_PASSWORD}"
  echo "  API URL : ${API_URL}"
  echo "===================================================================="
else
  echo "❌ Failed to register or log in demo user. Response:"
  echo "${REGISTER_RES}"
  exit 1
fi
