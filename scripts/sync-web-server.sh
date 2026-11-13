#!/usr/bin/env bash
# Keep the Vercel-embedded API copy in web/src/server in sync with server/src.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sed 's|"./nep413.js"|"./nep413"|' server/src/app.ts > "$tmp"

if [ "${1:-}" = "--check" ]; then
  diff -u server/src/nep413.ts web/src/server/nep413.ts
  diff -u "$tmp" web/src/server/app.ts
  echo "web/src/server is in sync"
  exit 0
fi

cp server/src/nep413.ts web/src/server/nep413.ts
cp "$tmp" web/src/server/app.ts
echo "synced server/src -> web/src/server"
