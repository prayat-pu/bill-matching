#!/usr/bin/env bash
# Stop the app. Nothing is lost: the workbook is only kept in memory anyway,
# so a run in flight has to be started again.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

printf '\n=== ปิดโปรแกรม / stopping ===\n'
if ! docker info >/dev/null 2>&1; then
  printf '  Docker is not running, so the app is already stopped.\n\n'
  exit 0
fi

docker compose down || {
  printf '\n  Could not stop it. Try: docker compose down\n\n'
  exit 1
}
printf '\n  หยุดแล้ว / stopped.\n\n'
