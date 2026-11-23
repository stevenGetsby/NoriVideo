#!/usr/bin/env bash
set -euo pipefail

# Disposable MySQL and Redis only. The app's usual connections are never used.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
unset MYSQL_PWD REDIS_USERNAME REDIS_PASSWORD REDIS_TLS
for command in mysqld mysql mysqladmin redis-server redis-cli node mktemp; do command -v "$command" >/dev/null; done
work="$(mktemp -d /tmp/nori-canvas-race-XXXXXX)"
mkdir "$work/data"
socket="$work/mysql.sock"
mysql_pid=''
redis_pid=''
cleanup() {
  if [[ -n "$redis_pid" ]]; then
    kill "$redis_pid" 2>/dev/null || true
    wait "$redis_pid" 2>/dev/null || true
  fi
  if [[ -n "$mysql_pid" ]]; then
    mysqladmin --no-defaults --socket="$socket" -uroot shutdown >/dev/null 2>&1 \
      || kill "$mysql_pid" 2>/dev/null || true
    wait "$mysql_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mysqld --no-defaults --initialize-insecure --datadir="$work/data" --log-error="$work/init.log"
mysqld --no-defaults --datadir="$work/data" --skip-networking --mysqlx=OFF \
  --socket="$socket" --pid-file="$work/mysql.pid" --log-error="$work/mysql.log" &
mysql_pid=$!
redis_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
redis-server --bind 127.0.0.1 --port "$redis_port" --protected-mode yes \
  --dir "$work" --save '' --appendonly no >"$work/redis.log" 2>&1 &
redis_pid=$!

for _ in {1..100}; do
  kill -0 "$mysql_pid" "$redis_pid"
  if mysqladmin --no-defaults --socket="$socket" -uroot ping >/dev/null 2>&1 \
    && redis-cli -p "$redis_port" ping 2>/dev/null | grep -qx PONG; then break; fi
  sleep .1
done
isolated="$(mysql --no-defaults --socket="$socket" -uroot --batch --skip-column-names -e 'SELECT @@skip_networking')"
[[ "$isolated" == '1' ]]
[[ "$(redis-cli -p "$redis_port" INFO server | tr -d '\r' | awk -F: '$1=="process_id" {print $2}')" == "$redis_pid" ]]
mysql --no-defaults --socket="$socket" -uroot \
  -e 'CREATE DATABASE nori_canvas_race CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'

export DATABASE_URL="mysql://root@localhost/nori_canvas_race?socket=$socket"
export REDIS_HOST=127.0.0.1 REDIS_PORT="$redis_port" NORI_CANVAS_RACE_REDIS_PID="$redis_pid"
export ALLOW_TEST_NETWORK=0 BILLING_MODE=OFF BILLING_TEST_BOOTSTRAP=0 SYSTEM_TEST_BOOTSTRAP=0 NORI_ISOLATED_CANVAS_RACE_DB=1
./node_modules/.bin/prisma db push --skip-generate --schema "$root/prisma/schema.prisma"
./node_modules/.bin/vitest run tests/integration/api/specific/canvas-worker-cas-local.test.ts
