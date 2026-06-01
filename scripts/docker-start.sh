#!/bin/sh
# Production entrypoint — runs all services in parallel without concurrently.
# Tini (PID 1) will forward signals to this script; we trap and forward to children.
set -e

# Storage bucket init (one-shot)
node --env-file=.env dist/storage-init.js

# Start all services in background
node --env-file=.env dist/worker.js &
PID_WORKER=$!

node --env-file=.env dist/watchdog.js &
PID_WATCHDOG=$!

node --env-file=.env dist/bull-board.js &
PID_BOARD=$!

npx next start -H 0.0.0.0 &
PID_NEXT=$!

# If any child exits, kill all others and exit with that code
cleanup() {
  kill $PID_WORKER $PID_WATCHDOG $PID_BOARD $PID_NEXT 2>/dev/null || true
  wait
}

trap cleanup EXIT INT TERM

# Wait for any child to exit
wait -n $PID_WORKER $PID_WATCHDOG $PID_BOARD $PID_NEXT
EXIT_CODE=$?
cleanup
exit $EXIT_CODE
