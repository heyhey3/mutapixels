#!/usr/bin/env bash
# Lightweight repository secret scan. Run before committing or publishing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=target
  --exclude-dir=.next
  --exclude-dir=dist
  --exclude-dir=.claude
  --exclude-dir=screenshots
  --exclude='*.wasm'
  --exclude='*.png'
  --exclude='*.svg'
  --exclude='pnpm-lock.yaml'
  --exclude='check-secrets.sh'
  --exclude='.env.example'
  --exclude='.env'
  --exclude='.env.local'
  --exclude='.env.*'
)

PATTERN='private_key|seed_phrase|seedPhrase|mnemonic|NEAR_PRIVATE_KEY|ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY'

echo "== secret scan =="

if grep -RInE "${EXCLUDES[@]}" "$PATTERN" . ; then
  echo
  echo "FAIL: possible secret found above. Remove it and rotate the key." >&2
  exit 1
fi
echo "   no secret patterns in the working tree"

if grep -nE 'ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY' .env.example server/.env.example 2>/dev/null; then
  echo "FAIL: key material in an example env file" >&2
  exit 1
fi
echo "   env examples have no key material"

ENV_FILES=$(find . -type f \( -name '.env' -o -name '.env.*' \) \
  -not -path './node_modules/*' -not -path './.next/*' \
  -not -name '*.example' 2>/dev/null || true)
if [ -n "$ENV_FILES" ]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$ENV_FILES" | while read -r file; do
      if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
        echo "FAIL: tracked env file: $file" >&2
        exit 1
      fi
    done
    echo "   env files exist locally but are not tracked"
  else
    echo "   env files exist locally; the tree is not a git repo yet:"
    echo "$ENV_FILES" | sed 's/^/     /'
  fi
fi

echo "== local path scan =="
for pat in "${HOME:-}" "/Use""rs/"; do
  [ -z "$pat" ] && continue
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git grep -a -l -F "$pat" -- . ':!scripts/check-secrets.sh' >/dev/null 2>&1; then
      echo "FAIL: local path '$pat' found in tracked files:" >&2
      git grep -a -l -F "$pat" -- . ':!scripts/check-secrets.sh' >&2
      exit 1
    fi
  else
    FOUND=$(grep -RIlF "${EXCLUDES[@]}" "$pat" . 2>/dev/null | grep -v 'scripts/check-secrets.sh' || true)
    if [ -n "$FOUND" ]; then
      echo "FAIL: local path '$pat' found in:" >&2
      echo "$FOUND" >&2
      exit 1
    fi
  fi
done
echo "   no local home paths"

echo "PASS: no secrets found."
