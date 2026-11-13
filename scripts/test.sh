#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/macos-env.sh
./scripts/check-secrets.sh
(cd contracts/mut_token && cargo test)
(cd contracts/mutapixels && cargo test)
pnpm --filter server test
./scripts/build.sh
pnpm -r typecheck
pnpm -r build
