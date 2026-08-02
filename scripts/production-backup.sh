#!/bin/sh
set -eu

APP_DIR="${NORI_APP_DIR:-/opt/norivideo}"
BACKUP_DIR="$APP_DIR/backups"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
BASE_ENV="$APP_DIR/.env"
DEPLOY_ENV="$APP_DIR/.deploy.env"

umask 077
mkdir -p "$BACKUP_DIR"

set -a
. "$DEPLOY_ENV"
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/nori-$STAMP.sql.gz"
TEMP="$TARGET.tmp"
trap 'rm -f "$TEMP"' EXIT INT TERM

cd "$APP_DIR"
docker compose --env-file "$BASE_ENV" --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" exec -T \
  -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqldump -uroot --single-transaction --quick --routines --triggers \
  --events --no-tablespaces --set-gtid-purged=OFF nori \
  | gzip -9 > "$TEMP"

mv "$TEMP" "$TARGET"
if [ -f "$APP_DIR/data/services.prod.json" ]; then
  SERVICE_TARGET="$BACKUP_DIR/services-$STAMP.json"
  if [ -r "$APP_DIR/data/services.prod.json" ]; then
    cp "$APP_DIR/data/services.prod.json" "$SERVICE_TARGET"
  else
    # The runtime config is written with container-only permissions. Read it
    # through the app container so the host backup job does not require root.
    docker compose --env-file "$BASE_ENV" --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" exec -T \
      app sh -c 'cat /app/data/services.prod.json' > "$SERVICE_TARGET"
  fi
  chmod 600 "$SERVICE_TARGET"
fi
find "$BACKUP_DIR" -type f -name 'nori-*.sql.gz' -mtime +7 -delete
find "$BACKUP_DIR" -type f -name 'services-*.json' -mtime +7 -delete
printf 'backup=%s bytes=%s\n' "$TARGET" "$(wc -c < "$TARGET")"
