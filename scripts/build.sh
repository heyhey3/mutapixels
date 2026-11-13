#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/macos-env.sh
(cd contracts/mut_token && cargo near build non-reproducible-wasm)
(cd contracts/mutapixels && cargo near build non-reproducible-wasm)
ls -lh contracts/mut_token/target/near/mut_token.wasm contracts/mutapixels/target/near/mutapixels.wasm
