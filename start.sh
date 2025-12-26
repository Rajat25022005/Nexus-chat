#!/bin/bash
# Start Server
echo "Starting Backend Server..."
cd server
npm start &
SERVER_PID=$!

# Start Client
echo "Starting Frontend Client..."
cd ../client
npm run dev &
CLIENT_PID=$!

# Cleanup on exit
trap "kill $SERVER_PID $CLIENT_PID" EXIT

wait
