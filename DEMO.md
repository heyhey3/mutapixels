# Demo script & submission checklist

This file is for the human submitter. The coding agent must not post on X or submit
the form; those actions require your explicit confirmation and your account.

## Before recording

1. v2 is already deployed at `v2.mutapixels-192217.testnet` (v1 remains at
   `mutapixels-192217.testnet`). The v2 contract currently holds **token #1**,
   owned by `dulllink7195.testnet`; use that wallet for the hero demo, or mint another
   pixel from the web app before recording.
2. Set `GATE_SECRET`, run the API publicly, and point `NEXT_PUBLIC_API_URL` at it.
   The current demo renderer is `http://localhost:8788/api/render`; set a public
   `RENDERER_BASE` (and call `set_renderer_base`) if metadata must resolve externally.
3. `server/.env` and `web/.env.local` already point at `v2.mutapixels-192217.testnet`.
4. Confirm on testnet:
   - `get_config` returns `vault_seed_bps`, `mutation_*_bps`
   - after minting, `get_vault(1)` returns a vault
   - `/api/gate/1/challenge` works for the holder account
5. Use two wallets/accounts: holder A and buyer B.
6. Fund the demo wallet with testnet NEAR. The first native swap on `/ref` locks about
   0.034 NEAR of refundable Ref/MUT/wNEAR storage; the swap amount is separate.

## 60-second video shot list

| Time | Shot | What to show |
|---|---|---|
| 0–10s | Cover | Open on the Mutapixels cover: Vol. 01, the floating pixel creatures, the thesis line and “Open app”. Toggle light/dark once. |
| 10–16s | Problem | “An NFT proves you own a JPEG. It cannot hold money, pay you, or gate a page.” Show the index. |
| 16–26s | Mint | Connect wallet → mint → open the pixel. Point at the vault seeded with 0.075 NEAR and the `mint` history entry. |
| 26–36s | Feed | Send 0.1 NEAR to the pixel. Show the vault balance rise and a `tip` entry appear. Anyone can feed a pixel. |
| 36–46s | Mutate | Roll a mutation with `$MUT`. Show the genome/art change and the `royalty` entry: 20% of the fee went to the pixel vault, 20% to the club treasury, 60% burned. |
| 46–54s | Transfer | Transfer the NFT to account B. Show the owner and vault holder change together. Open the holder lounge with A: `403 ownership moved`. Open it with B: pass and vault visible. |
| 54–60s | Close | “The token is the account. NEAR NEP-171 is the authorization primitive; `$MUT` is the fuel; Ref gives it a market.” Links. |
| Optional | Ref curve + swap | Cut to `/ref`: drag the trade-size slider and show the constant-product curve, the fee-adjusted marker and the live `get_return` quote. Use the native swap panel to buy `$MUT`; the first run registers Ref/token storage and asks for several wallet approvals. |

Keep it to one complete action → visible result. Avoid claiming yield or investment
returns.

## Suggested X post

Use the full 5-post thread and application fields in [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
The root post (the submission's `demoUrl`) must contain:

```text
NFTs: just JPEGs. Mutapixels was built at NEAR HACKATHON: each token owns a vault, earns royalties, keeps history, and gates a lounge.

Demo: https://mutapixels.vercel.app
Code: https://github.com/heyhey3/mutapixels

Should the vault move on resale? Feedback welcome.

@NEARProtocol #NEARHackathon
```

Attach the video (required if the demo is local-only). Screenshots alone are not
enough when judges cannot open the demo. Put the demo and repo links in the root, not
only in a reply; the root is the `demoUrl` reviewers open.

## Submission checklist

- [x] Repository is public and stays public through judging
- [ ] README has the live addresses, reproducible steps, threat model and disclosures
- [ ] Web + API are public and `renderer_base` points at the public API (or the X post
      has a complete demo video and says the demo is local/testnet)
- [ ] Demo post is live, says “was built at NEAR HACKATHON”, tags `@NEARProtocol` and
      `#NEARHackathon`, attaches a video/screenshots, and links the repo + demo
- [ ] `requestId` generated once and reused on retries
- [ ] `projectName` 2–80 chars, `leadName` 2–80 chars, valid email
- [ ] `nearAddress` is a real mainnet payout account **you control** (never invented)
- [ ] `projectUrl` is the public repo URL, `demoUrl` is the public X root-post URL
- [ ] `tracks` includes `nfts`; add other applicable tracks once each
- [ ] `idea` is 20–2000 chars: problem, product, NEAR’s role
- [ ] `consent: true` only after reading the notice
- [ ] If Meme Wars is also submitted, both READMEs name the other project
- [ ] v2 contract-account full-access key removal decided and disclosed
- [ ] $MUT token-account key removal/secure decision disclosed (the token owner can mint)
- [ ] No secrets in the repo or history (`server/.env`, keys, gate secret)
- [ ] Print the payload, then send only after your explicit yes
- [ ] Do not include a `website` field (spam trap)
