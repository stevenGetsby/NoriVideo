#!/bin/sh
# Production entrypoint.
# SERVICE_MODE=web|worker|watchdog|board|all
set -e

SERVICE_MODE="${SERVICE_MODE:-all}"

run_storage_init() {
  node --env-file=.env dist/storage-init.js
}

case "$SERVICE_MODE" in
  web)
    run_storage_init
    exec npx next start -H 0.0.0.0
    ;;
  worker)
    exec node --env-file=.env dist/worker.js
    ;;
  watchdog)
    exec node --env-file=.env dist/watchdog.js
    ;;
  board)
    exec node --env-file=.env dist/bull-board.js
    ;;
  all)
    run_storage_init

    node --env-file=.env dist/worker.js &
    PID_WORKER=$!

    node --env-file=.env dist/watchdog.js &
    PID_WATCHDOG=$!

    node --env-file=.env dist/bull-board.js &
    PID_BOARD=$!

    npx next start -H 0.0.0.0 &
    PID_NEXT=$!

    cleanup() {
      kill $PID_WORKER $PID_WATCHDOG $PID_BOARD $PID_NEXT 2>/dev/null || true
      wait
    }

    trap cleanup EXIT INT TERM

    wait -n $PID_WORKER $PID_WATCHDOG $PID_BOARD $PID_NEXT
    EXIT_CODE=$?
    cleanup
    exit $EXIT_CODE
    ;;
  *)
    echo "Unsupported SERVICE_MODE: $SERVICE_MODE" >&2
    exit 1
    ;;
esac
