#!/usr/bin/env bash
# Start the app using the Node inside .runtime - nothing from the system.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
PORT="${PORT:-40000}"
NODE=".runtime/node/bin/node"

if [ ! -x "$NODE" ]; then
  printf '\n  Not installed yet. Run: python3 deploy/portable/install.py\n\n'
  exit 1
fi

[ -x "vendor/poppler/bin/pdftoppm" ] && export PDFTOPPM="$PWD/vendor/poppler/bin/pdftoppm"
# PORT must be exported, not just printed: without it the server falls back to
# its own default and the banner lies about where the app is.
export PORT HOST=0.0.0.0 NODE_ENV=production WEB_DIST="$PWD/apps/web/dist"

cat <<BANNER

  ========================================================
   READY
  ========================================================

   this computer:
     http://localhost:${PORT}
BANNER

ip -4 -o addr show scope global 2>/dev/null |
  awk -v p="$PORT" '$2 !~ /^(docker|br-|veth|virbr|tun|tap|lo)/ {split($4,a,"/"); print "     http://" a[1] ":" p}' |
  { IFS= read -r first || exit 0; echo; echo "   other computers:"; echo "$first"; cat; }

cat <<'BANNER'

  ========================================================
   Press Ctrl+C to stop.
  ========================================================

BANNER

exec "$NODE" --env-file-if-exists=.env --experimental-strip-types apps/server/src/main.ts
