# Key and trust checklist

This is a **human decision** page. Removing a full-access key is irreversible and
changes what the deployed demo can do. Do not commit key files or paste secrets into a
chat.

## Current accounts

| Account | Role | Keys (testnet, checked 2026-11-13) |
|---|---|---|
| `v2.mutapixels-192217.testnet` | NFT contract / holds vaults + treasury | **1 full-access** |
| `mut-token-192217.testnet` | `$MUT` NEP-141; owner is itself | **1 full-access** |
| `mutapixels-192217.testnet` | owner for v2 (`set_*`, treasury) | **1 full-access** |

The v2 and `$MUT` keys are the two that can bypass the contract's ownership rules:
the v2 key can redeploy code and move the contract balance; the `$MUT` key can sign as
the token owner and mint. Neither is needed for normal holder actions.

## Inspect (safe)

```bash
near account view-account-summary v2.mutapixels-192217.testnet network-config testnet now
near account view-account-summary mut-token-192217.testnet network-config testnet now
near account view-account-summary mutapixels-192217.testnet network-config testnet now

near account list-keys v2.mutapixels-192217.testnet network-config testnet now
near account list-keys mut-token-192217.testnet network-config testnet now
```

## Recommended order

1. Finish the demo and set the public `renderer_base` while the owner key is available.
2. Decide whether the demo should be upgradeable:
   - **Lock the NFT (recommended for a trustless submission):** remove the v2
     contract-account full-access key. No more code redeploys; owner methods via
     `mutapixels-192217.testnet` still work; existing vault withdrawals still work.
   - **Lock `$MUT` supply:** remove the `$MUT` token-account full-access key. No more
     minting; transfers and burns still work; the token account's NEAR is no longer
     movable by a key.
3. Optionally lock the **owner** account after the renderer and treasury decisions are
   final. This disables `set_renderer_base`, `set_mint_price`, `set_mutation_cost`,
   treasury withdrawals and metadata refreshes. Token holders are unaffected.

## Remove a key (only after you confirm the public key)

```bash
# Replace <PUBLIC_KEY> with the exact key from list-keys.
near account delete-keys v2.mutapixels-192217.testnet \
  public-keys <PUBLIC_KEY> network-config testnet \
  sign-with-legacy-keychain send

near account delete-keys mut-token-192217.testnet \
  public-keys <PUBLIC_KEY> network-config testnet \
  sign-with-legacy-keychain send
```

The command signs with the target account's key, which is being removed. Verify the
transaction on a testnet explorer before signing; this cannot be undone.

## What removal does not do

- It does not affect the one existing pixel or its vault; holders still call
  `withdraw_vault` with their own wallet.
- It does not change the deployed wasm hash.
- It does not remove the owner account's power; that is a separate key and a separate
  decision.
- It does not migrate the contract to a new version; if the v2 key is removed, the
  contract is permanently non-upgradeable.

## Never commit

`~/.near-credentials/`, `server/.env`, `web/.env.local` and any recovery phrase stay
outside the repository. `.gitignore` already excludes the local env files; run
`scripts/check-secrets.sh` before making the repository public.
