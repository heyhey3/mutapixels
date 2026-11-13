# Mutapixels — submission pack (draft, **not submitted**)

The live rules are at <https://nearhackathon.com/HACKATHON.md>; re-read them before
sending. Deadline: **2026-11-14T23:59:00Z**. The human publishes the X post and sends
the application. Nothing here is sent automatically.

## Current state

| Item | Status |
|---|---|
| Pixel NFT v2 | `v2.mutapixels-192217.testnet` — live |
| `$MUT` | `mut-token-192217.testnet` |
| Ref pool | `ref-finance-101.testnet`, pool `2946` |
| Demo pixel | token `#1`, owner `dulllink7195.testnet`, vault `0.075 NEAR` |
| Web / API | local: `http://localhost:3001` / `http://localhost:8788` |
| Renderer | `http://localhost:8788/api/render` — **must be public before submission** |
| Public repo | **TBD** (the working tree is not a git repository yet) |
| X post / video | **TBD** |
| Application | **Not sent** |

## Application fields

| Field | Value |
|---|---|
| `requestId` | generate a UUID once; reuse on retries |
| `projectName` | `Mutapixels` |
| `leadName` | **TBD** (human) |
| `email` | **TBD** (human) |
| `size` | **TBD**: `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` |
| `tracks` | `["nfts"]` (primary). Add `social` only if the holder-lounge angle is genuinely being defended. |
| `nearAddress` | **TBD**: a mainnet payout account the human controls; never a testnet address |
| `projectUrl` | **TBD**: the public repository URL |
| `demoUrl` | **TBD**: the public X post URL (the root post of the thread), not localhost |
| `idea` | draft below, 20–2000 chars |
| `consent` | `true` only after the human reads the notice |

Do not add `website`; it is a spam trap.

### Fill and validate the payload

```bash
cp docs/submission.example.json docs/submission.json   # gitignored
# Edit docs/submission.json with the real values.
# Set consent: true only after reading the notice below.
pnpm validate:submission
```

The validator checks the field set, lengths, track ids, URLs, UUID, mainnet address,
consent and the 12,000-byte body limit. It prints the payload and never sends it. Keep
the separate `requestId`; reuse it if the API returns a 400/503.

> “I agree that the organizers may use these details to review our submission and
> contact us about this hackathon.”

### Draft `idea`

> Mutapixels is a NEP-171 NFT collection where each pixel is also a small on-chain
> account. Minting seeds 15% of the price into a per-token vault; every mutation pays
> the token a 20% royalty, anyone can feed a pixel NEAR or $MUT, and only the current
> holder can withdraw. Sell the NFT and the vault, earnings history and holder-only
> lounge move with it. The contract enforces ownership at call time, approvals never
> grant vault access, and a MUT payout that fails after a sale is restored to the new
> holder. A NEP-413 signed-message gate with a live ownership re-check protects the
> holder page. $MUT trades in a real Ref Finance simple pool; `/ref` executes the swap
> natively against the Ref exchange contract, bypassing Ref's frontend RPC. The demo is
> on NEAR testnet; the repo includes 24 contract tests, a threat model, and a public
> renderer path.

## Public deployment before the X post

The demo cannot be judged from `localhost`. Do one of:

1. **Host the API and web** (preferred): deploy `server` on a Node host and `web` on
   Vercel/Fly; set `NEXT_PUBLIC_API_URL` to the public API, set `RENDERER_BASE` to
   `<api>/api/render`, call `set_renderer_base` as the owner, then call
   `refresh_metadata_batch` for token #1. Set a fresh `GATE_SECRET` and
   `CORS_ORIGIN=<web origin>` on the API.
2. **Local-only + video**: record the full mint → feed → mutate → withdraw → transfer
   → lounge flow (see `DEMO.md`), attach it to the X post, and state that the demo is
   local/testnet. The repository README has the run commands.

The renderer change is owner-only (`mutapixels-192217.testnet`); it does not require
the v2 contract account key. After a public renderer is set, verify the media URL from
`nft_token` and the SVG route.

### Publish the repository (human)

The working tree is not a git repository yet. After reviewing `git status` and
confirming that `server/.env`, `web/.env.local` and `~/.near-credentials` are outside
the tree:

```bash
cd /path/to/mutapixels
git init
git add .
git commit -m "Mutapixels: NEP-171 token accounts, vaults, holder lounge, native Ref swap"
gh repo create <owner>/mutapixels --private --source=. --remote=origin --push
gh repo edit <owner>/mutapixels --visibility public \
  --accept-visibility-change-consequences
```

CI in `.github/workflows/ci.yml` runs the contract tests, server tests, typecheck and
web production build. Keep the repo public through judging.

### Set the public renderer (owner account)

After the API is publicly reachable at `https://<api-host>`:

```bash
near contract call-function as-transaction v2.mutapixels-192217.testnet \
  set_renderer_base json-args '"https://<api-host>/api/render"' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as mutapixels-192217.testnet network-config testnet \
  sign-with-legacy-keychain send

near contract call-function as-transaction v2.mutapixels-192217.testnet \
  refresh_metadata_batch json-args '{"from_index":null,"limit":50}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as mutapixels-192217.testnet network-config testnet \
  sign-with-legacy-keychain send
```

Set `GATE_SECRET` to a fresh random value, `CORS_ORIGIN` to the web origin, and keep
`RATE_LIMIT_CAPACITY` at a value that covers the gallery images (the default is 300
requests/minute per IP). The API must run a Node runtime; `pnpm --filter server build`
then `pnpm --filter server start` (set `PORT` and the NEAR/Ref variables).

The v2 contract account currently has one full-access key. If you want the deployed
contract to be non-upgradeable, remove that key after the demo and record the
transaction. Owner methods (`set_renderer_base`, treasury withdrawal, etc.) use the
separate `mutapixels-192217.testnet` owner account and keep working; the contract
account key is only needed for code redeploys. See [`KEYS.md`](KEYS.md) for the exact
inspect/remove checklist, including the `$MUT` token-account key.

## X thread (human publishes)

Required on the root post: the phrase **“was built at NEAR HACKATHON”**,
`@NEARProtocol`, `#NEARHackathon`, a video or screenshots, links to the demo and the
public repo, and a specific feedback invitation. The root post is the submission's
`demoUrl`; put the important links there, not in a reply.

**1/5 — root · attach the demo video** (screenshots in `docs/screenshots/` can be used
if the video upload fails: `cover.png`, `pixel-1.png`, `ref.png`)

```text
NFTs: just JPEGs. Mutapixels was built at NEAR HACKATHON: each token owns a vault, earns royalties, keeps history, and gates a lounge.

Demo: <PUBLIC_DEMO_URL>
Code: <PUBLIC_REPO_URL>

Should the vault move on resale? Feedback welcome.

@NEARProtocol #NEARHackathon
```

**2/5 — the vault · attach `docs/screenshots/pixel-1.png`**

```text
Mint a pixel: 15% of the price seeds its vault, 85% goes to the club treasury.

Mutate: 20% of the $MUT fee goes to the pixel's vault, 20% to the club, 60% is burned.

Anyone can feed a pixel NEAR or $MUT. Only the current holder can withdraw.
```

**3/5 — the transfer · attach `docs/screenshots/index.png` or `pixel-1.png`**

```text
The interesting part is resale.

The vault is keyed by token, not by wallet. Transfer the NFT and the new holder
immediately controls the balance, the earnings history and the lounge session.

If a $MUT payout fails after the sale, the callback restores it to the new holder.
```

**4/5 — NEAR and Ref · attach `docs/screenshots/ref.png`**

```text
NEAR is the auth primitive: NEP-171 ownership is checked at call time; $MUT is NEP-141; the lounge uses NEP-413 and re-checks ownership live.

$MUT trades in Ref pool 2946. /ref calls the Ref exchange contract directly — no Ref frontend/RPC dependency.
```

**5/5 — honest limits + CTA**

```text
Limits: the vault is a contract ledger, not a real NEAR sub-account; the seller can withdraw before a sale unless an escrow settles atomically; randomness uses env::random_seed(); demo is unaudited testnet software.

What would you test first? <PUBLIC_DEMO_URL>
```

Keep every post within 280 weighted characters. The root must be public and the
account must not be protected. The video is the preferred attachment; screenshots may
replace it only if the demo is publicly reachable.

## Pre-submit checklist

- [ ] Public repository exists, stays public through judging, and has CI green.
- [ ] `LICENSE`, README run path, threat model and disclosure are in the repo.
- [ ] v2 contract-account full-access key removal decided and disclosed.
- [ ] $MUT token-account key removal/secure decision disclosed; the token owner can mint.
- [ ] No secrets in the tree or history (`server/.env`, keys, gate secret).
- [ ] Public demo URL works, or the X post has a complete demo video.
- [ ] Public renderer set and `refresh_metadata_batch` run for existing tokens.
- [ ] X root post is public, has the phrase/tags/links/video, and the URL is copied.
- [ ] `demoUrl` is the X root URL; `projectUrl` is the repository URL.
- [ ] `nearAddress` is a mainnet account the human controls.
- [ ] Tracks and idea checked against the live rules; `website` omitted.
- [ ] If Meme Wars is also submitted, each README names the other project.
- [ ] Full JSON printed and the human explicitly says yes; then send once.
- [ ] Save the response; corrections go through
      <https://nearhackathon.com/request-changes>.

## Two-project disclosure

The same human is preparing **Meme Wars** (`heyhey3/meme-wars`, memecoins track). The
hackathon allows at most two submissions per email. If both are sent, both READMEs
must name the other project. Mutapixels' README names Meme Wars; Meme Wars' README
names Mutapixels.
