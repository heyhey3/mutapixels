#!/usr/bin/env bash
# Deploys the v2 Mutapixels contracts to NEAR testnet (or mainnet) with the
# near-cli-rs syntax. This script SIGNS AND SENDS transactions, so it requires
# an explicit human confirmation and a funded OWNER account in the near keychain.
#
# Required:
#   OWNER=you.testnet
#   NFT_ACCOUNT=mutapixels-v2-<you>.testnet
#   MUT_ACCOUNT=mut-token-v2-<you>.testnet
#   RENDERER_BASE=https://your-public-renderer.example/api/render
#
# Optional:
#   MODE=new                  deploy both a new $MUT and a new NFT (default)
#   MODE=nft                  deploy only a new NFT against an existing $MUT
#                             (keeps the current Ref pool; zero migration risk)
#   MODE=migrate              upgrade an existing v1 NFT account in place
#   NEAR_NETWORK=testnet      (default: testnet)
#   SIGN_WITH=sign-with-legacy-keychain
#                             default: legacy ~/.near-credentials keychain;
#                             use sign-with-keychain for the near-cli-rs store
#   MINT_PRICE=500000000000000000000000            (0.5 NEAR)
#   MUTATION_COST=10000000000000000000000000        (10 MUT)
#   TOTAL_SUPPLY=1000000000000000000000000000000    (1,000,000,000 MUT)
#   CONFIRM=yes               skip the interactive confirmation
#
# `migrate` upgrades an existing v1 NFT account in place. `nft` deploys a fresh
# NFT pointing at an existing $MUT (useful when the Ref pool should be kept and
# the old NFT should stay untouched). `new` deploys both contracts, so both
# accounts must be empty. Deploy transactions are signed with the contract
# account's keychain key; owner-only follow-up calls use OWNER's key. The target
# contract accounts must already exist (create them with the NEAR CLI first).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/macos-env.sh

: "${OWNER:?Set OWNER to the account that signs and owns the contracts}"
: "${NFT_ACCOUNT:?Set NFT_ACCOUNT to the NEP-171 contract account}"
: "${MUT_ACCOUNT:?Set MUT_ACCOUNT to the NEP-141 contract account}"
: "${RENDERER_BASE:?Set RENDERER_BASE to the public renderer URL}"

MODE="${MODE:-new}"
NETWORK="${NEAR_NETWORK:-testnet}"
MINT_PRICE="${MINT_PRICE:-500000000000000000000000}"
MUTATION_COST="${MUTATION_COST:-10000000000000000000000000}"
TOTAL_SUPPLY="${TOTAL_SUPPLY:-1000000000000000000000000000000}"

case "$MODE" in
  new|nft|migrate) ;;
  *) echo "MODE must be new, nft or migrate (got: $MODE)" >&2; exit 1 ;;
esac

echo "Mutapixels deploy"
echo "  network : $NETWORK"
echo "  owner   : $OWNER"
echo "  NFT     : $NFT_ACCOUNT"
echo "  MUT     : $MUT_ACCOUNT"
echo "  mode    : $MODE"
echo "  renderer: $RENDERER_BASE"
echo
if [[ "${CONFIRM:-}" != "yes" ]]; then
  read -r -p "This signs and sends transactions. Type 'yes' to continue: " answer
  [[ "$answer" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

./scripts/build.sh

SIGNER="${SIGN_WITH:-sign-with-legacy-keychain}"
send_args=(
  prepaid-gas "100 Tgas"
  attached-deposit "0 NEAR"
  network-config "$NETWORK"
  "$SIGNER"
  send
)

if [[ "$MODE" == "new" ]]; then
  echo "==> Deploying \$MUT (${MUT_ACCOUNT})"
  near contract deploy "$MUT_ACCOUNT" use-file contracts/mut_token/target/near/mut_token.wasm \
    with-init-call new json-args \
    "{\"owner_id\":\"$OWNER\",\"total_supply\":\"$TOTAL_SUPPLY\"}" \
    "${send_args[@]}"
elif [[ "$MODE" == "nft" ]]; then
  echo "==> Reusing the existing \$MUT (${MUT_ACCOUNT})"
fi

if [[ "$MODE" == "migrate" ]]; then
  echo "==> Migrating the NFT contract (${NFT_ACCOUNT})"
  near contract deploy "$NFT_ACCOUNT" use-file contracts/mutapixels/target/near/mutapixels.wasm \
    with-init-call migrate json-args '{}' \
    "${send_args[@]}"

  echo "==> Updating the renderer base to ${RENDERER_BASE}"
  near call "$NFT_ACCOUNT" set_renderer_base "\"$RENDERER_BASE\"" \
    --use-account "$OWNER" \
    --gas 50000000000000 \
    --network-id "$NETWORK"

  echo "==> Refreshing metadata for existing tokens (first 50)"
  near call "$NFT_ACCOUNT" refresh_metadata_batch '{"from_index":"0","limit":50}' \
    --use-account "$OWNER" \
    --gas 200000000000000 \
    --network-id "$NETWORK"
  echo "    If the deployment has more than 50 tokens, repeat with from_index=50, 100, ..."
else
  echo "==> Deploying Mutapixels NFT (${NFT_ACCOUNT})"
  near contract deploy "$NFT_ACCOUNT" use-file contracts/mutapixels/target/near/mutapixels.wasm \
    with-init-call new json-args \
    "{\"owner_id\":\"$OWNER\",\"mut_token\":\"$MUT_ACCOUNT\",\"mint_price\":\"$MINT_PRICE\",\"mutation_cost\":\"$MUTATION_COST\",\"renderer_base\":\"$RENDERER_BASE\"}" \
    "${send_args[@]}"
fi

echo "==> Registering the NFT contract in \$MUT (required to receive mutation fees)"
near call "$MUT_ACCOUNT" storage_deposit \
  "{\"account_id\":\"$NFT_ACCOUNT\",\"registration_only\":true}" \
  --use-account "$OWNER" \
  --deposit 0.1 \
  --gas 50000000000000 \
  --network-id "$NETWORK"

echo
echo "Deployed. Verify with:"
echo "  near view $NFT_ACCOUNT get_config --network-id $NETWORK"
echo "  near view $NFT_ACCOUNT get_vault_stats --network-id $NETWORK"
echo
echo "Update server/.env and web/.env.local:"
echo "  NFT_CONTRACT_ID=$NFT_ACCOUNT"
echo "  MUT_TOKEN_ID=$MUT_ACCOUNT"
echo "  NEXT_PUBLIC_NFT_ID=$NFT_ACCOUNT"
echo "  NEXT_PUBLIC_MUT_ID=$MUT_ACCOUNT"
echo "  NEXT_PUBLIC_API_URL=https://your-public-api.example"
