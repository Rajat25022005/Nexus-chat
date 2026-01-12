#!/bin/bash
# Start Server
echo "Starting Backend Server..."
cd nexus-rag
# Use the venv python explicitly
../venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
SERVER_PID=$!

# Start Client
echo "Starting Frontend Client..."
cd ../client
npm run dev &
CLIENT_PID=$!

# Cleanup on exit
trap "kill $SERVER_PID $CLIENT_PID" EXIT

wait
