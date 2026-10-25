#!/usr/bin/env bash
# Watch what the app is doing. Press Ctrl+C to stop watching - this does not
# stop the app.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
docker compose logs -f --tail=50
