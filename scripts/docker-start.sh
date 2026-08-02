#!/bin/sh
# Production entrypoint.
# SERVICE_MODE=web|worker|watchdog|board|all
set -e

SERVICE_MODE="${SERVICE_MODE:-all}"

ensure_service_config() {
  TARGET="${NORI_SERVICE_CONFIG:-}"
  [ -n "$TARGET" ] || return 0
  [ -s "$TARGET" ] && return 0

  mkdir -p "$(dirname "$TARGET")"
  SOURCE=""
  if [ -s /app/config/services.prod.json ]; then
    SOURCE=/app/config/services.prod.json
  elif [ -s /app/config/services.json ]; then
    SOURCE=/app/config/services.json
  fi
  [ -n "$SOURCE" ] || return 0

  TEMP="$TARGET.init.$$"
  cp "$SOURCE" "$TEMP"
  chmod 600 "$TEMP"
  mv "$TEMP" "$TARGET"
}

run_storage_init() {
  node --env-file=.env dist/storage-init.js
}

ensure_service_config

case "$SERVICE_MODE" in
  web)
    run_storage_init
    exec npx next start -H 0.0.0.0
    ;;
  worker)
    run_storage_init
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

    while :; do
      for PID in $PID_WORKER $PID_WATCHDOG $PID_BOARD $PID_NEXT; do
        if ! kill -0 "$PID" 2>/dev/null; then
          set +e
          wait "$PID"
          EXIT_CODE=$?
          cleanup
          exit "$EXIT_CODE"
        fi
      done
      sleep 1
    done
    ;;
  *)
    echo "Unsupported SERVICE_MODE: $SERVICE_MODE" >&2
    exit 1
    ;;
esac
