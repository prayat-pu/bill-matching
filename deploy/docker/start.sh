#!/usr/bin/env bash
# Start the app with Docker and print the addresses people should open.
# Written for someone who does not use a terminal: it checks what it needs,
# says plainly what is wrong, and ends with the URLs.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
PORT="${PORT:-40000}"

say() { printf '\n%s\n' "$1"; }
fail() {
  printf '\n  ไม่สำเร็จ / FAILED\n  %s\n\n' "$1"
  exit 1
}

say "=== ตรวจสอบ Docker / checking Docker ==="
command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker, then run this again."
docker compose version >/dev/null 2>&1 || fail "This Docker has no 'compose'. Install Docker Compose v2."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker, then run this again."
echo "  OK"

say "=== ตรวจสอบกุญแจ API / checking the API key ==="
if [ ! -f .env ]; then
  echo "  .env is missing. Paste the Gemini API key (nothing else is stored):"
  printf '  GEMINI_API_KEY: '
  read -r key
  [ -n "${key:-}" ] || fail "No key given. Create .env with GEMINI_API_KEY=... and run this again."
  printf 'GEMINI_API_KEY=%s\n' "$key" > .env
  echo "  wrote .env"
else
  grep -q "GEMINI_API_KEY=." .env || fail ".env has no GEMINI_API_KEY. Add it and run this again."
  echo "  OK"
fi

say "=== เริ่มโปรแกรม / starting (first run builds the image, a few minutes) ==="
docker compose up -d --build || fail "Docker could not start the app. The message above says why."

say "=== รอให้พร้อม / waiting until it answers ==="
ready=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ready="yes"
    break
  fi
  printf '.'
  sleep 2
done
printf '\n'
[ -n "$ready" ] || fail "It did not answer in two minutes. Run: docker compose logs --tail=50"

cat <<BANNER

  ========================================================
   พร้อมใช้งาน / READY
  ========================================================

   เครื่องนี้ / this computer:
     http://localhost:${PORT}
BANNER

echo
echo "   เครื่องอื่นในออฟฟิศ / other computers:"
"$(dirname "$0")/../lib/addresses.sh" "$PORT"

cat <<'BANNER'

  ========================================================
   ปิดโปรแกรม / to stop:  ./deploy/docker/stop.sh
  ========================================================

BANNER
